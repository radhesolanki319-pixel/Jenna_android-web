/**
 * Jenna Platform Bridge Architecture
 * Defines the contract that both the Web application and the Android app (via Kotlin Native/JS interface) implement.
 * This guarantees total parity of Jenna's identity, storage, and audio handling across platforms.
 */

import { Conversation, Message, MemoryItem, MemoryCategory, MemoryPriority, JennaSettings } from '../types';

export interface JennaPlatformCapabilities {
  platform: 'web' | 'android';
  hasMicrophone: boolean;
  hasSpeechRecognition: boolean;
  hasSpeechSynthesis: boolean;
  hasNativeAudioEngine: boolean;
  isOnline: boolean;
  storageType: 'indexeddb_localstorage' | 'room_sqlite' | 'memory';
}

export interface IJennaStorageBridge {
  getConversations(): Promise<Conversation[]>;
  saveConversation(conv: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  getMessages(conversationId: string): Promise<Message[]>;
  saveMessages(conversationId: string, messages: Message[]): Promise<void>;
  
  getMemories(): Promise<MemoryItem[]>;
  saveMemory(item: MemoryItem): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  clearAllMemories(): Promise<void>;
  
  getSettings(): Promise<JennaSettings>;
  saveSettings(settings: JennaSettings): Promise<void>;
}

export interface IJennaAudioBridge {
  startSpeechRecognition(
    lang: string,
    onResult: (transcript: string, isFinal: boolean) => void,
    onError: (error: string) => void,
    onEnd: () => void
  ): () => void; // Returns stop function
  
  speakBrowserTTS(
    text: string,
    voiceURI?: string,
    rate?: number,
    pitch?: number,
    onEnd?: () => void
  ): void;
  
  playBase64Audio(
    base64Data: string,
    mimeType: string,
    onEnd?: () => void
  ): Promise<() => void>; // Returns cancel function
  
  unlockAudio(): void;
  stopAllAudio(): void;
}

/**
 * Helper: Decode base64 to Uint8Array safely
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Helper: Generate standard 44-byte RIFF WAV Blob from raw PCM 16-bit samples
 */
function pcm16ToWavBlob(pcmBytes: Uint8Array, sampleRate = 24000, channels = 1): Blob {
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  const totalDataLen = pcmBytes.length;
  const totalFileLen = totalDataLen + 36;
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;

  // 'RIFF' chunk descriptor
  view.setUint8(0, 0x52); // R
  view.setUint8(1, 0x49); // I
  view.setUint8(2, 0x46); // F
  view.setUint8(3, 0x46); // F
  view.setUint32(4, totalFileLen, true);
  // 'WAVE' format
  view.setUint8(8, 0x57);  // W
  view.setUint8(9, 0x41);  // A
  view.setUint8(10, 0x56); // V
  view.setUint8(11, 0x45); // E
  // 'fmt ' subchunk
  view.setUint8(12, 0x66); // f
  view.setUint8(13, 0x6d); // m
  view.setUint8(14, 0x74); // t
  view.setUint8(15, 0x20); // ' '
  view.setUint32(16, 16, true); // Subchunk1Size (16 for standard PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = uncompressed PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16 bits per sample
  // 'data' subchunk
  view.setUint8(36, 0x64); // d
  view.setUint8(37, 0x61); // a
  view.setUint8(38, 0x74); // t
  view.setUint8(39, 0x61); // a
  view.setUint32(40, totalDataLen, true);

  return new Blob([wavHeader, pcmBytes], { type: 'audio/wav' });
}

/**
 * Web implementation of the Jenna Platform Bridge
 */
export class WebJennaBridge implements IJennaStorageBridge, IJennaAudioBridge {
  private activeAudioElement: HTMLAudioElement | null = null;
  private activeAudioContext: AudioContext | null = null;
  private sharedAudioContext: AudioContext | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;

  getCapabilities(): JennaPlatformCapabilities {
    const hasSpeechRec = typeof window !== 'undefined' && 
      ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    const hasSpeechSynth = typeof window !== 'undefined' && 'speechSynthesis' in window;
    
    return {
      platform: 'web',
      hasMicrophone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
      hasSpeechRecognition: Boolean(hasSpeechRec),
      hasSpeechSynthesis: Boolean(hasSpeechSynth),
      hasNativeAudioEngine: false,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      storageType: 'indexeddb_localstorage',
    };
  }

  // Conversation Storage
  async getConversations(): Promise<Conversation[]> {
    try {
      const data = localStorage.getItem('jenna_conversations_v1');
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Validate each item structure
        return parsed.filter((c) => c && typeof c === 'object' && typeof c.id === 'string');
      }
      return [];
    } catch (err) {
      console.warn('[Jenna Bridge] Failed to parse conversations from storage, recovering...', err);
      return [];
    }
  }

