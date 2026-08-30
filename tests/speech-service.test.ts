import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JennaSpeechService } from '../src/core/speechService';
import { platformBridge } from '../src/core/bridge';

describe('Voice & Speech Engine Service (Phase 1 Foundation)', () => {
  let speechService: JennaSpeechService;

  beforeEach(() => {
    speechService = new JennaSpeechService();
  });

  it('should start in idle state for both recognition and playback', () => {
    expect(speechService.getRecognitionState()).toBe('idle');
    expect(speechService.getPlaybackState()).toBe('idle');
    expect(speechService.getCurrentPlayingMessageId()).toBeNull();
  });

  it('should transition recognition state when listening begins and stops', () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();

    // Mock platform bridge speech recognition
    const stopMock = vi.fn();
    vi.spyOn(platformBridge, 'startSpeechRecognition').mockImplementation(
      (lang, onResult, errFn, onEnd) => {
        // simulate interim result
        onResult('hello', false);
        return stopMock;
      }
    );

    speechService.startListening('en-US', onTranscript, onError);
    expect(speechService.getRecognitionState()).toBe('listening');
    expect(onTranscript).toHaveBeenCalledWith('hello', false);

    speechService.stopListening();
    expect(speechService.getRecognitionState()).toBe('idle');
    expect(stopMock).toHaveBeenCalled();
  });

  it('should handle empty text in speak() without entering loading state', async () => {
    await speechService.speak('msg_empty', { text: '   ' });
    expect(speechService.getPlaybackState()).toBe('idle');
    expect(speechService.getCurrentPlayingMessageId()).toBeNull();
  });

  it('should stop playback and reset states', () => {
    vi.spyOn(platformBridge, 'stopAllAudio').mockImplementation(() => {});

    speechService.stopPlayback();
    expect(speechService.getPlaybackState()).toBe('idle');
    expect(speechService.getCurrentPlayingMessageId()).toBeNull();
    expect(platformBridge.stopAllAudio).toHaveBeenCalled();
  });

  it('should notify subscribers on speech state changes', () => {
    const listener = vi.fn();
    const unsub = speechService.subscribe(listener);

    speechService.stopListening();
    expect(listener).toHaveBeenCalled();
    unsub();
  });
});
