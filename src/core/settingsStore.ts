/**
 * Jenna Settings and Configuration Store
 * Persistent settings for Jenna persona, AI parameters, voice engine, appearance, and platform simulation.
 */

import { JennaSettings, UserProfile, UserIdentity } from '../types';
import { platformBridge } from './bridge';

// Jarvis Phase 2: the model lock was removed in favor of the ModelRouter.
// 'auto' delegates model selection to the server-side router (Gemini default);
// any explicit model id is honored when its provider is configured.
const DEFAULT_MODEL_SELECTION = 'auto';

// Legacy/stale persisted model ids that must migrate to 'auto'.
const LEGACY_MODEL_IDS = new Set([
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-2.5-flash',
]);

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

    // One-time migration: stale/legacy model ids (or missing value) → 'auto'.
    const migratedModel =
      !loadedModel || LEGACY_MODEL_IDS.has(loadedModel) ? DEFAULT_MODEL_SELECTION : loadedModel;

    this.settings = {
      ...loadedSettings,
      ai: {
        ...loadedSettings.ai,
        model: migratedModel,
      },
    };

    this.isLoaded = true;

    if (loadedModel !== migratedModel) {
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
          model: DEFAULT_MODEL_SELECTION,
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
      // Honor UI/persisted model selection; the server router validates availability.
      ai: {
        ...current.ai,
        ...(partial.ai || {}),
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