  async saveConversation(conv: Conversation): Promise<void> {
    try {
      const all = await this.getConversations();
      const idx = all.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        all[idx] = conv;
      } else {
        all.unshift(conv);
      }
      localStorage.setItem('jenna_conversations_v1', JSON.stringify(all));
    } catch (err) {
      console.error('[Jenna Bridge] Failed to save conversation:', err);
    }
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      const all = await this.getConversations();
      const filtered = all.filter((c) => c.id !== id);
      localStorage.setItem('jenna_conversations_v1', JSON.stringify(filtered));
      localStorage.removeItem(`jenna_messages_${id}`);
      
      // If deleted conversation was active, clear stored active ID
      const storedActive = this.getActiveConversationId();
      if (storedActive === id) {
        this.saveActiveConversationId(filtered[0]?.id || null);
      }
    } catch (err) {
      console.error('[Jenna Bridge] Failed to delete conversation:', err);
    }
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    try {
      const data = localStorage.getItem(`jenna_messages_${conversationId}`);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Sanitize messages: ensure incomplete streaming status from interrupted sessions are recovered as completed or error
        return parsed
          .filter((m) => m && typeof m === 'object' && typeof m.id === 'string' && typeof m.content === 'string')
          .map((m) => {
            if (m.status === 'streaming') {
              return {
                ...m,
                status: m.content.trim() ? 'complete' : 'error',
                error: m.content.trim() ? undefined : 'Generation was interrupted.',
              };
            }
            return m;
          });
      }
      return [];
    } catch (err) {
      console.warn(`[Jenna Bridge] Failed to parse messages for ${conversationId}, recovering...`, err);
      return [];
    }
  }

  async saveMessages(conversationId: string, messages: Message[]): Promise<void> {
    try {
      localStorage.setItem(`jenna_messages_${conversationId}`, JSON.stringify(messages));
    } catch (err) {
      console.error(`[Jenna Bridge] Failed to save messages for ${conversationId}:`, err);
    }
  }

  getActiveConversationId(): string | null {
    try {
      return localStorage.getItem('jenna_active_conv_id');
    } catch {
      return null;
    }
  }

  saveActiveConversationId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem('jenna_active_conv_id', id);
      } else {
        localStorage.removeItem('jenna_active_conv_id');
      }
    } catch {
      // ignore
    }
  }

  // Memory Storage
  async getMemories(): Promise<MemoryItem[]> {
    try {
      const data = localStorage.getItem('jenna_memories_v1');
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((m) => m && typeof m === 'object' && typeof m.id === 'string')
            .map((m) => {
              const textContent = m.content || m.fact || '';
              // Normalize legacy category strings
              let cat: MemoryCategory = m.category;
              if ((m.category as any) === 'instructions') cat = 'directives';
              if ((m.category as any) === 'context_and_work') cat = 'work_context';
              if (!['personal_facts', 'preferences', 'directives', 'projects_and_goals', 'work_context'].includes(cat)) {
                cat = 'preferences';
              }

              const priority: MemoryPriority = m.priority || (m.isPinned ? 'high' : 'medium');

              return {
                id: m.id,
                category: cat,
                content: textContent,
                fact: textContent,
                priority,
                isPinned: priority === 'high',
                confidence: typeof m.confidence === 'number' ? m.confidence : 1.0,
                sourceConversationId: m.sourceConversationId,
                enabled: m.enabled !== false,
                createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
                updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
              };
            });
        }
      }
      // Initial default starter memories to establish the foundation
      const initialMemories: MemoryItem[] = [
        {
          id: 'mem_starter_1',
          category: 'directives',
          content: 'Provide thoughtful, direct, and well-structured answers with clean code examples when relevant.',
          fact: 'Provide thoughtful, direct, and well-structured answers with clean code examples when relevant.',
          priority: 'high',
          isPinned: true,
          confidence: 1.0,
          enabled: true,
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now() - 86400000,
        },
      ];
      localStorage.setItem('jenna_memories_v1', JSON.stringify(initialMemories));
      return initialMemories;
    } catch (err) {
      console.warn('[Jenna Bridge] Failed to parse memories, recovering...', err);
      return [];
    }
  }

  async saveMemory(item: MemoryItem): Promise<void> {
    try {
      const all = await this.getMemories();
      const textContent = item.content || item.fact || '';
      const priority: MemoryPriority = item.priority || (item.isPinned ? 'high' : 'medium');
      const normalizedItem: MemoryItem = {
        ...item,
        content: textContent,
        fact: textContent,
        priority,
        isPinned: priority === 'high',
        updatedAt: Date.now(),
      };

      const idx = all.findIndex((m) => m.id === item.id);
      if (idx >= 0) {
        all[idx] = normalizedItem;
      } else {
        all.unshift(normalizedItem);
      }
      localStorage.setItem('jenna_memories_v1', JSON.stringify(all));
    } catch (err) {
      console.error('[Jenna Bridge] Failed to save memory item:', err);
    }
  }

  async deleteMemory(id: string): Promise<void> {
    try {
      const all = await this.getMemories();
      const filtered = all.filter((m) => m.id !== id);
      localStorage.setItem('jenna_memories_v1', JSON.stringify(filtered));
    } catch (err) {
      console.error('[Jenna Bridge] Failed to delete memory item:', err);
    }
  }

  async clearAllMemories(): Promise<void> {
    try {
      localStorage.removeItem('jenna_memories_v1');
    } catch (err) {
      console.error('[Jenna Bridge] Failed to clear memories:', err);
    }
  }

  // Settings Storage
  async getSettings(): Promise<JennaSettings> {
    const defaultSettings: JennaSettings = {
      profile: {
        name: 'User',
        preferredTone: 'warm_conversational',
        customInstructions: '',
      },
      ai: {
        model: 'gemini-3.7-flash',
        temperature: 0.7,
        enableThinking: true,
        streamResponses: true,
      },
      memory: {
        enabled: true,
        autoExtractSuggestions: true,
        maxInjectedMemories: 8,
      },
      voice: {
        ttsEngine: 'gemini_neural',
        geminiVoice: 'Kore',
        speechRate: 1.0,
        speechPitch: 1.0,
        autoPlayTTS: true,
        sttLanguage: 'en-US',
        continuousVoiceMode: false,
      },
      appearance: {
        theme: 'dark',
        accentColor: 'indigo',
        fontSize: 'base',
      },
      platform: {
        mode: 'web_desktop',
      },
    };

    try {
      const data = localStorage.getItem('jenna_settings_v1');
      if (data) {
        const parsed = JSON.parse(data);
        return {
          ...defaultSettings,
          ...parsed,
          profile: { ...defaultSettings.profile, ...(parsed.profile || {}) },
          ai: { ...defaultSettings.ai, ...(parsed.ai || {}) },
          memory: { ...defaultSettings.memory, ...(parsed.memory || {}) },
          voice: {
            ...defaultSettings.voice,
            ...(parsed.voice || {}),
            autoPlayTTS: parsed.voice?.autoPlayTTS !== undefined ? parsed.voice.autoPlayTTS : true,
          },
          appearance: { ...defaultSettings.appearance, ...(parsed.appearance || {}) },
          platform: { ...defaultSettings.platform, ...(parsed.platform || {}) },
        };
      }
      return defaultSettings;
    } catch {
      return defaultSettings;
    }
  }

  async saveSettings(settings: JennaSettings): Promise<void> {
    localStorage.setItem('jenna_settings_v1', JSON.stringify(settings));
  }

  // Audio & Speech
  startSpeechRecognition(
    lang: string,
    onResult: (transcript: string, isFinal: boolean) => void,
    onError: (error: string) => void,
    onEnd: () => void
  ): () => void {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      onError('Speech recognition is not supported in this browser environment.');
      onEnd();
      return () => {};
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = lang || 'en-US';

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (final) {
          onResult(final, true);
        } else if (interim) {
          onResult(interim, false);
        }
      };

      recognition.onerror = (event: any) => {
        onError(event.error || 'Microphone capture error');
      };

      recognition.onend = () => {
        onEnd();
      };

      recognition.start();

      return () => {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      };
    } catch (err: any) {
      onError(err?.message || 'Failed to initialize microphone');
      onEnd();
      return () => {};
    }
  }

  getAudioContextState(): string {
    if (typeof window === 'undefined') return 'not_supported';
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return 'unsupported_by_browser';
    if (!this.sharedAudioContext) return 'uninitialized';
    return this.sharedAudioContext.state;
  }

  unlockAudio(): { beforeState: string; afterState: string } {
    const beforeState = this.getAudioContextState();
    try {
      if (typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          if (!this.sharedAudioContext || this.sharedAudioContext.state === 'closed') {
            this.sharedAudioContext = new AudioCtx();
          }
          if (this.sharedAudioContext.state === 'suspended') {
            this.sharedAudioContext.resume().catch(() => {});
          }
        }
        if ('speechSynthesis' in window) {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        }
      }
    } catch {}
    const afterState = this.getAudioContextState();
    return { beforeState, afterState };
  }

  speakBrowserTTS(
    text: string,
    voiceURI?: string,
    rate = 1.0,
    pitch = 1.0,
    onEnd?: () => void
  ): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('[Jenna Bridge] SpeechSynthesis is not supported in this browser environment.');
      onEnd?.();
      return;
    }

    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const clean = text
        .replace(/[*_#`[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 1000)
        .trim();

      if (!clean) {
        onEnd?.();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = Math.max(0.5, Math.min(2.0, rate));
      utterance.pitch = Math.max(0.5, Math.min(2.0, pitch));

      if (voiceURI) {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.voiceURI === voiceURI);
        if (match) utterance.voice = match;
      }

      let ended = false;
      const handleEnd = (status: 'ended' | 'error') => {
        if (ended) return;
        ended = true;
        if (this.activeUtterance === utterance) {
          this.activeUtterance = null;
        }
        if (status === 'error') {
          console.warn('[Jenna Bridge] SpeechSynthesis utterance ended with error or was interrupted.');
        }
        onEnd?.();
      };

      utterance.onend = () => handleEnd('ended');
      utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[Jenna Bridge] SpeechSynthesis error:', e.error);
        }
        handleEnd('error');
      };

      this.activeUtterance = utterance;

      // Small delay prevents Chromium cancel/speak race condition
      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utterance);
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch (speakErr) {
          console.warn('[Jenna Bridge] Failed to execute window.speechSynthesis.speak:', speakErr);
          handleEnd('error');
        }
      }, 20);
    } catch (err) {
      console.warn('[Jenna Bridge] Browser TTS failed to start:', err);
      this.activeUtterance = null;
      onEnd?.();
    }
  }

  async playBase64Audio(
    base64Data: string,
    mimeType: string,
    onEnd?: () => void
  ): Promise<() => void> {
    this.stopAllAudio();

    if (!base64Data) {
      onEnd?.();
      return () => {};
    }

    // Extract sample rate if present (e.g. rate=24000)
    let sampleRate = 24000;
    const rateMatch = mimeType.match(/rate=(\d+)/i);
    if (rateMatch && rateMatch[1]) {
      sampleRate = parseInt(rateMatch[1], 10) || 24000;
    }

    const isPcmOrL16 =
      mimeType.toLowerCase().includes('l16') ||
      mimeType.toLowerCase().includes('pcm') ||
      mimeType.toLowerCase().includes('raw') ||
      !mimeType.includes('/');

    const rawBytes = base64ToUint8Array(base64Data);

    // If it's PCM / L16, convert to standard WAV Blob
    const audioBlob = isPcmOrL16
      ? pcm16ToWavBlob(rawBytes, sampleRate, 1)
      : new Blob([rawBytes], { type: mimeType });

    // Method 1: Web Audio API (Direct sample buffer rendering)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        let ctx = this.sharedAudioContext;
        if (!ctx || ctx.state === 'closed') {
          ctx = new AudioCtx();
          this.sharedAudioContext = ctx;
        }
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        if (ctx.state === 'running') {
          this.activeAudioContext = ctx;

          // Convert PCM 16-bit to Float32 AudioBuffer
          const sampleCount = Math.floor(rawBytes.length / 2);
          const float32 = new Float32Array(sampleCount);
          const dataView = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
          for (let i = 0; i < sampleCount; i++) {
            float32[i] = dataView.getInt16(i * 2, true) / 32768.0;
          }

          const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate);
          audioBuffer.getChannelData(0).set(float32);

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);

          let ended = false;
          const cleanup = () => {
            if (ended) return;
            ended = true;
            onEnd?.();
          };

          source.onended = cleanup;
          source.start(0);

          return () => {
            if (!ended) {
              ended = true;
              try {
                source.stop();
              } catch {}
            }
          };
        }
      }
    } catch (webAudioErr) {
      console.warn('[Jenna Bridge] Web Audio API failed, trying HTML5 Audio element:', webAudioErr);
    }

    // Method 2: HTML5 Audio Element fallback with WAV Blob
    try {
      const blobUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(blobUrl);
      this.activeAudioElement = audio;

      let ended = false;
      const cleanup = () => {
        if (ended) return;
        ended = true;
        URL.revokeObjectURL(blobUrl);
        if (this.activeAudioElement === audio) {
          this.activeAudioElement = null;
        }
        onEnd?.();
      };

      audio.onended = cleanup;
      audio.onerror = (err) => {
        console.warn('[Jenna Bridge] HTML5 Audio error:', err);
        cleanup();
      };

      await audio.play();

      return () => {
        if (!ended) {
          ended = true;
          audio.pause();
          URL.revokeObjectURL(blobUrl);
          if (this.activeAudioElement === audio) {
            this.activeAudioElement = null;
          }
        }
      };
    } catch (audioErr) {
      console.warn('[Jenna Bridge] HTML5 Audio element playback failed:', audioErr);
      throw audioErr;
    }
  }

  stopAllAudio(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.activeUtterance = null;
    if (this.activeAudioElement) {
      try {
        this.activeAudioElement.pause();
        this.activeAudioElement.currentTime = 0;
      } catch {}
      this.activeAudioElement = null;
    }
  }
}

// Global Singleton Bridge Instance
export const platformBridge = new WebJennaBridge();
