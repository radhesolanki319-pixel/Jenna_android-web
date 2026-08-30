import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WebJennaBridge,
  AndroidJennaBridge,
  UnifiedPlatformBridge,
  platformBridge,
} from '../src/core/bridge';

describe('Cross-Platform Bridge Architecture (Phase 1 Foundation)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('WebJennaBridge', () => {
    let bridge: WebJennaBridge;

    beforeEach(() => {
      bridge = new WebJennaBridge();
    });

    it('should report web platform capabilities', () => {
      const caps = bridge.getCapabilities();
      expect(caps.platform).toBe('web');
      expect(caps.storageType).toBe('indexeddb_localstorage');
      expect(typeof caps.isOnline).toBe('boolean');
    });

    it('should perform complete CRUD cycle on conversations in localStorage', async () => {
      const conv = {
        id: 'test_conv_web',
        title: 'Web Bridge Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      };

      await bridge.saveConversation(conv);
      const retrieved = await bridge.getConversations();
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].id).toBe('test_conv_web');

      await bridge.deleteConversation('test_conv_web');
      const emptyList = await bridge.getConversations();
      expect(emptyList.length).toBe(0);
    });

    it('should store, retrieve, and sanitize message lists', async () => {
      const messages = [
        {
          id: 'msg_1',
          conversationId: 'conv_123',
          role: 'user' as const,
          content: 'Hello Jenna',
          timestamp: Date.now(),
          status: 'complete' as const,
        },
        {
          id: 'msg_2',
          conversationId: 'conv_123',
          role: 'assistant' as const,
          content: 'Hello! How can I help?',
          timestamp: Date.now(),
          status: 'streaming' as const, // Should be sanitized to complete if content exists
        },
      ];

      await bridge.saveMessages('conv_123', messages);
      const retrieved = await bridge.getMessages('conv_123');
      expect(retrieved.length).toBe(2);
      expect(retrieved[1].status).toBe('complete');
    });

    it('should manage persistent user identity and session profile', async () => {
      const identity = await bridge.getUserIdentity();
      expect(identity).toBeDefined();
      expect(identity.id).toBeDefined();

      const updated = await bridge.saveUserIdentity({
        name: 'Jordan',
        handle: '@jordan_dev',
      });

      expect(updated.name).toBe('Jordan');
      expect(updated.handle).toBe('@jordan_dev');

      const reloaded = await bridge.getUserIdentity();
      expect(reloaded.name).toBe('Jordan');
    });
  });

  describe('AndroidJennaBridge & Native Interop', () => {
    it('should gracefully fallback to Web bridge when Android JavascriptInterface is absent', () => {
      const androidBridge = new AndroidJennaBridge();
      expect(androidBridge.isAvailable()).toBe(false);
      const caps = androidBridge.getCapabilities();
      expect(caps.platform).toBe('web');
    });

    it('should detect simulated Android native environment and delegate calls', async () => {
      const mockNative = {
        getConversations: vi.fn().mockReturnValue(JSON.stringify([{ id: 'android_c1', title: 'Android Chat', createdAt: 1, updatedAt: 1, messageCount: 1 }])),
        saveConversation: vi.fn(),
        deleteConversation: vi.fn(),
        getMessages: vi.fn().mockReturnValue('[]'),
        saveMessages: vi.fn(),
        getMemories: vi.fn().mockReturnValue('[]'),
        saveMemory: vi.fn(),
        deleteMemory: vi.fn(),
        clearAllMemories: vi.fn(),
        getUserIdentity: vi.fn().mockReturnValue(JSON.stringify({ id: 'usr_android', name: 'Android User' })),
        saveUserIdentity: vi.fn().mockReturnValue(JSON.stringify({ id: 'usr_android', name: 'Updated Android User' })),
        getSettings: vi.fn().mockReturnValue('{}'),
        saveSettings: vi.fn(),
        startSpeechRecognition: vi.fn().mockReturnValue(true),
        stopSpeechRecognition: vi.fn(),
        speakNativeTTS: vi.fn(),
        stopTTS: vi.fn(),
        playBase64Audio: vi.fn().mockReturnValue(true),
        stopAudio: vi.fn(),
        getWakeWordStatus: vi.fn().mockReturnValue(JSON.stringify({ enabled: true, isListening: true, keyword: 'Hey Jenna' })),
        setWakeWordEnabled: vi.fn(),
        getContinuousVoiceStatus: vi.fn().mockReturnValue(JSON.stringify({ enabled: true, isListening: true, isBackgroundActive: true })),
        setContinuousVoiceEnabled: vi.fn(),
        setBackIntercepted: vi.fn(),
        exitApp: vi.fn(),
        getInitialIntent: vi.fn().mockReturnValue(JSON.stringify({ action: 'android.intent.action.MAIN' })),
        openExternalUrl: vi.fn().mockReturnValue(true),
        shareText: vi.fn().mockReturnValue(true),
        vibrate: vi.fn(),
        showToast: vi.fn(),
        getDeviceInfo: vi.fn().mockReturnValue(JSON.stringify({ platform: 'Android', brand: 'Google', model: 'Pixel 9', sdkVersion: 35, appVersion: '1.0.0' })),
      };

      (window as any).JennaAndroid = mockNative;
      const androidBridge = new AndroidJennaBridge();

      expect(androidBridge.isAvailable()).toBe(true);
      const caps = androidBridge.getCapabilities();
      expect(caps.platform).toBe('android');
      expect(caps.storageType).toBe('room_sqlite');

      const convs = await androidBridge.getConversations();
      expect(mockNative.getConversations).toHaveBeenCalled();
      expect(convs[0].title).toBe('Android Chat');

      const wakeWord = await androidBridge.getWakeWordStatus();
      expect(wakeWord.enabled).toBe(true);
      expect(wakeWord.keyword).toBe('Hey Jenna');

      const contVoice = await androidBridge.getContinuousVoiceStatus();
      expect(contVoice.enabled).toBe(true);
      expect(contVoice.isBackgroundActive).toBe(true);

      const bgAssistant = await androidBridge.getBackgroundAssistantStatus();
      expect(bgAssistant.enabled).toBe(true);
      expect(bgAssistant.isBackgroundActive).toBe(true);

      await androidBridge.setContinuousVoiceEnabled(true);
      expect(mockNative.setContinuousVoiceEnabled).toHaveBeenCalledWith(true);

      await androidBridge.setBackgroundAssistantEnabled(false);
      expect(mockNative.setContinuousVoiceEnabled).toHaveBeenCalledWith(false);

      const devInfo = await androidBridge.getDeviceInfo();
      expect(devInfo.brand).toBe('Google');
      expect(devInfo.model).toBe('Pixel 9');

      // Cleanup
      delete (window as any).JennaAndroid;
    });

    it('should register and execute back-press handlers in LIFO stack order', () => {
      const androidBridge = new AndroidJennaBridge();
      const executionOrder: string[] = [];

      const unreg1 = androidBridge.onBackPressed(() => {
        executionOrder.push('handler 1');
        return false;
      });

      const unreg2 = androidBridge.onBackPressed(() => {
        executionOrder.push('handler 2 (modal)');
        return true; // Intercepted
      });

      // Simulate native back event
      const handled = (window as any).__onJennaAndroidBackPressed();
      expect(handled).toBe(true);
      expect(executionOrder).toEqual(['handler 2 (modal)']);

      unreg2();
      unreg1();
    });

    it('should dispatch incoming intent payloads to registered listeners', () => {
      const androidBridge = new AndroidJennaBridge();
      const received: any[] = [];

      const unregister = androidBridge.onIntent((payload) => {
        received.push(payload);
      });

      (window as any).__onJennaAndroidIntent({
        action: 'android.intent.action.SEND',
        text: 'Shared article text from Chrome',
      });

      expect(received.length).toBe(1);
      expect(received[0].text).toBe('Shared article text from Chrome');
      unregister();
    });

    it('should handle wake-word listener registration and dispatching', () => {
      const androidBridge = new AndroidJennaBridge();
      const keywords: string[] = [];

      const unregister = androidBridge.onWakeWord((keyword) => {
        keywords.push(keyword);
      });

      (window as any).__onJennaAndroidWakeWord('Hey Jenna');
      expect(keywords.length).toBe(1);
      expect(keywords[0]).toBe('Hey Jenna');

      unregister();
      (window as any).__onJennaAndroidWakeWord('Hey Jenna');
      expect(keywords.length).toBe(1);
    });
  });

  describe('Singleton platformBridge facade', () => {
    it('should provide complete unified platform bridge APIs', () => {
      expect(platformBridge).toBeDefined();
      expect(typeof platformBridge.getConversations).toBe('function');
      expect(typeof platformBridge.getMemories).toBe('function');
      expect(typeof platformBridge.getSettings).toBe('function');
      expect(typeof platformBridge.getUserIdentity).toBe('function');
      expect(typeof platformBridge.vibrate).toBe('function');
      expect(typeof platformBridge.showToast).toBe('function');
    });
  });
});
