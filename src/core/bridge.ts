/**
 * Jenna Platform Bridge Architecture
 * Defines the contract that both the Web application and the Android app (via Kotlin Native/JS interface) implement.
 * This guarantees total parity of Jenna's identity, storage, and audio handling across platforms.
 */

import { Conversation, Message, MemoryItem, MemoryCategory, MemoryPriority, JennaSettings, UserProfile, UserIdentity } from '../types';

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
  
  getUserIdentity(): Promise<UserIdentity>;
  saveUserIdentity(identity: Partial<UserIdentity>): Promise<UserIdentity>;

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
      if (data !== null) {
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
      // Initial default starter memories to establish the foundation on first run
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
      localStorage.setItem('jenna_memories_v1', JSON.stringify([]));
    } catch (err) {
      console.error('[Jenna Bridge] Failed to clear memories:', err);
    }
  }

  // User Identity & Session Storage
  async getUserIdentity(): Promise<UserIdentity> {
    try {
      const storedIdentity = localStorage.getItem('jenna_user_identity_v1');
      if (storedIdentity) {
        const parsed = JSON.parse(storedIdentity);
        if (parsed && typeof parsed === 'object' && parsed.id) {
          return {
            id: parsed.id,
            name: parsed.name || 'User',
            handle: parsed.handle || '@user',
            preferredTone: parsed.preferredTone || 'warm_conversational',
            customInstructions: parsed.customInstructions || '',
            createdAt: parsed.createdAt || Date.now(),
            lastActiveAt: Date.now(),
            authType: parsed.authType || 'local_device',
          };
        }
      }

      // Check existing settings profile for backward compatibility
      const settings = await this.getSettings();
      if (settings.profile?.id) {
        const identity: UserIdentity = {
          id: settings.profile.id,
          name: settings.profile.name || 'User',
          handle: settings.profile.handle || '@user',
          preferredTone: settings.profile.preferredTone || 'warm_conversational',
          customInstructions: settings.profile.customInstructions || '',
          createdAt: settings.profile.createdAt || Date.now(),
          lastActiveAt: Date.now(),
          authType: settings.profile.authType || 'local_device',
        };
        localStorage.setItem('jenna_user_identity_v1', JSON.stringify(identity));
        return identity;
      }

      // Generate a fresh persistent user identity
      const newId = `usr_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
      const newIdentity: UserIdentity = {
        id: newId,
        name: settings.profile?.name || 'User',
        handle: `@${(settings.profile?.name || 'user').toLowerCase().replace(/\s+/g, '_')}`,
        preferredTone: settings.profile?.preferredTone || 'warm_conversational',
        customInstructions: settings.profile?.customInstructions || '',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        authType: 'local_device',
      };

      localStorage.setItem('jenna_user_identity_v1', JSON.stringify(newIdentity));
      return newIdentity;
    } catch {
      return {
        id: 'usr_local_default',
        name: 'User',
        handle: '@user',
        preferredTone: 'warm_conversational',
        customInstructions: '',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        authType: 'local_device',
      };
    }
  }

  async saveUserIdentity(partial: Partial<UserIdentity>): Promise<UserIdentity> {
    const current = await this.getUserIdentity();
    const updated: UserIdentity = {
      ...current,
      ...partial,
      lastActiveAt: Date.now(),
    };
    try {
      localStorage.setItem('jenna_user_identity_v1', JSON.stringify(updated));
      // Keep settings.profile in sync
      const settings = await this.getSettings();
      await this.saveSettings({
        ...settings,
        profile: {
          ...settings.profile,
          id: updated.id,
          name: updated.name,
          handle: updated.handle,
          preferredTone: updated.preferredTone,
          customInstructions: updated.customInstructions,
          createdAt: updated.createdAt,
          lastActiveAt: updated.lastActiveAt,
          authType: updated.authType,
        },
      });
    } catch (err) {
      console.error('[Jenna Bridge] Failed to save user identity:', err);
    }
    return updated;
  }

  // Settings Storage
  async getSettings(): Promise<JennaSettings> {
    const defaultSettings: JennaSettings = {
      profile: {
        id: 'usr_local_default',
        name: 'User',
        handle: '@user',
        preferredTone: 'warm_conversational',
        customInstructions: '',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        authType: 'local_device',
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
        const mergedProfile = { ...defaultSettings.profile, ...(parsed.profile || {}) };
        if (!mergedProfile.id || mergedProfile.id === 'usr_local_default') {
          // Check if identity is in user identity store
          const storedIdentity = localStorage.getItem('jenna_user_identity_v1');
          if (storedIdentity) {
            try {
              const idData = JSON.parse(storedIdentity);
              if (idData.id) {
                mergedProfile.id = idData.id;
                mergedProfile.createdAt = idData.createdAt || mergedProfile.createdAt;
                mergedProfile.handle = idData.handle || mergedProfile.handle;
              }
            } catch {
              // ignore
            }
          }
        }

        return {
          ...defaultSettings,
          ...parsed,
          profile: mergedProfile,
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
    try {
      localStorage.setItem('jenna_settings_v1', JSON.stringify(settings));
      if (settings.profile) {
        localStorage.setItem('jenna_user_identity_v1', JSON.stringify(settings.profile));
      }
    } catch (err) {
      console.error('[Jenna Bridge] Failed to save settings:', err);
    }
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
          // Play 1-sample silent buffer during user gesture to completely unlock Web Audio API hardware across mobile/desktop
          try {
            const buffer = this.sharedAudioContext.createBuffer(1, 1, 22050);
            const source = this.sharedAudioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.sharedAudioContext.destination);
            source.start(0);
          } catch {}
        }
        if ('speechSynthesis' in window) {
          try {
            if (window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            }
            // Prime voices list
            window.speechSynthesis.getVoices();
          } catch {}
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
      // Unpause if in paused state
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      // Cancel previous speech to prevent queue stacking
      try {
        window.speechSynthesis.cancel();
      } catch {}

      const clean = text
        .replace(/[*_#`[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 1000)
        .trim();

      if (!clean) {
        console.log('[Jenna Bridge] ⚠️ Cleaned text for SpeechSynthesis is empty, skipping.');
        onEnd?.();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.volume = 1.0;
      utterance.rate = Math.max(0.5, Math.min(2.0, rate));
      utterance.pitch = Math.max(0.5, Math.min(2.0, pitch));

      const voices = window.speechSynthesis.getVoices();
      if (voiceURI) {
        const match = voices.find((v) => v.voiceURI === voiceURI);
        if (match) {
          utterance.voice = match;
          utterance.lang = match.lang;
        }
      }

      if (!utterance.voice && voices.length > 0) {
        // Find default english voice or first available
        const defaultVoice = voices.find((v) => v.lang.startsWith('en') && v.default) ||
          voices.find((v) => v.lang.startsWith('en')) ||
          voices[0];
        if (defaultVoice) {
          utterance.voice = defaultVoice;
          utterance.lang = defaultVoice.lang;
        }
      }

      if (!utterance.lang) {
        utterance.lang = 'en-US';
      }

      // GC Protection: Keep active utterance referenced on window to prevent garbage collection mid-speech
      (window as any).__jenna_active_utterance = utterance;
      this.activeUtterance = utterance;

      let ended = false;
      const handleEnd = (status: 'ended' | 'error') => {
        if (ended) return;
        ended = true;
        (window as any).__jenna_active_utterance = null;
        if (this.activeUtterance === utterance) {
          this.activeUtterance = null;
        }
        if (status === 'error') {
          console.warn('[Jenna Bridge] SpeechSynthesis utterance ended with error or was interrupted.');
        } else {
          console.log('[Jenna Bridge] 🏁 SpeechSynthesis utterance audio playback completed.');
        }
        onEnd?.();
      };

      utterance.onstart = () => {
        console.log(`[Jenna Bridge] 🔊 SpeechSynthesis audio output started (voice: "${utterance.voice?.name || 'default'}", lang: "${utterance.lang}")`);
      };
      utterance.onend = () => handleEnd('ended');
      utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[Jenna Bridge] SpeechSynthesis error:', e.error);
        }
        handleEnd('error');
      };

      console.log(`[Jenna Bridge] 🗣️ Calling window.speechSynthesis.speak() for text: "${clean.slice(0, 40)}..."`);
      window.speechSynthesis.speak(utterance);

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (err) {
      console.warn('[Jenna Bridge] Browser TTS failed to start:', err);
      (window as any).__jenna_active_utterance = null;
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

/**
 * Android Native Communication Interfaces
 */
export interface WakeWordStatus {
  enabled: boolean;
  isListening: boolean;
  keyword: string;
}

export interface AndroidIntentPayload {
  action: string;
  data?: string;
  text?: string;
  type?: string;
  extras?: Record<string, string>;
}

export interface AndroidDeviceInfo {
  platform: string;
  brand: string;
  model: string;
  sdkVersion: number;
  appVersion: string;
}

/**
 * Android Native JavascriptInterface declaration
 */
export interface IJennaAndroidNative {
  // Storage
  getConversations(): string; // JSON
  saveConversation(json: string): void;
  deleteConversation(id: string): void;
  getMessages(conversationId: string): string; // JSON
  saveMessages(conversationId: string, json: string): void;
  getMemories(): string; // JSON
  saveMemory(json: string): void;
  deleteMemory(id: string): void;
  clearAllMemories(): void;
  getUserIdentity(): string; // JSON
  saveUserIdentity(json: string): string; // JSON
  getSettings(): string; // JSON
  saveSettings(json: string): void;

  // Audio / Speech
  startSpeechRecognition(lang: string): boolean;
  stopSpeechRecognition(): void;
  speakNativeTTS(text: string, rate: number, pitch: number): void;
  stopTTS(): void;
  playBase64Audio(base64Data: string, mimeType: string): boolean;
  stopAudio(): void;

  // Wake-word Status & Control
  getWakeWordStatus(): string; // JSON
  setWakeWordEnabled(enabled: boolean): void;

  // Back Button & Navigation
  setBackIntercepted(intercepted: boolean): void;
  exitApp(): void;

  // Intent Routing & Sharing
  getInitialIntent(): string; // JSON
  openExternalUrl(url: string): boolean;
  shareText(text: string, title?: string): boolean;

  // System
  vibrate(patternType: string): void;
  showToast(message: string, isLong?: boolean): void;
  getDeviceInfo(): string; // JSON
}

/**
 * Android implementation of the Jenna Platform Bridge.
 * Interfaces directly with Kotlin WebView JavascriptInterface (`window.JennaAndroid`).
 */
export class AndroidJennaBridge implements IJennaStorageBridge, IJennaAudioBridge {
  private webFallback = new WebJennaBridge();
  private backPressHandlers: Array<() => boolean> = [];
  private wakeWordListeners: Array<(keyword: string) => void> = [];
  private intentListeners: Array<(intent: AndroidIntentPayload) => void> = [];

  constructor() {
    this.setupWindowListeners();
  }

  private setupWindowListeners(): void {
    if (typeof window === 'undefined') return;

    // Native Activity back button event
    (window as any).__onJennaAndroidBackPressed = (): boolean => {
      // Execute handlers in LIFO order (most recent modal/handler first)
      for (let i = this.backPressHandlers.length - 1; i >= 0; i--) {
        const handled = this.backPressHandlers[i]();
        if (handled) return true;
      }
      return false;
    };

    // Native Wake-word detection event
    (window as any).__onJennaAndroidWakeWordDetected = (keyword = 'Hey Jenna') => {
      this.wakeWordListeners.forEach((fn) => fn(keyword));
    };

    // Native Android Intent event
    (window as any).__onJennaAndroidIntent = (intentRaw: string | AndroidIntentPayload) => {
      try {
        const payload: AndroidIntentPayload =
          typeof intentRaw === 'string' ? JSON.parse(intentRaw) : intentRaw;
        this.intentListeners.forEach((fn) => fn(payload));
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error parsing incoming intent:', err);
      }
    };
  }

  private get native(): IJennaAndroidNative | null {
    if (typeof window !== 'undefined') {
      return (window as any).JennaAndroid || (window as any).Android || null;
    }
    return null;
  }

  isAvailable(): boolean {
    return Boolean(this.native);
  }

  getCapabilities(): JennaPlatformCapabilities {
    if (!this.isAvailable()) {
      return this.webFallback.getCapabilities();
    }
    return {
      platform: 'android',
      hasMicrophone: true,
      hasSpeechRecognition: true,
      hasSpeechSynthesis: true,
      hasNativeAudioEngine: true,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      storageType: 'room_sqlite',
    };
  }

  // Storage Implementations delegating to Kotlin Room Database
  async getConversations(): Promise<Conversation[]> {
    if (this.native) {
      try {
        const raw = this.native.getConversations();
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching conversations from Room DB:', err);
      }
    }
    return this.webFallback.getConversations();
  }

  async saveConversation(conv: Conversation): Promise<void> {
    if (this.native) {
      try {
        this.native.saveConversation(JSON.stringify(conv));
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error saving conversation to Room DB:', err);
      }
    }
    return this.webFallback.saveConversation(conv);
  }

  async deleteConversation(id: string): Promise<void> {
    if (this.native) {
      try {
        this.native.deleteConversation(id);
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error deleting conversation:', err);
      }
    }
    return this.webFallback.deleteConversation(id);
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    if (this.native) {
      try {
        const raw = this.native.getMessages(conversationId);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
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
        }
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching messages:', err);
      }
    }
    return this.webFallback.getMessages(conversationId);
  }

  async saveMessages(conversationId: string, messages: Message[]): Promise<void> {
    if (this.native) {
      try {
        this.native.saveMessages(conversationId, JSON.stringify(messages));
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error saving messages:', err);
      }
    }
    return this.webFallback.saveMessages(conversationId, messages);
  }

  async getMemories(): Promise<MemoryItem[]> {
    if (this.native) {
      try {
        const raw = this.native.getMemories();
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching memories from Room DB:', err);
      }
    }
    return this.webFallback.getMemories();
  }

  async saveMemory(item: MemoryItem): Promise<void> {
    if (this.native) {
      try {
        this.native.saveMemory(JSON.stringify(item));
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error saving memory to Room DB:', err);
      }
    }
    return this.webFallback.saveMemory(item);
  }

  async deleteMemory(id: string): Promise<void> {
    if (this.native) {
      try {
        this.native.deleteMemory(id);
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error deleting memory:', err);
      }
    }
    return this.webFallback.deleteMemory(id);
  }

  async clearAllMemories(): Promise<void> {
    if (this.native) {
      try {
        this.native.clearAllMemories();
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error clearing memories:', err);
      }
    }
    return this.webFallback.clearAllMemories();
  }

  async getUserIdentity(): Promise<UserIdentity> {
    if (this.native) {
      try {
        const raw = this.native.getUserIdentity();
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching user identity:', err);
      }
    }
    return this.webFallback.getUserIdentity();
  }

  async saveUserIdentity(identity: Partial<UserIdentity>): Promise<UserIdentity> {
    if (this.native) {
      try {
        const raw = this.native.saveUserIdentity(JSON.stringify(identity));
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error saving user identity:', err);
      }
    }
    return this.webFallback.saveUserIdentity(identity);
  }

  async getSettings(): Promise<JennaSettings> {
    if (this.native) {
      try {
        const raw = this.native.getSettings();
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching settings:', err);
      }
    }
    return this.webFallback.getSettings();
  }

  async saveSettings(settings: JennaSettings): Promise<void> {
    if (this.native) {
      try {
        this.native.saveSettings(JSON.stringify(settings));
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error saving settings:', err);
      }
    }
    return this.webFallback.saveSettings(settings);
  }

  // Audio / Speech Implementations
  startSpeechRecognition(
    lang: string,
    onResult: (transcript: string, isFinal: boolean) => void,
    onError: (error: string) => void,
    onEnd: () => void
  ): () => void {
    if (this.native) {
      try {
        // Register window callbacks for Android native speech recognizer events
        (window as any).__onJennaAndroidSpeechResult = (transcript: string, isFinal: boolean) => {
          onResult(transcript, isFinal);
        };
        (window as any).__onJennaAndroidSpeechError = (error: string) => {
          onError(error);
        };
        (window as any).__onJennaAndroidSpeechEnd = () => {
          onEnd();
        };

        const started = this.native.startSpeechRecognition(lang || 'en-US');
        if (started) {
          return () => {
            try {
              this.native?.stopSpeechRecognition();
            } catch {}
          };
        }
      } catch (err) {
        console.warn('[Jenna Android Bridge] Native speech recognition error, fallback to web:', err);
      }
    }

    return this.webFallback.startSpeechRecognition(lang, onResult, onError, onEnd);
  }

  speakBrowserTTS(
    text: string,
    voiceURI?: string,
    rate = 1.0,
    pitch = 1.0,
    onEnd?: () => void
  ): void {
    if (this.native) {
      try {
        (window as any).__onJennaAndroidTTSFinished = () => {
          onEnd?.();
        };
        this.native.speakNativeTTS(text, rate, pitch);
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Native TTS error, fallback to web:', err);
      }
    }
    this.webFallback.speakBrowserTTS(text, voiceURI, rate, pitch, onEnd);
  }

  async playBase64Audio(
    base64Data: string,
    mimeType: string,
    onEnd?: () => void
  ): Promise<() => void> {
    if (this.native) {
      try {
        (window as any).__onJennaAndroidAudioEnded = () => {
          onEnd?.();
        };
        const started = this.native.playBase64Audio(base64Data, mimeType);
        if (started) {
          return () => {
            try {
              this.native?.stopAudio();
            } catch {}
          };
        }
      } catch (err) {
        console.warn('[Jenna Android Bridge] Native audio playback error, fallback to web:', err);
      }
    }
    return this.webFallback.playBase64Audio(base64Data, mimeType, onEnd);
  }

  unlockAudio(): { beforeState: string; afterState: string } {
    return this.webFallback.unlockAudio();
  }

  stopAllAudio(): void {
    if (this.native) {
      try {
        this.native.stopAudio();
        this.native.stopTTS();
      } catch {}
    }
    this.webFallback.stopAllAudio();
  }

  // ----------------------------------------------------
  // Wake-Word Control & Status
  // ----------------------------------------------------
  async getWakeWordStatus(): Promise<WakeWordStatus> {
    if (this.native) {
      try {
        const raw = this.native.getWakeWordStatus();
        if (raw) return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching wake word status:', err);
      }
    }
    return { enabled: false, isListening: false, keyword: 'Hey Jenna' };
  }

  async setWakeWordEnabled(enabled: boolean): Promise<void> {
    if (this.native) {
      try {
        this.native.setWakeWordEnabled(enabled);
        return;
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error setting wake word status:', err);
      }
    }
  }

  onWakeWord(callback: (keyword: string) => void): () => void {
    this.wakeWordListeners.push(callback);
    return () => {
      this.wakeWordListeners = this.wakeWordListeners.filter((fn) => fn !== callback);
    };
  }

  // ----------------------------------------------------
  // Back Navigation & Activity Control
  // ----------------------------------------------------
  onBackPressed(handler: () => boolean): () => void {
    this.backPressHandlers.push(handler);
    this.updateNativeBackState();
    return () => {
      this.backPressHandlers = this.backPressHandlers.filter((h) => h !== handler);
      this.updateNativeBackState();
    };
  }

  private updateNativeBackState(): void {
    if (this.native) {
      try {
        this.native.setBackIntercepted(this.backPressHandlers.length > 0);
      } catch {}
    }
  }

  triggerBackPressed(): boolean {
    if (typeof window !== 'undefined' && (window as any).__onJennaAndroidBackPressed) {
      return (window as any).__onJennaAndroidBackPressed();
    }
    return false;
  }

  exitApp(): void {
    if (this.native) {
      try {
        this.native.exitApp();
      } catch {}
    }
  }

  // ----------------------------------------------------
  // Intent & Deep Link Routing
  // ----------------------------------------------------
  async getInitialIntent(): Promise<AndroidIntentPayload | null> {
    if (this.native) {
      try {
        const raw = this.native.getInitialIntent();
        if (raw && raw !== '{}') return JSON.parse(raw);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error fetching initial intent:', err);
      }
    }
    return null;
  }

  onIntent(callback: (intent: AndroidIntentPayload) => void): () => void {
    this.intentListeners.push(callback);
    return () => {
      this.intentListeners = this.intentListeners.filter((fn) => fn !== callback);
    };
  }

  async openExternalUrl(url: string): Promise<boolean> {
    if (this.native) {
      try {
        return this.native.openExternalUrl(url);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error opening external URL:', err);
      }
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  }

  async shareText(text: string, title?: string): Promise<boolean> {
    if (this.native) {
      try {
        return this.native.shareText(text, title);
      } catch (err) {
        console.warn('[Jenna Android Bridge] Error sharing text via native Android:', err);
      }
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: title || 'Jenna AI Assistant', text });
        return true;
      } catch {}
    }
    return false;
  }

  // ----------------------------------------------------
  // System & Hardware
  // ----------------------------------------------------
  vibrate(patternType: 'light' | 'medium' | 'heavy' | 'success' | 'warning' = 'light'): void {
    if (this.native) {
      try {
        this.native.vibrate(patternType);
      } catch {}
    } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(patternType === 'heavy' ? 40 : 20);
      } catch {}
    }
  }

  showToast(message: string, isLong = false): void {
    if (this.native) {
      try {
        this.native.showToast(message, isLong);
        return;
      } catch {}
    }
    console.log(`[Jenna Toast] ${message}`);
  }

  async getDeviceInfo(): Promise<AndroidDeviceInfo> {
    if (this.native) {
      try {
        const raw = this.native.getDeviceInfo();
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return {
      platform: 'web',
      brand: 'Browser',
      model: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      sdkVersion: 0,
      appVersion: '1.0.0',
    };
  }
}

/**
 * Unified Platform Bridge: Dynamically delegates to Android Native Bridge or Web Bridge.
 */
export class UnifiedPlatformBridge implements IJennaStorageBridge, IJennaAudioBridge {
  private webBridge = new WebJennaBridge();
  private androidBridge = new AndroidJennaBridge();

  private get activeBridge(): IJennaStorageBridge &
    IJennaAudioBridge & { getCapabilities: () => JennaPlatformCapabilities } {
    if (this.androidBridge.isAvailable()) {
      return this.androidBridge;
    }
    return this.webBridge;
  }

  getCapabilities(): JennaPlatformCapabilities {
    return this.activeBridge.getCapabilities();
  }

  getConversations(): Promise<Conversation[]> {
    return this.activeBridge.getConversations();
  }

  saveConversation(conv: Conversation): Promise<void> {
    return this.activeBridge.saveConversation(conv);
  }

  deleteConversation(id: string): Promise<void> {
    return this.activeBridge.deleteConversation(id);
  }

  getMessages(conversationId: string): Promise<Message[]> {
    return this.activeBridge.getMessages(conversationId);
  }

  saveMessages(conversationId: string, messages: Message[]): Promise<void> {
    return this.activeBridge.saveMessages(conversationId, messages);
  }

  getMemories(): Promise<MemoryItem[]> {
    return this.activeBridge.getMemories();
  }

  saveMemory(item: MemoryItem): Promise<void> {
    return this.activeBridge.saveMemory(item);
  }

  deleteMemory(id: string): Promise<void> {
    return this.activeBridge.deleteMemory(id);
  }

  clearAllMemories(): Promise<void> {
    return this.activeBridge.clearAllMemories();
  }

  getUserIdentity(): Promise<UserIdentity> {
    return this.activeBridge.getUserIdentity();
  }

  saveUserIdentity(identity: Partial<UserIdentity>): Promise<UserIdentity> {
    return this.activeBridge.saveUserIdentity(identity);
  }

  getSettings(): Promise<JennaSettings> {
    return this.activeBridge.getSettings();
  }

  saveSettings(settings: JennaSettings): Promise<void> {
    return this.activeBridge.saveSettings(settings);
  }

  startSpeechRecognition(
    lang: string,
    onResult: (transcript: string, isFinal: boolean) => void,
    onError: (error: string) => void,
    onEnd: () => void
  ): () => void {
    return this.activeBridge.startSpeechRecognition(lang, onResult, onError, onEnd);
  }

  speakBrowserTTS(
    text: string,
    voiceURI?: string,
    rate?: number,
    pitch?: number,
    onEnd?: () => void
  ): void {
    this.activeBridge.speakBrowserTTS(text, voiceURI, rate, pitch, onEnd);
  }

  playBase64Audio(
    base64Data: string,
    mimeType: string,
    onEnd?: () => void
  ): Promise<() => void> {
    return this.activeBridge.playBase64Audio(base64Data, mimeType, onEnd);
  }

  unlockAudio(): { beforeState: string; afterState: string } {
    return this.webBridge.unlockAudio();
  }

  stopAllAudio(): void {
    this.activeBridge.stopAllAudio();
  }

  vibrate(patternType?: 'light' | 'medium' | 'heavy' | 'success' | 'warning'): void {
    this.androidBridge.vibrate(patternType);
  }

  // Wake-word methods
  getWakeWordStatus(): Promise<WakeWordStatus> {
    return this.androidBridge.getWakeWordStatus();
  }

  setWakeWordEnabled(enabled: boolean): Promise<void> {
    return this.androidBridge.setWakeWordEnabled(enabled);
  }

  onWakeWord(callback: (keyword: string) => void): () => void {
    return this.androidBridge.onWakeWord(callback);
  }

  // Back navigation handlers
  onBackPressed(handler: () => boolean): () => void {
    return this.androidBridge.onBackPressed(handler);
  }

  triggerBackPressed(): boolean {
    return this.androidBridge.triggerBackPressed();
  }

  exitApp(): void {
    this.androidBridge.exitApp();
  }

  // Intent routing
  getInitialIntent(): Promise<AndroidIntentPayload | null> {
    return this.androidBridge.getInitialIntent();
  }

  onIntent(callback: (intent: AndroidIntentPayload) => void): () => void {
    return this.androidBridge.onIntent(callback);
  }

  openExternalUrl(url: string): Promise<boolean> {
    return this.androidBridge.openExternalUrl(url);
  }

  shareText(text: string, title?: string): Promise<boolean> {
    return this.androidBridge.shareText(text, title);
  }

  showToast(message: string, isLong = false): void {
    this.androidBridge.showToast(message, isLong);
  }

  getDeviceInfo(): Promise<AndroidDeviceInfo> {
    return this.androidBridge.getDeviceInfo();
  }
}

// Global Singleton Bridge Instance
export const platformBridge = new UnifiedPlatformBridge();
