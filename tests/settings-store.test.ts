import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JennaSettingsService } from '../src/core/settingsStore';

describe('Settings & User Identity Service (Phase 1 Foundation)', () => {
  let settingsService: JennaSettingsService;

  beforeEach(() => {
    settingsService = new JennaSettingsService();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('should provide default settings with locked Jenna model gemini-3.7-flash', () => {
    const settings = settingsService.get();
    expect(settings).toBeDefined();
    expect(settings.profile.name).toBe('User');
    expect(settings.ai.model).toBe('gemini-3.7-flash');
    expect(settings.voice.geminiVoice).toBe('Kore');
    expect(settings.appearance.theme).toBe('dark');
  });

  it('should update profile and tone preferences', async () => {
    await settingsService.update({
      profile: {
        name: 'Alex Developer',
        handle: '@alex',
        preferredTone: 'direct_concise',
        customInstructions: 'Keep answers concise with code snippets.',
      },
    });

    const current = settingsService.get();
    expect(current.profile.name).toBe('Alex Developer');
    expect(current.profile.handle).toBe('@alex');
    expect(current.profile.preferredTone).toBe('direct_concise');
    expect(current.profile.customInstructions).toBe('Keep answers concise with code snippets.');
  });

  it('should update voice configuration and speech synthesis options', async () => {
    await settingsService.update({
      voice: {
        ttsEngine: 'browser_native',
        geminiVoice: 'Zephyr',
        speechRate: 1.2,
        speechPitch: 1.0,
        autoPlayTTS: false,
        sttLanguage: 'en-US',
        continuousVoiceMode: true,
      },
    });

    const current = settingsService.get();
    expect(current.voice.ttsEngine).toBe('browser_native');
    expect(current.voice.geminiVoice).toBe('Zephyr');
    expect(current.voice.speechRate).toBe(1.2);
    expect(current.voice.autoPlayTTS).toBe(false);
  });

  it('should enforce the locked Jenna model even if partial update requests another model', async () => {
    await settingsService.update({
      ai: {
        model: 'gemini-1.5-pro' as any,
        temperature: 0.8,
        enableThinking: true,
        streamResponses: true,
      },
    });

    const current = settingsService.get();
    // Model must remain locked to gemini-3.7-flash
    expect(current.ai.model).toBe('gemini-3.7-flash');
    expect(current.ai.temperature).toBe(0.8);
  });

  it('should retrieve and update user identity', async () => {
    const identity = settingsService.getUserIdentity();
    expect(identity.name).toBe('User');

    await settingsService.updateUserIdentity({
      name: 'Sam Altman',
      handle: '@sama',
    });

    const updated = settingsService.getUserIdentity();
    expect(updated.name).toBe('Sam Altman');
    expect(updated.handle).toBe('@sama');
  });

  it('should notify subscribers on setting updates', async () => {
    const listener = vi.fn();
    const unsub = settingsService.subscribe(listener);

    await settingsService.update({
      appearance: { theme: 'light', accentColor: 'cyan', fontSize: 'lg' },
    });

    expect(listener).toHaveBeenCalled();
    unsub();
  });
});
