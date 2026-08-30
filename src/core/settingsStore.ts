/**
 * Jenna Settings and Configuration Store
 * Persistent settings for Jenna persona, AI parameters, voice engine, appearance, and platform simulation.
 */

import { JennaSettings } from '../types';
import { platformBridge } from './bridge';

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
    this.settings = await platformBridge.getSettings();
    this.isLoaded = true;
    this.applyTheme(this.settings);
    this.notify();
    return this.settings;
  }

  get(): JennaSettings {
    if (!this.settings) {
      // Fallback defaults
      return {
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
    }
    return this.settings;
  }

  async update(partial: Partial<JennaSettings>): Promise<void> {
    const current = this.get();
    const updated: JennaSettings = {
      ...current,
      ...partial,
      profile: { ...current.profile, ...(partial.profile || {}) },
      ai: { ...current.ai, ...(partial.ai || {}) },
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
