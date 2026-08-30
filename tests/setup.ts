// Global setup for Vitest
import { vi } from 'vitest';

if (typeof window !== 'undefined') {
  // Mock SpeechSynthesis
  if (!('speechSynthesis' in window)) {
    (window as any).speechSynthesis = {
      paused: false,
      speaking: false,
      pending: false,
      speak: vi.fn((utterance: any) => {
        setTimeout(() => {
          utterance.onstart?.();
          utterance.onend?.();
        }, 10);
      }),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([
        { name: 'Google US English', voiceURI: 'google_en_us', lang: 'en-US', default: true },
      ]),
    };
  }

  // Mock SpeechSynthesisUtterance
  if (!('SpeechSynthesisUtterance' in window)) {
    (window as any).SpeechSynthesisUtterance = class {
      text: string;
      lang = 'en-US';
      rate = 1.0;
      pitch = 1.0;
      volume = 1.0;
      voice: any = null;
      onstart: any = null;
      onend: any = null;
      onerror: any = null;
      constructor(text: string) {
        this.text = text;
      }
    };
  }

  // Mock AudioContext
  if (!('AudioContext' in window)) {
    (window as any).AudioContext = class {
      state = 'running';
      destination = {};
      createBuffer = vi.fn().mockReturnValue({
        getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
      });
      createBufferSource = vi.fn().mockReturnValue({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      });
      resume = vi.fn().mockResolvedValue(undefined);
      suspend = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    };
  }
}
