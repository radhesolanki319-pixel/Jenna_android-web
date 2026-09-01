import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  User,
  Sparkles,
  Volume2,
  Brain,
  Palette,
  Shield,
  Check,
  Download,
  Trash2,
  ExternalLink,
  Info,
  Layers,
  HeartHandshake,
  Cpu,
  RefreshCw,
  AlertTriangle,
  Play,
  CheckCircle2,
  Activity,
  VolumeX,
  Mic,
  Radio,
  KeyRound,
} from 'lucide-react';
import { JennaSettings } from '../types';
import { memoryService } from '../core/memoryStore';
import { conversationService } from '../core/conversationStore';
import { speechService } from '../core/speechService';
import { platformBridge } from '../core/bridge';
import { apiKeyService } from '../core/apiKeyStore';
import { AVAILABLE_MODELS } from '../core/ai';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: JennaSettings;
  onUpdateSettings: (updates: Partial<JennaSettings>) => Promise<void>;
  onExportAllData: () => void;
  onOpenMemoryHub: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onExportAllData,
  onOpenMemoryHub,
}) => {
  const [activeTab, setActiveTab] = useState<
    'jenna' | 'ai' | 'voice' | 'memory' | 'appearance' | 'account'
  >('jenna');

  const [localSettings, setLocalSettings] = useState<JennaSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Gemini API key (bring-your-own-key) state
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasLocalApiKey, setHasLocalApiKey] = useState(apiKeyService.has());
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyNotice, setApiKeyNotice] = useState<string | null>(null);
  const [serverHasKey, setServerHasKey] = useState<'checking' | 'yes' | 'no'>('checking');

  const [availableBrowserVoices, setAvailableBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [diagnosticTestStatus, setDiagnosticTestStatus] = useState<
    'idle' | 'testing' | 'playing' | 'success' | 'error'
  >('idle');
  const [diagnosticInfo, setDiagnosticInfo] = useState<{
    status: string;
    autoTTS: boolean;
    engine: string;
    audioContextBefore: string;
    audioContextAfter: string;
    speechSynthSupport: boolean;
    voicesCount: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        const v = window.speechSynthesis.getVoices();
        setAvailableBrowserVoices(v);
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
      return () => {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.onvoiceschanged = null;
        }
      };
    }
  }, []);

  // Track locally-connected Gemini API key changes
  useEffect(() => {
    const unsub = apiKeyService.subscribe(() => {
      setHasLocalApiKey(apiKeyService.has());
    });
    setHasLocalApiKey(apiKeyService.has());
    return unsub;
  }, []);

  // Check whether the server itself has an env-configured key (when AI tab opens)
  useEffect(() => {
    if (!isOpen || activeTab !== 'ai') return;
    let cancelled = false;
    setServerHasKey('checking');
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setServerHasKey(data.hasApiKey ? 'yes' : 'no');
      })
      .catch(() => {
        if (!cancelled) setServerHasKey('no');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab]);

  const handleSaveApiKey = () => {
    const error = apiKeyService.save(apiKeyInput);
    if (error) {
      setApiKeyError(error);
      setApiKeyNotice(null);
      return;
    }
    setApiKeyError(null);
    setApiKeyInput('');
    setHasLocalApiKey(true);
    setApiKeyNotice('Gemini API key connected. Jenna is activated in this browser.');
  };

  const handleClearApiKey = () => {
    apiKeyService.clear();
    setHasLocalApiKey(false);
    setApiKeyError(null);
    setApiKeyNotice('API key removed from this browser.');
  };

  const handleTestVoiceDiagnostic = async () => {
    setDiagnosticTestStatus('testing');

    // 1. Direct user gesture: Unlock AudioContext and speech synthesis
    const { beforeState, afterState } = platformBridge.unlockAudio();

    const synthSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const availableVoices = synthSupported ? window.speechSynthesis.getVoices() : [];
    const selectedVoiceURI = localSettings.voice.browserVoiceURI || (availableVoices[0]?.voiceURI ?? 'system-default');

    // 2. Log to console clearly:
    console.log('[Jenna Voice Diagnostic] ========================================');
    console.log('[Jenna Voice Diagnostic] 🧪 RUNNING VOICE ENVIRONMENT TEST');
    console.log('[Jenna Voice Diagnostic] Trigger: Direct user gesture (Settings Test Voice Button)');
    console.log('[Jenna Voice Diagnostic] Auto-TTS setting:', localSettings.voice.autoPlayTTS ? 'ENABLED' : 'DISABLED');
    console.log('[Jenna Voice Diagnostic] Selected engine:', localSettings.voice.ttsEngine);
    console.log('[Jenna Voice Diagnostic] SpeechSynthesis support:', synthSupported ? 'YES' : 'NO');
    console.log('[Jenna Voice Diagnostic] Voices count:', availableVoices.length);
    console.log('[Jenna Voice Diagnostic] Selected voiceURI:', selectedVoiceURI);
    console.log('[Jenna Voice Diagnostic] AudioContext state before unlock:', beforeState);
    console.log('[Jenna Voice Diagnostic] AudioContext state after unlock:', afterState);
    console.log('[Jenna Voice Diagnostic] Gemini Voice tone:', localSettings.voice.geminiVoice);
    console.log('[Jenna Voice Diagnostic] Speech Rate:', localSettings.voice.speechRate, '| Pitch:', localSettings.voice.speechPitch);

    const testText = 'Jenna voice test successful.';
    console.log(`[Jenna Voice Diagnostic] 📢 Play called with test text: "${testText}"`);

    setDiagnosticInfo({
      status: 'Playing...',
      autoTTS: localSettings.voice.autoPlayTTS,
      engine: localSettings.voice.ttsEngine,
      audioContextBefore: beforeState,
      audioContextAfter: afterState,
      speechSynthSupport: synthSupported,
      voicesCount: availableVoices.length,
    });

    try {
      setDiagnosticTestStatus('playing');
      await speechService.speak('test-voice-diagnostic', {
        text: testText,
        engine: localSettings.voice.ttsEngine,
        geminiVoice: localSettings.voice.geminiVoice,
        browserVoiceURI: localSettings.voice.browserVoiceURI,
        rate: localSettings.voice.speechRate,
        pitch: localSettings.voice.speechPitch,
        onSuccess: () => {
          console.log('[Jenna Voice Diagnostic] ✅ Playback Success: Voice output completed cleanly.');
          console.log('[Jenna Voice Diagnostic] ========================================');
          setDiagnosticTestStatus('success');
          setDiagnosticInfo((prev) => (prev ? { ...prev, status: 'Success: Audio completed' } : null));
          setTimeout(() => setDiagnosticTestStatus('idle'), 4000);
        },
        onError: (err) => {
          console.error('[Jenna Voice Diagnostic] ❌ Playback Error:', err);
          console.log('[Jenna Voice Diagnostic] ========================================');
          setDiagnosticTestStatus('error');
          setDiagnosticInfo((prev) =>
            prev ? { ...prev, status: 'Playback Error', error: String(err?.message || err) } : null
          );
        },
      });
      console.log('[Jenna Voice Diagnostic] 🚀 Play invocation dispatched.');
    } catch (err: any) {
      console.error('[Jenna Voice Diagnostic] ❌ Play invocation error:', err);
      console.log('[Jenna Voice Diagnostic] ========================================');
      setDiagnosticTestStatus('error');
      setDiagnosticInfo((prev) =>
        prev ? { ...prev, status: 'Invocation Error', error: String(err?.message || err) } : null
      );
    }
  };

  if (!isOpen) return null;

  const totalMemories = memoryService.getAll().length;
  const totalConversations = conversationService.getConversations().length;
  const currentMessagesCount = conversationService.getCurrentMessages().length;

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3000);
  };

  const handleSave = async () => {
    await onUpdateSettings(localSettings);
    setIsSaved(true);
    showNotification('Settings saved and persisted.');
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleResetCurrentChat = async () => {
    const activeId = conversationService.getActiveConversationId();
    if (activeId) {
      await conversationService.deleteConversation(activeId);
      await conversationService.createNewConversation();
      showNotification('Active conversation reset.');
    }
  };

  const handleFactoryReset = async () => {
    try {
      localStorage.clear();
      showNotification('All data reset. Reloading application...');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch {
      showNotification('Failed to clear local storage.');
    }
  };

  const navItems = [
    { id: 'jenna', label: 'Jenna & Identity', icon: HeartHandshake },
    { id: 'ai', label: 'AI Engine', icon: Cpu },
    { id: 'voice', label: 'Voice & Speech', icon: Volume2 },
    { id: 'memory', label: 'Long-Term Memory', icon: Brain },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'account', label: 'Account & Session', icon: Shield },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="settings-modal"
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-white text-base">Jenna Settings</h2>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Phase 1
                </span>
              </div>
              <p className="text-xs text-slate-400">Configure Jenna's identity, conversational behavior, models, and session storage</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback / Notice */}
        {actionNotice && (
          <div className="px-6 py-2 bg-indigo-950/90 border-b border-indigo-800/60 text-xs text-indigo-200 flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>{actionNotice}</span>
            </div>
            <button onClick={() => setActionNotice(null)} className="text-indigo-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Layout: Sidebar Tabs + Content */}
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
          {/* Navigation Tabs */}
          <div className="w-full sm:w-56 p-3 border-b sm:border-b-0 sm:border-r border-slate-800 bg-slate-950/40 flex sm:flex-col gap-1 overflow-x-auto shrink-0 scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`tab-settings-${item.id}`}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors shrink-0 text-left cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content Pane */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 1. Jenna & Identity */}
            {activeTab === 'jenna' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/30 to-slate-900 border border-indigo-800/30 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/30">
                    <HeartHandshake className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Jenna Personal Assistant Identity</h4>
                    <p className="text-[11px] text-slate-400">
                      Personal, caring, emotionally intuitive, and context-aware companion across text and voice.
                    </p>
                  </div>
                </div>

                {/* User Identity Card */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-xs">
                        {(localSettings.profile.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <span>User Identity & Session</span>
                          <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Active Session
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          ID: {localSettings.profile.id || 'usr_local_default'}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 text-right">
                      <span className="text-[10px] text-slate-400 block">Auth: Device Sandbox</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Your Name or Preferred Title
                      </label>
                      <input
                        type="text"
                        value={localSettings.profile.name}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            profile: { ...localSettings.profile, name: e.target.value },
                          })
                        }
                        placeholder="e.g. Alex"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        User Handle / Identifier
                      </label>
                      <input
                        type="text"
                        value={localSettings.profile.handle || ''}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            profile: { ...localSettings.profile, handle: e.target.value },
                          })
                        }
                        placeholder="e.g. @alex"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Jenna remembers your identity and personalizes all conversations and long-term memory across page reloads.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Conversational Personality & Style
                  </label>
                  <select
                    value={localSettings.profile.preferredTone}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        profile: {
                          ...localSettings.profile,
                          preferredTone: e.target.value as any,
                        },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="warm_conversational">
                      Warm, Caring & Affectionate (Default — Natural Hinglish, supportive, emotional presence)
                    </option>
                    <option value="creative_intuitive">
                      Playful & Casual (Lighthearted banter, witty, cheerful)
                    </option>
                    <option value="direct_concise">
                      Direct & Concise (Crisp bullet points, high efficiency)
                    </option>
                    <option value="analytical_deep">
                      Analytical & Deep (Technical, structured, comprehensive explanations)
                    </option>
                  </select>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Multilingual & Roman Hindi / Hinglish</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Jenna responds naturally in authentic Roman Hindi / Hinglish whenever you chat in that style, seamlessly code-switching with natural warmth and optional terms of endearment (Babu, Baby, Meri jaan) when fitting.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Standing Directives / Custom Guidelines
                  </label>
                  <textarea
                    rows={3}
                    value={localSettings.profile.customInstructions}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        profile: {
                          ...localSettings.profile,
                          customInstructions: e.target.value,
                        },
                      })
                    }
                    placeholder="e.g. Always structure coding solutions with TypeScript best practices; provide concise summaries..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-hidden focus:border-indigo-500 leading-relaxed font-sans"
                  />
                </div>
              </div>
            )}

            {/* 2. AI Engine */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                {/* Gemini API Connection (Bring Your Own Key) */}
                <div
                  className={`p-3.5 rounded-xl border space-y-2.5 ${
                    hasLocalApiKey
                      ? 'bg-emerald-950/20 border-emerald-800/50'
                      : serverHasKey === 'yes'
                      ? 'bg-slate-950/60 border-slate-800'
                      : 'bg-amber-950/20 border-amber-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <KeyRound
                        className={`w-3.5 h-3.5 ${hasLocalApiKey ? 'text-emerald-400' : 'text-amber-400'}`}
                      />
                      Gemini API Connection
                    </label>
                    {hasLocalApiKey ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-300 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </span>
                    ) : serverHasKey === 'yes' ? (
                      <span className="text-[11px] text-slate-400">Server key active</span>
                    ) : serverHasKey === 'checking' ? (
                      <span className="text-[11px] text-slate-500">Checking…</span>
                    ) : (
                      <span className="text-[11px] text-amber-300 font-semibold">Not connected</span>
                    )}
                  </div>

                  {hasLocalApiKey ? (
                    <>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Your Gemini API key is saved in this browser and attached only to your own
                        requests. Jenna is fully activated.
                      </p>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleClearApiKey}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium cursor-pointer transition-colors"
                        >
                          Remove key
                        </button>
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                        >
                          Manage keys <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {serverHasKey === 'yes'
                          ? 'A server API key is already active. You can additionally connect your own key below to use your personal quota.'
                          : 'Paste your Google Gemini API key to activate Jenna. It is stored only in this browser and used solely for your own requests.'}
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          inputMode="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="Paste your API key (starts with AIza…)"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveApiKey();
                          }}
                          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 placeholder:font-sans focus:outline-hidden focus:border-indigo-500"
                        />
                        <button
                          onClick={handleSaveApiKey}
                          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          Connect
                        </button>
                      </div>
                      {apiKeyError && (
                        <p className="text-[11px] text-rose-400 leading-relaxed">{apiKeyError}</p>
                      )}
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                      >
                        Get a free API key from Google AI Studio <ExternalLink className="w-3 h-3" />
                      </a>
                    </>
                  )}
                  {apiKeyNotice && (
                    <p className="text-[11px] text-emerald-300">{apiKeyNotice}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Active AI Model & Architecture
                  </label>
                  <select
                    value={localSettings.ai.model}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        ai: { ...localSettings.ai, model: e.target.value },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500 font-mono"
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} — {m.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      Creativity & Temperature ({localSettings.ai.temperature})
                    </label>
                    <span className="text-[11px] text-slate-400">
                      {localSettings.ai.temperature < 0.4
                        ? 'Precise & Focused'
                        : localSettings.ai.temperature > 0.8
                        ? 'Highly Creative'
                        : 'Balanced & Natural'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.2"
                    step="0.1"
                    value={localSettings.ai.temperature}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        ai: { ...localSettings.ai, temperature: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <label className="flex items-center justify-between text-xs cursor-pointer">
                    <span className="font-semibold text-slate-200">Progressive SSE Streaming</span>
                    <input
                      type="checkbox"
                      checked={localSettings.ai.streamResponses}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          ai: { ...localSettings.ai, streamResponses: e.target.checked },
                        })
                      }
                      className="rounded-sm bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Streams responses progressively token-by-token for immediate interactive feedback.
                  </p>
                </div>
              </div>
            )}

            {/* 3. Voice & Speech */}
            {activeTab === 'voice' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Speech-to-Text (STT) Language
                  </label>
                  <select
                    value={localSettings.voice.sttLanguage}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        voice: { ...localSettings.voice, sttLanguage: e.target.value },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="en-US">English (United States)</option>
                    <option value="en-IN">English (India / Hinglish)</option>
                    <option value="hi-IN">Hindi (India)</option>
                    <option value="en-GB">English (United Kingdom)</option>
                    <option value="es-ES">Spanish (Spain)</option>
                    <option value="fr-FR">French (France)</option>
                    <option value="de-DE">German (Germany)</option>
                    <option value="ja-JP">Japanese (Japan)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Text-to-Speech (TTS) Voice Engine
                  </label>
                  <select
                    value={localSettings.voice.ttsEngine}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        voice: { ...localSettings.voice, ttsEngine: e.target.value as any },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="gemini_neural">Gemini Neural TTS (gemini-3.1-flash-tts-preview — HD Neural Audio)</option>
                    <option value="browser_native">Web Speech Synthesis (Low-latency offline fallback)</option>
                  </select>
                </div>

                {localSettings.voice.ttsEngine === 'gemini_neural' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Jenna Voice Tone & Character
                    </label>
                    <select
                      value={localSettings.voice.geminiVoice}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          voice: { ...localSettings.voice, geminiVoice: e.target.value as any },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                    >
                      <option value="Kore">Kore (Warm, melodic, empathetic female voice)</option>
                      <option value="Zephyr">Zephyr (Bright, cheerful, crisp tone)</option>
                      <option value="Puck">Puck (Playful, expressive)</option>
                      <option value="Fenrir">Fenrir (Deep, authoritative)</option>
                      <option value="Charon">Charon (Measured, deep tone)</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Browser System Voice ({availableBrowserVoices.length} available)
                    </label>
                    <select
                      value={localSettings.voice.browserVoiceURI || ''}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          voice: { ...localSettings.voice, browserVoiceURI: e.target.value },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                    >
                      <option value="">Default System Voice</option>
                      {availableBrowserVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      Speech Rate ({localSettings.voice.speechRate}x)
                    </label>
                  </div>
                  <input
                    type="range"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    value={localSettings.voice.speechRate}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        voice: { ...localSettings.voice, speechRate: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <label className="flex items-center justify-between text-xs cursor-pointer">
                    <span className="font-semibold text-slate-200">Auto-Play Voice Responses</span>
                    <input
                      type="checkbox"
                      checked={localSettings.voice.autoPlayTTS}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          voice: { ...localSettings.voice, autoPlayTTS: e.target.checked },
                        })
                      }
                      className="rounded-sm bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Automatically plays vocal synthesis when Jenna finishes generating an assistant reply.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <label className="flex items-center justify-between text-xs cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4 text-indigo-400" />
                      <span className="font-semibold text-slate-200">Android Wake-Word Detection ("Hey Jenna")</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.voice.wakeWordEnabled !== false}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setLocalSettings({
                          ...localSettings,
                          voice: { ...localSettings.voice, wakeWordEnabled: enabled },
                        });
                        platformBridge.setWakeWordEnabled(enabled);
                      }}
                      className="rounded-sm bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Passively listens for the wake word on Android devices to activate Jenna hands-free with haptic and audio confirmation.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <label className="flex items-center justify-between text-xs cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-rose-400" />
                      <span className="font-semibold text-slate-200">Continuous / Background Voice Listening</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(localSettings.voice.continuousVoiceMode)}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setLocalSettings({
                          ...localSettings,
                          voice: { ...localSettings.voice, continuousVoiceMode: enabled },
                        });
                        platformBridge.setContinuousVoiceEnabled(enabled);
                      }}
                      className="rounded-sm bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Enables fluid back-and-forth hands-free conversational turns and background listening service when the app is not in the active foreground.
                  </p>
                </div>

                {/* Phase 1 Voice Environment Diagnostic Test */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border border-indigo-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                        <Activity className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>TTS Environment Diagnostic Test</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300 font-mono">
                            Phase 1 Diagnostic
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Direct user-gesture audio test to diagnose Auto-TTS, manual playback, AudioContext unlock & browser autoplay restrictions.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      id="btn-test-voice-tts"
                      type="button"
                      onClick={handleTestVoiceDiagnostic}
                      disabled={diagnosticTestStatus === 'testing' || diagnosticTestStatus === 'playing'}
                      className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-md ${
                        diagnosticTestStatus === 'playing'
                          ? 'bg-amber-600 text-white animate-pulse'
                          : diagnosticTestStatus === 'testing'
                          ? 'bg-indigo-700 text-white'
                          : diagnosticTestStatus === 'success'
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : diagnosticTestStatus === 'error'
                          ? 'bg-rose-600 hover:bg-rose-500 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25'
                      }`}
                    >
                      {diagnosticTestStatus === 'testing' ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Unlocking & Requesting Audio...</span>
                        </>
                      ) : diagnosticTestStatus === 'playing' ? (
                        <>
                          <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                          <span>Playing: "Jenna voice test successful."</span>
                        </>
                      ) : diagnosticTestStatus === 'success' ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          <span>Voice Test Passed (Click to Re-test)</span>
                        </>
                      ) : diagnosticTestStatus === 'error' ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-white" />
                          <span>Test Failed (Check Console)</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Test Voice Output</span>
                        </>
                      )}
                    </button>

                    {(diagnosticTestStatus === 'playing' || diagnosticTestStatus === 'testing') && (
                      <button
                        type="button"
                        onClick={() => {
                          speechService.stopPlayback();
                          setDiagnosticTestStatus('idle');
                        }}
                        className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                      >
                        Stop
                      </button>
                    )}
                  </div>

                  {diagnosticInfo && (
                    <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] font-mono space-y-1.5 text-slate-300">
                      <div className="flex justify-between items-center text-indigo-300 font-semibold border-b border-slate-800/60 pb-1">
                        <span>Diagnostic Status</span>
                        <span>{diagnosticInfo.status}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pt-0.5 text-[10px]">
                        <div>Auto-TTS: <span className="text-white">{diagnosticInfo.autoTTS ? 'Enabled' : 'Disabled'}</span></div>
                        <div>Engine: <span className="text-white">{diagnosticInfo.engine}</span></div>
                        <div>AudioContext State: <span className="text-white">{diagnosticInfo.audioContextBefore} → {diagnosticInfo.audioContextAfter}</span></div>
                        <div>SpeechSynthesis: <span className="text-white">{diagnosticInfo.speechSynthSupport ? `Supported (${diagnosticInfo.voicesCount} voices)` : 'Not Supported'}</span></div>
                      </div>
                      {diagnosticInfo.error && (
                        <div className="text-rose-400 pt-1 text-[10px]">
                          Error Details: {diagnosticInfo.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. Long-Term Memory */}
            {activeTab === 'memory' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-800/40">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-300">
                      <Brain className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white">Long-Term Memory Hub</h4>
                      <p className="text-[11px] text-slate-400">
                        {totalMemories} persistent facts stored across 5 categories.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenMemoryHub();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Open Hub</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <label className="flex items-center justify-between text-xs cursor-pointer">
                    <span className="font-semibold text-slate-200">Enable Long-Term Memory Injection</span>
                    <input
                      type="checkbox"
                      checked={localSettings.memory.enabled}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          memory: { ...localSettings.memory, enabled: e.target.checked },
                        })
                      }
                      className="rounded-sm bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Injects relevant facts from your persistent memory store into Jenna's context. When disabled, memories are ignored during chat.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      Max Contextual Injected Facts ({localSettings.memory.maxInjectedMemories})
                    </label>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="20"
                    step="1"
                    value={localSettings.memory.maxInjectedMemories}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        memory: {
                          ...localSettings.memory,
                          maxInjectedMemories: parseInt(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* 5. Appearance */}
            {activeTab === 'appearance' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Theme Canvas</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'dark', label: 'Dark Slate' },
                      { id: 'amoled', label: 'OLED Pure Black' },
                      { id: 'light', label: 'Clean Light' },
                    ].map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() =>
                          setLocalSettings({
                            ...localSettings,
                            appearance: { ...localSettings.appearance, theme: theme.id as any },
                          })
                        }
                        className={`p-3 rounded-xl border text-xs font-medium text-center transition-all cursor-pointer ${
                          localSettings.appearance.theme === theme.id
                            ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-xs'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Typography Scale
                  </label>
                  <select
                    value={localSettings.appearance.fontSize}
                    onChange={(e) =>
                      setLocalSettings({
                        ...localSettings,
                        appearance: { ...localSettings.appearance, fontSize: e.target.value as any },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="sm">Compact (13px)</option>
                    <option value="base">Standard (14px — Recommended)</option>
                    <option value="lg">Spacious (16px)</option>
                  </select>
                </div>
              </div>
            )}

            {/* 6. Account & Session */}
            {activeTab === 'account' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>Session Storage & Architecture</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Jenna operates offline-first using client-side isolated storage (IndexedDB + localStorage) and unified architecture ready for Android companion syncing.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-1">
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-slate-400 text-[10px] uppercase">Conversations</div>
                      <div className="font-semibold text-slate-200 mt-0.5">{totalConversations} saved</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-slate-400 text-[10px] uppercase">Memories</div>
                      <div className="font-semibold text-slate-200 mt-0.5">{totalMemories} facts</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-slate-400 text-[10px] uppercase">Active Messages</div>
                      <div className="font-semibold text-slate-200 mt-0.5">{currentMessagesCount} turns</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={onExportAllData}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Complete Jenna State (JSON Backup)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetCurrentChat}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                    <span>Clear Current Conversation</span>
                  </button>

                  {!showResetConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowResetConfirm(true)}
                      className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 text-xs font-medium text-rose-400 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Reset Application Data (Factory Reset)</span>
                    </button>
                  ) : (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-rose-300 font-semibold">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Are you sure? This will delete all conversations and memories.</span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowResetConfirm(false)}
                          className="px-3 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleFactoryReset}
                          className="px-3 py-1 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-500 font-medium"
                        >
                          Yes, Delete Everything
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {isSaved && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                Settings saved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              id="btn-save-settings"
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm transition-colors cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

