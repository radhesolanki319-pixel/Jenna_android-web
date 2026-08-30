/**
 * Jenna Voice & Speech Engine (STT & TTS)
 * Supports real-time speech input (STT) and dual-engine speech synthesis (Gemini Neural TTS & Web Speech fallback).
 */

import { platformBridge } from './bridge';

export type SpeechRecognitionState = 'idle' | 'listening' | 'processing' | 'error';
export type TTSPlaybackState = 'idle' | 'loading' | 'playing' | 'error';

export interface TTSRequestOptions {
  text: string;
  engine?: 'gemini_neural' | 'browser_native';
  geminiVoice?: 'Kore' | 'Zephyr' | 'Puck' | 'Fenrir' | 'Charon';
  browserVoiceURI?: string;
  rate?: number;
  pitch?: number;
  onSuccess?: () => void;
  onError?: (err: any) => void;
}

export class JennaSpeechService {
  private recognitionState: SpeechRecognitionState = 'idle';
  private playbackState: TTSPlaybackState = 'idle';
  private currentPlayingMessageId: string | null = null;
  private stopActiveRecognition: (() => void) | null = null;
  private cancelActiveTTS: (() => void) | null = null;
  private listeners: Array<() => void> = [];

  private notify() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getRecognitionState(): SpeechRecognitionState {
    return this.recognitionState;
  }

  getPlaybackState(): TTSPlaybackState {
    return this.playbackState;
  }

  getCurrentPlayingMessageId(): string | null {
    return this.currentPlayingMessageId;
  }

  // ----------------------------------------------------
  // Speech-to-Text (Voice Input)
  // ----------------------------------------------------
  startListening(
    lang = 'en-US',
    onTranscript: (text: string, isFinal: boolean) => void,
    onError: (err: string) => void
  ): void {
    this.stopListening();

    this.recognitionState = 'listening';
    this.notify();

    this.stopActiveRecognition = platformBridge.startSpeechRecognition(
      lang,
      (transcript, isFinal) => {
        onTranscript(transcript, isFinal);
      },
      (error) => {
        this.recognitionState = 'error';
        this.notify();
        onError(error);
      },
      () => {
        this.recognitionState = 'idle';
        this.stopActiveRecognition = null;
        this.notify();
      }
    );
  }

  stopListening(): void {
    if (this.stopActiveRecognition) {
      this.stopActiveRecognition();
      this.stopActiveRecognition = null;
    }
    this.recognitionState = 'idle';
    this.notify();
  }

  // ----------------------------------------------------
  // Text-to-Speech (Voice Output)
  // ----------------------------------------------------
  async speak(messageId: string, options: TTSRequestOptions): Promise<void> {
    this.stopPlayback();

    const {
      text,
      engine = 'gemini_neural',
      geminiVoice = 'Kore',
      browserVoiceURI,
      rate = 1.0,
      pitch = 1.0,
      onSuccess,
      onError,
    } = options;

    const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
    console.log(`[Jenna Voice] 🎙️ TTS play called for message "${messageId}" | Text length: ${text.length} chars | Preview: "${preview}" | Engine requested: "${engine}" | Settings:`, {
      engine,
      geminiVoice,
      browserVoiceURI,
      rate,
      pitch,
    });

    if (!text.trim()) {
      console.log('[Jenna Voice] ⚠️ TTS called with empty text, skipping playback.');
      return;
    }

    this.playbackState = 'loading';
    this.currentPlayingMessageId = messageId;
    this.notify();

    if (engine === 'gemini_neural') {
      try {
        console.log(`[Jenna Voice] ⚡ Attempting Gemini Neural TTS (voice: "${geminiVoice}")...`);
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: geminiVoice }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Gemini TTS API request failed`);
        }

        const data = await response.json();
        if (data.audio) {
          console.log(`[Jenna Voice] ✅ Gemini Neural TTS audio payload received (${data.audio.length} base64 chars, ${data.mimeType}). Starting playback...`);
          this.playbackState = 'playing';
          this.notify();

          this.cancelActiveTTS = await platformBridge.playBase64Audio(
            data.audio,
            data.mimeType || 'audio/l16; rate=24000; channels=1',
            () => {
              console.log(`[Jenna Voice] 🏁 Gemini Neural TTS playback completed for message "${messageId}".`);
              this.playbackState = 'idle';
              this.currentPlayingMessageId = null;
              this.cancelActiveTTS = null;
              this.notify();
              onSuccess?.();
            }
          );
          return;
        } else if (data.fallback) {
          console.log(`[Jenna Voice] ℹ️ Neural TTS server signaled fallback: ${data.error || 'Defaulting to browser speech synthesis.'}`);
        } else {
          throw new Error(data.error || 'No audio data returned by Neural TTS service');
        }
      } catch (err: any) {
        console.warn('[Jenna Voice] ⚠️ Neural TTS failed or quota limit reached, falling back to Browser SpeechSynthesis:', err?.message || err);
      }
    }

    // Browser Speech Synthesis Fallback / Native Mode
    try {
      console.log(`[Jenna Voice] 🗣️ Using Browser SpeechSynthesis engine for message "${messageId}" (${text.length} chars, rate: ${rate}, pitch: ${pitch}, voiceURI: "${browserVoiceURI || 'system default'}")...`);
      this.playbackState = 'playing';
      this.notify();

      platformBridge.speakBrowserTTS(text, browserVoiceURI, rate, pitch, () => {
        console.log(`[Jenna Voice] 🏁 Browser SpeechSynthesis playback finished for message "${messageId}".`);
        this.playbackState = 'idle';
        this.currentPlayingMessageId = null;
        this.notify();
        onSuccess?.();
      });
    } catch (synthErr: any) {
      console.error('[Jenna Voice] ❌ Browser SpeechSynthesis playback error:', synthErr);
      this.playbackState = 'idle';
      this.currentPlayingMessageId = null;
      this.notify();
      onError?.(synthErr);
    }
  }

  stopPlayback(): void {
    if (this.cancelActiveTTS) {
      this.cancelActiveTTS();
      this.cancelActiveTTS = null;
    }
    platformBridge.stopAllAudio();
    this.playbackState = 'idle';
    this.currentPlayingMessageId = null;
    this.notify();
  }
}

export const speechService = new JennaSpeechService();
