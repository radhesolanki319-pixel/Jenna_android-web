import { describe, it, expect, vi } from 'vitest';
import {
  AIBrain,
  aiBrain,
  AVAILABLE_MODELS,
  getModelMetadata,
  getDefaultModel,
  getFallbackChain,
} from '../src/core/ai';
import { GeminiProvider } from '../src/core/ai/providers/geminiProvider';
import { AIProvider, AIProviderError, AIChatMessage } from '../src/types/ai';

describe('AI Brain & Model Registry (Phase 1 Foundation)', () => {
  it('should provide a populated registry of supported models', () => {
    expect(AVAILABLE_MODELS).toBeDefined();
    expect(AVAILABLE_MODELS.length).toBeGreaterThanOrEqual(3);

    const defaultModel = getDefaultModel();
    expect(defaultModel.id).toBe('gemini-3.7-flash');
    expect(defaultModel.provider).toBe('gemini');
    expect(defaultModel.capabilities).toContain('chat');
    expect(defaultModel.capabilities).toContain('stream');
  });

  it('should retrieve model metadata accurately and return undefined for unknown models', () => {
    const flashMeta = getModelMetadata('gemini-3.7-flash');
    expect(flashMeta).toBeDefined();
    expect(flashMeta?.displayName).toBe('Gemini 3.7 Flash');
    expect(flashMeta?.provider).toBe('gemini');

    const unknownMeta = getModelMetadata('unknown-model-xyz');
    expect(unknownMeta).toBeUndefined();
  });

  it('should compute valid fallback chains for resilient execution', () => {
    const chain = getFallbackChain('gemini-3.7-flash');
    expect(Array.isArray(chain)).toBe(true);
    expect(chain[0]).toBe('gemini-3.7-flash');
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });

  it('should manage custom AI provider registration in AIBrain', () => {
    const brain = new AIBrain();
    expect(brain.getProvider('gemini')).toBeInstanceOf(GeminiProvider);

    const mockCustomProvider: AIProvider = {
      providerId: 'custom',
      displayName: 'Custom Mock Provider',
      isConfigured: () => true,
      generateText: vi.fn().mockResolvedValue({
        text: 'Mock response',
        modelUsed: 'custom-model',
        provider: 'custom',
      }),
      generateStream: vi.fn().mockResolvedValue({
        modelUsed: 'custom-model',
        provider: 'custom',
        tokensEmitted: 2,
      }),
    };

    brain.registerProvider(mockCustomProvider);
    expect(brain.getProvider('custom')).toBe(mockCustomProvider);
  });

  it('should throw an AIProviderError when accessing an unregistered provider', () => {
    const brain = new AIBrain();
    expect(() => brain.getProvider('anthropic' as any)).toThrow(AIProviderError);
    try {
      brain.getProvider('anthropic' as any);
    } catch (err: any) {
      expect(err.name).toBe('AIProviderError');
      expect(err.provider).toBe('anthropic');
    }
  });

  it('should correctly format and instantiate AIProviderError with metadata', () => {
    const error = new AIProviderError('Rate limit exceeded', 'gemini', {
      statusCode: 429,
      isRetryable: true,
      originalError: { reason: 'quota' },
    });

    expect(error.message).toBe('Rate limit exceeded');
    expect(error.provider).toBe('gemini');
    expect(error.statusCode).toBe(429);
    expect(error.isRetryable).toBe(true);
    expect(error.originalError).toEqual({ reason: 'quota' });
  });

  it('should route text generation through the configured provider in singleton aiBrain', async () => {
    const mockProvider: AIProvider = {
      providerId: 'gemini',
      displayName: 'Mock Gemini',
      isConfigured: () => true,
      generateText: vi.fn().mockResolvedValue({
        text: 'Hello from Jenna',
        modelUsed: 'gemini-3.7-flash',
        provider: 'gemini',
      }),
      generateStream: vi.fn().mockResolvedValue({
        modelUsed: 'gemini-3.7-flash',
        provider: 'gemini',
        tokensEmitted: 3,
      }),
    };

    const brain = new AIBrain();
    brain.registerProvider(mockProvider);

    const messages: AIChatMessage[] = [{ role: 'user', content: 'Hi Jenna' }];
    const result = await brain.generateText('gemini-3.7-flash', messages);

    expect(result.text).toBe('Hello from Jenna');
    expect(result.provider).toBe('gemini');
    expect(mockProvider.generateText).toHaveBeenCalledWith(
      'gemini-3.7-flash',
      messages,
      undefined
    );
  });
});
