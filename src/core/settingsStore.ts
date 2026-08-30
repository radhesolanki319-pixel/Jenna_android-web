/**
 * Jenna Settings and Configuration Store
 * Persistent settings for Jenna persona, AI parameters, voice engine, appearance, and platform simulation.
 */

import { JennaSettings, UserProfile, UserIdentity } from '../types';
import { platformBridge } from './bridge';

// Jenna's original Phase 2 model configuration is intentionally locked.
// The chat server already owns the same fallback chain:
// gemini-3.7-flash -> gemini-3.1-flash-lite -> gemini-flash-latest
const LOCKED_JENNA_MODEL = 'gemini-3.7-flash';

export class JennaSettingsService {
  private settings: JennaSettings | null = null;
  private isLoaded = false;
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

  async load(): Promise<JennaSettings> {
    if (this.isLoaded && this.settings) {
      return this.settings;
    }

    const loadedSettings = await platformBridge.getSettings();
    const loadedModel = loadedSettings.ai?.model;

    // Normalize any stale/foreign model selection back to Jenna's locked model.
    this.settings = {
      ...loadedSettings,
      ai: {
        ...loadedSettings.ai,
        model: LOCKED_JENNA_MODEL,
      },
    };

    this.isLoaded = true;

    // Persist the correction so an old Gemini 2.x or other model value cannot
    // return after a reload.
    if (loadedModel !== LOCKED_JENNA_MODEL) {
      await platformBridge.saveSettings(this.settings);
    }

    this.applyTheme(this.settings);
    this.notify();
    return this.settings;
  }

  get(): JennaSettings {
    if (!this.settings) {
      // Fallback defaults
      return {
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
          model: LOCKED_JENNA_MODEL,
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
    }
    return this.settings;
  }

  getUserIdentity(): UserIdentity {
    return this.get().profile;
  }

  async updateUserIdentity(partial: Partial<UserIdentity>): Promise<void> {
    const current = this.get();
    const updatedProfile: UserProfile = {
      ...current.profile,
      ...partial,
      lastActiveAt: Date.now(),
    };
    await this.update({ profile: updatedProfile });
    await platformBridge.saveUserIdentity(updatedProfile);
  }

  async update(partial: Partial<JennaSettings>): Promise<void> {
    const current = this.get();
    const updated: JennaSettings = {
      ...current,
      ...partial,
      profile: { ...current.profile, ...(partial.profile || {}) },
      // Hard-lock the model regardless of what the UI or persisted settings request.
      ai: {
        ...current.ai,
        ...(partial.ai || {}),
        model: LOCKED_JENNA_MODEL,
      },
      memory: { ...current.memory, ...(partial.memory || {}) },
      voice: { ...current.voice, ...(partial.voice || {}) },
      appearance: { ...current.appearance, ...(partial.appearance || {}) },
      platform: { ...current.platform, ...(partial.platform || {}) },
    };

    this.settings = updated;
    await platformBridge.saveSettings(updated);
    this.applyTheme(updated);
    this.notify();
  }

  private applyTheme(settings: JennaSettings) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // Theme class
    if (settings.appearance.theme === 'light') {
      root.classList.add('theme-light');
      root.classList.remove('theme-amoled');
      document.body.className = 'h-full bg-slate-50 text-slate-900 antialiased';
    } else if (settings.appearance.theme === 'amoled') {
      root.classList.add('theme-amoled');
      root.classList.remove('theme-light');
      document.body.className = 'h-full bg-black text-white antialiased';
    } else {
      root.classList.remove('theme-light', 'theme-amoled');
      document.body.className = 'h-full bg-slate-950 text-slate-100 antialiased';
    }
  }
}

export const settingsService = new JennaSettingsService();