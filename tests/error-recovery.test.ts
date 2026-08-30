import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProvider } from '../src/core/ai/providers/geminiProvider';
import { AIProviderError } from '../src/types/ai';
import { conversationService } from '../src/core/conversationStore';
import { WebJennaBridge, AndroidJennaBridge } from '../src/core/bridge';
import { speechService } from '../src/core/speechService';
import { Message } from '../src/types';

describe('Phase 2 #10 — Robust Error Recovery Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('1. AI Provider Error Normalization & Key Scrubbing', () => {
    const provider = new GeminiProvider();

    it('should identify 503, 429, and resource exhausted errors as retryable with friendly messages', () => {
      const err503 = provider.normalizeError({ status: 503, message: 'Service Unavailable' });
      expect(err503).toBeInstanceOf(AIProviderError);
      expect(err503.isRetryable).toBe(true);
      expect(err503.message).toContain('high demand');

      const err429 = provider.normalizeError({
        message: 'Resource has been exhausted (e.g. check quota)',
        statusCode: 429,
      });
      expect(err429.isRetryable).toBe(true);
      expect(err429.message).toContain('high demand');
    });

    it('should identify network resets, timeouts, and fetch failures as retryable', () => {
      const errTimeout = provider.normalizeError(new Error('connect ETIMEDOUT 142.250.190.42:443'));
      expect(errTimeout.isRetryable).toBe(true);
      expect(errTimeout.message).toContain('high demand');

      const errFetch = provider.normalizeError(new Error('TypeError: fetch failed'));
      expect(errFetch.isRetryable).toBe(true);
    });

    it('should scrub API keys from error messages to prevent credential leaks', () => {
      const leakedKey = 'AIzaSyD-1234567890abcdefghijklmnopqrst';
      const rawError = new Error(`Internal backend fault with token ${leakedKey}: Connection reset`);
      const normalized = provider.normalizeError(rawError);

      expect(normalized.message).not.toContain(leakedKey);
    });

    it('should provide clear message for authentication failures', () => {
      const authErr = provider.normalizeError({ status: 401, message: 'API_KEY_INVALID' });
      expect(authErr.isRetryable).toBe(false);
      expect(authErr.message).toContain('API key configuration');
    });
  });

  describe('2. Streaming Fallback & Abort Recovery', () => {
    it('should cleanly abort active stream and return emitted tokens without crashing', async () => {
      const provider = new GeminiProvider();
      let aborted = false;
      const tokensReceived: string[] = [];

      // Mock generateContentStream on client
      const mockClient = {
        models: {
          generateContentStream: vi.fn().mockImplementation(async function* () {
            yield { text: 'Hello ' };
            yield { text: 'world! ' };
            aborted = true; // Simulate abort after 2 tokens
            yield { text: 'This should not be reached.' };
          }),
        },
      };

      (provider as any).client = mockClient;

      const result = await provider.generateStream(
        'gemini-3.7-flash',
        [{ role: 'user', content: 'Test prompt' }],
        {
          onToken: (t) => tokensReceived.push(t),
          isAborted: () => aborted,
        }
      );

      expect(tokensReceived.join('')).toBe('Hello world! ');
      expect(result.tokensEmitted).toBe(2);
      expect(result.provider).toBe('gemini');
    });

    it('should fallback to next candidate model if primary model fails before emitting tokens', async () => {
      const provider = new GeminiProvider();
      const tokensReceived: string[] = [];

      let attempt = 0;
      const mockClient = {
        models: {
          generateContentStream: vi.fn().mockImplementation(async (params: any) => {
            attempt++;
            if (params.model === 'gemini-3.7-flash') {
              throw { status: 503, message: 'Model temporarily overloaded' };
            }
            // Fallback model succeeds
            return (async function* () {
              yield { text: 'Recovered from fallback model' };
            })();
          }),
        },
      };

      (provider as any).client = mockClient;

      const result = await provider.generateStream(
        'gemini-3.7-flash',
        [{ role: 'user', content: 'Test fallback' }],
        {
          onToken: (t) => tokensReceived.push(t),
        }
      );

      expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
      expect(tokensReceived.join('')).toBe('Recovered from fallback model');
      expect(result.tokensEmitted).toBe(1);
    });

    it('should not fallback mid-stream if tokens were already emitted, propagating normalized error instead', async () => {
      const provider = new GeminiProvider();
      const tokensReceived: string[] = [];

      const mockClient = {
        models: {
          generateContentStream: vi.fn().mockImplementation(async () => {
            return (async function* () {
              yield { text: 'Partial token 1. ' };
              throw new Error('Connection closed by remote host mid-stream');
            })();
          }),
        },
      };

      (provider as any).client = mockClient;

      await expect(
        provider.generateStream(
          'gemini-3.7-flash',
          [{ role: 'user', content: 'Test mid-stream failure' }],
          {
            onToken: (t) => tokensReceived.push(t),
          }
        )
      ).rejects.toThrow();

      expect(tokensReceived).toEqual(['Partial token 1. ']);
    });
  });

  describe('3. Message State Transitions & Finalization Recovery', () => {
    it('should finalize streaming message as error and preserve previous content', async () => {
      await conversationService.init();
      const conv = await conversationService.createNewConversation('Error Recovery Test');

      const msg = await conversationService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: 'Partial thought before network failure...',
        status: 'streaming',
      });

      expect(msg.status).toBe('streaming');

      await conversationService.finalizeStreamingMessage(
        msg.id,
        'error',
        'Network connection error. Please check your connection and retry.'
      );

      const updated = conversationService.getCurrentMessages().find((m) => m.id === msg.id);
      expect(updated?.status).toBe('error');
      expect(updated?.content).toBe('Partial thought before network failure...');
      expect(updated?.error).toBe('Network connection error. Please check your connection and retry.');
    });

    it('should clear obsolete error property when message transitions to complete', async () => {
      await conversationService.init();
      const conv = await conversationService.createNewConversation('Complete Transition Test');

      const msg = await conversationService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: 'Initial text',
        status: 'error',
      });

      // Simulate successful re-completion
      await conversationService.finalizeStreamingMessage(msg.id, 'complete');

      const updated = conversationService.getCurrentMessages().find((m) => m.id === msg.id);
      expect(updated?.status).toBe('complete');
      expect(updated?.error).toBeUndefined();
    });
  });

  describe('4. Interrupted Session & Bridge Sanitization (Web and Android)', () => {
    it('should sanitize orphaned streaming status in WebJennaBridge on storage load', async () => {
      const bridge = new WebJennaBridge();
      const rawMessages: Message[] = [
        {
          id: 'msg_1',
          conversationId: 'conv_test',
          role: 'user',
          content: 'Hello Jenna',
          timestamp: Date.now() - 5000,
          status: 'complete',
        },
        {
          id: 'msg_2',
          conversationId: 'conv_test',
          role: 'assistant',
          content: 'I was generating when browser crashed...',
          timestamp: Date.now() - 4000,
          status: 'streaming', // Orphaned streaming state
        },
        {
          id: 'msg_3',
          conversationId: 'conv_test',
          role: 'assistant',
          content: '',
          timestamp: Date.now() - 3000,
          status: 'streaming', // Empty orphaned state
        },
      ];

      localStorage.setItem('jenna_messages_conv_test', JSON.stringify(rawMessages));

      const recovered = await bridge.getMessages('conv_test');
      expect(recovered[1].status).toBe('complete');
      expect(recovered[1].content).toBe('I was generating when browser crashed...');
      expect(recovered[2].status).toBe('error');
      expect(recovered[2].error).toBe('Generation was interrupted.');
    });

    it('should sanitize orphaned streaming status in AndroidJennaBridge on Room DB load', async () => {
      const bridge = new AndroidJennaBridge();
      const rawMessages: Message[] = [
        {
          id: 'msg_android_1',
          conversationId: 'conv_android_test',
          role: 'assistant',
          content: 'Android background kill during generation',
          timestamp: Date.now() - 2000,
          status: 'streaming',
        },
        {
          id: 'msg_android_2',
          conversationId: 'conv_android_test',
          role: 'assistant',
          content: '',
          timestamp: Date.now() - 1000,
          status: 'streaming',
        },
      ];

      // Mock native Room DB interface
      (window as any).JennaAndroid = {
        getMessages: vi.fn().mockReturnValue(JSON.stringify(rawMessages)),
        saveMessages: vi.fn(),
      };

      const recovered = await bridge.getMessages('conv_android_test');
      expect(recovered[0].status).toBe('complete');
      expect(recovered[0].content).toBe('Android background kill during generation');
      expect(recovered[1].status).toBe('error');
      expect(recovered[1].error).toBe('Generation was interrupted.');

      delete (window as any).JennaAndroid;
    });
  });

  describe('5. Clean Retry & Regeneration without Duplication', () => {
    it('should trim failed assistant message on regenerate without duplicating user message', async () => {
      await conversationService.init();
      const conv = await conversationService.createNewConversation('Retry Test');

      // User sends message
      const userMsg = await conversationService.addMessage({
        conversationId: conv.id,
        role: 'user',
        content: 'Explain error recovery',
        status: 'complete',
      });

      // Assistant fails
      const failedAssistant = await conversationService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: '',
        status: 'error',
        error: 'Failed to generate response',
      });

      expect(conversationService.getCurrentMessages().length).toBe(2);

      // Simulate handleRegenerate: finding last user message, trimming subsequent messages
      const msgs = conversationService.getCurrentMessages();
      let lastUserIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }

      expect(lastUserIdx).toBe(0);
      const trimmed = msgs.slice(0, lastUserIdx + 1);
      await conversationService.setMessagesForConversation(conv.id, trimmed);

      expect(conversationService.getCurrentMessages().length).toBe(1);
      expect(conversationService.getCurrentMessages()[0].id).toBe(userMsg.id);

      // Simulate retry send (isRetry = true): creates exactly 1 assistant message, 0 user messages
      const newAssistantMsg = await conversationService.addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content: 'Clean retry response from Jenna.',
        status: 'complete',
      });

      const finalMessages = conversationService.getCurrentMessages();
      expect(finalMessages.length).toBe(2);
      expect(finalMessages[0].role).toBe('user');
      expect(finalMessages[0].content).toBe('Explain error recovery');
      expect(finalMessages[1].role).toBe('assistant');
      expect(finalMessages[1].id).toBe(newAssistantMsg.id);
      expect(finalMessages[1].status).toBe('complete');
    });
  });

  describe('6. Voice Engine (TTS) Error Recovery', () => {
    it('should stop playback and reset state to idle when stopPlayback is called', () => {
      (speechService as any).playbackState = 'playing';
      (speechService as any).currentPlayingMessageId = 'msg_playing_123';

      speechService.stopPlayback();

      expect(speechService.getPlaybackState()).toBe('idle');
      expect(speechService.getCurrentPlayingMessageId()).toBeNull();
    });

    it('should handle TTS network error gracefully and fallback without crashing', async () => {
      // Mock fetch to simulate network error for /api/tts
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error on TTS')) as any;

      await new Promise<void>((resolve) => {
        speechService.speak('msg_fail_test', {
          text: 'Hello world',
          engine: 'gemini_neural',
          onSuccess: () => {
            resolve();
          },
          onError: () => {
            resolve();
          },
        });
      });

      // Browser synthesis fallback is triggered when neural fails
      expect(speechService.getPlaybackState()).toBe('idle');
      expect(speechService.getCurrentPlayingMessageId()).toBeNull();
    });
  });
});
