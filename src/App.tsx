/**
 * Jenna AI Assistant - Core Application Entry Point
 * Phase 1 Foundation
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { MemoryModal } from './components/MemoryModal';
import { SettingsModal } from './components/SettingsModal';
import { DiagnosticModal } from './components/DiagnosticModal';
import { conversationService } from './core/conversationStore';
import { memoryService } from './core/memoryStore';
import { settingsService } from './core/settingsStore';
import { speechService } from './core/speechService';
import { platformBridge } from './core/bridge';
import { AgentStream, AgentRunState, initialRunState } from './core/agent/agentClient';
import { Conversation, Message, JennaSettings } from './types';
import { Smartphone, Monitor } from 'lucide-react';

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [settings, setSettings] = useState<JennaSettings>(settingsService.get());

  // Modal states
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Agent run state (plan, tool activity, approvals) for the active turn
  const [agentState, setAgentState] = useState<AgentRunState>(initialRunState());

  const abortControllerRef = useRef<AbortController | null>(null);
  const agentStreamRef = useRef<AgentStream | null>(null);

  // Initialize core stores & subscriptions
  useEffect(() => {
    let isMounted = true;

    async function initApp() {
      // 1. Load settings
      const loadedSettings = await settingsService.load();
      if (isMounted) setSettings(loadedSettings);

      // 2. Load memories
      const loadedMemories = await memoryService.load();
      if (isMounted) setMemoryCount(loadedMemories.length);

      // 3. Initialize conversation store
      await conversationService.init();
      if (isMounted) {
        setConversations([...conversationService.getConversations()]);
        setActiveConversationId(conversationService.getActiveConversationId());
        setMessages([...conversationService.getCurrentMessages()]);
      }
    }

    initApp();

    // Subscribe to changes
    const unsubConv = conversationService.subscribe(() => {
      if (isMounted) {
        setConversations([...conversationService.getConversations()]);
        setActiveConversationId(conversationService.getActiveConversationId());
        setMessages([...conversationService.getCurrentMessages()]);
      }
    });

    const unsubMem = memoryService.subscribe(() => {
      if (isMounted) {
        setMemoryCount(memoryService.getAll().length);
      }
    });

    const unsubSettings = settingsService.subscribe(() => {
      if (isMounted) {
        setSettings({ ...settingsService.get() });
      }
    });

    return () => {
      isMounted = false;
      unsubConv();
      unsubMem();
      unsubSettings();
    };
  }, []);

  // Synchronize theme & font size to DOM root
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light', 'theme-amoled');
    root.classList.add(`theme-${settings.appearance.theme || 'dark'}`);
  }, [settings.appearance.theme]);

  // Keyboard shortcut listener (Cmd+K / Ctrl+K for new chat)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleNewConversation();
      }
      if (e.key === 'Escape') {
        setIsMemoryOpen(false);
        setIsSettingsOpen(false);
        setIsDiagnosticsOpen(false);
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Android Native Integration: Hardware Back Button, Intents, and Wake-word
  useEffect(() => {
    // 1. Android Hardware Back Button Handler
    const unregisterBack = platformBridge.onBackPressed(() => {
      if (isMemoryOpen || isSettingsOpen || isDiagnosticsOpen || isMobileMenuOpen) {
        setIsMemoryOpen(false);
        setIsSettingsOpen(false);
        setIsDiagnosticsOpen(false);
        setIsMobileMenuOpen(false);
        return true;
      }
      if (isStreaming) {
        handleStopStreaming();
        return true;
      }
      return false;
    });

    // 2. Android Intent Listener (text share, assistant shortcuts, deep links)
    const unregisterIntent = platformBridge.onIntent((payload) => {
      if (payload.text?.trim()) {
        handleSendMessage(payload.text.trim());
      }
    });

    // 3. Initial Intent check on mount
    platformBridge.getInitialIntent().then((initialIntent) => {
      if (initialIntent?.text?.trim()) {
        handleSendMessage(initialIntent.text.trim());
      }
    });

    // 4. Native Wake-word Trigger Listener: Seamlessly start active voice assistant capture
    const unregisterWakeWord = platformBridge.onWakeWord(() => {
      platformBridge.vibrate('medium');
      platformBridge.showToast('Jenna is listening...', false);
      platformBridge.unlockAudio();

      // Automatically launch speech recognition into the active conversation
      speechService.startListening(
        settings.voice.sttLanguage || 'en-US',
        (transcript, isFinal) => {
          if (isFinal && transcript.trim()) {
            handleSendMessage(transcript.trim());
          }
        },
        (err) => {
          console.warn('[WakeWord STT] Error capturing query:', err);
        }
      );
    });

    return () => {
      unregisterBack();
      unregisterIntent();
      unregisterWakeWord();
    };
  }, [isMemoryOpen, isSettingsOpen, isDiagnosticsOpen, isMobileMenuOpen, isStreaming]);

  const handleSelectConversation = async (id: string) => {
    if (isStreaming) {
      handleStopStreaming();
    }
    await conversationService.selectConversation(id);
  };

  const handleNewConversation = async () => {
    if (isStreaming) {
      handleStopStreaming();
    }
    await conversationService.createNewConversation();
  };

  const handleDeleteConversation = async (id: string) => {
    await conversationService.deleteConversation(id);
  };

  const handleUpdateTitle = async (id: string, title: string) => {
    await conversationService.updateConversationTitle(id, title);
  };

  const handleTogglePin = async (id: string) => {
    await conversationService.togglePinConversation(id);
  };

  const handleUpdateSettings = async (updates: Partial<JennaSettings>) => {
    await settingsService.update(updates);
    const updated = settingsService.get();
    setSettings(updated);
    if (updates.voice?.continuousVoiceMode !== undefined) {
      platformBridge.setContinuousVoiceEnabled(updates.voice.continuousVoiceMode);
    }
  };

  const handleStopStreaming = useCallback(() => {
    if (agentStreamRef.current) {
      agentStreamRef.current.abort();
      agentStreamRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const handleResolveApproval = useCallback(
    (approvalId: string, approved: boolean, grantForRun: boolean) => {
      agentStreamRef.current?.approve(approvalId, approved, grantForRun);
    },
    []
  );

  const triggerContinuousVoiceNextTurn = useCallback(() => {
    const currentSettings = settingsService.get();
    if (!currentSettings.voice?.continuousVoiceMode) return;

    // Slight pause so the user perceives the turn transition naturally
    setTimeout(() => {
      if (abortControllerRef.current !== null) return;
      console.log('[Jenna Continuous Voice] 🎙️ Starting next conversational listening turn...');
      speechService.startListening(
        currentSettings.voice.sttLanguage || 'en-US',
        (transcript, isFinal) => {
          if (isFinal && transcript.trim()) {
            handleSendMessage(transcript.trim());
          }
        },
        (err) => {
          console.log('[Jenna Continuous Voice] Turn finished or timeout:', err);
        }
      );
    }, 450);
  }, []);

  // Send message and handle SSE streaming
  const handleSendMessage = async (content: string, isRetry = false) => {
    const activeConvId = conversationService.getActiveConversationId();
    if (!activeConvId || isStreaming) return;

    // Direct user-gesture activation: Unlock AudioContext and prime speech synthesis early
    const audioState = platformBridge.unlockAudio();
    console.log('[Jenna Audio] 🔓 AudioContext unlocked on user message send. State:', audioState);

    // Stop any active audio playback before starting new turn
    speechService.stopPlayback();

    // 1. Add user message if not a retry
    if (!isRetry) {
      await conversationService.addMessage({
        conversationId: activeConvId,
        role: 'user',
        content,
        status: 'complete',
      });

      // 2. Auto-generate title if this is the first exchange
      conversationService.autoGenerateTitleIfFirstMessage(content);
    }

    // 3. Prepare assistant response placeholder
    const assistantMsg = await conversationService.addMessage({
      conversationId: activeConvId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      modelUsed: settings.ai.model,
    });

    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 4. Retrieve contextual active memories relevant to current prompt
    const historyForApi = conversationService
      .getCurrentMessages()
      .filter((m) => m.id !== assistantMsg.id && m.content && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));

    const relevantMemories = settings.memory.enabled
      ? memoryService.getRelevantMemories(
          content,
          historyForApi,
          settings.memory.maxInjectedMemories || 6
        )
      : [];

    const injectedMemories = relevantMemories.map((m) => ({
      category: m.category,
      fact: m.fact,
      priority: m.priority,
    }));

    if (relevantMemories.length > 0) {
      await conversationService.updateMessage(assistantMsg.id, {
        injectedMemoryIds: relevantMemories.map((m) => m.id),
      });
    }

    let fullAssistantText = '';

    try {
      // Reset per-turn agent state
      setAgentState(initialRunState());

      const capabilities = platformBridge.getCapabilities();

      let streamError: string | null = null;
      let doneModel: string | undefined;

      const agentStream = new AgentStream({
        onToken: (text) => {
          fullAssistantText += text;
          conversationService.appendTokenToMessage(assistantMsg.id, text);
        },
        onStateChange: (state) => {
          setAgentState(state);
          if (state.errorMessage) {
            streamError = state.errorMessage;
          }
        },
        onDone: (state, model) => {
          doneModel = model;
          if (state.outcome === 'failed' && state.errorMessage) {
            streamError = state.errorMessage;
          }
        },
        onError: (message) => {
          streamError = message;
        },
      });
      agentStreamRef.current = agentStream;

      await agentStream.start({
        messages: historyForApi,
        model: settings.ai.model,
        temperature: settings.ai.temperature,
        injectedMemories,
        userProfile: settings.profile as unknown as Record<string, unknown>,
        platform: capabilities.platform === 'android' ? 'android' : 'web',
      });

      if (doneModel) {
        await conversationService.updateMessage(assistantMsg.id, { modelUsed: doneModel });
      }

      if (streamError && !fullAssistantText.trim()) {
        throw new Error(streamError);
      }

      if (!fullAssistantText.trim()) {
        throw new Error('No response was generated by Jenna. Please retry.');
      }

      await conversationService.finalizeStreamingMessage(assistantMsg.id, 'complete');

      // Auto-play TTS if enabled in user settings
      console.log(`[Jenna Auto-TTS] 🔍 Checking Auto-TTS conditions: autoPlayTTS=${settings.voice.autoPlayTTS}, textLength=${fullAssistantText.trim().length}`);
      if (settings.voice.autoPlayTTS && fullAssistantText.trim()) {
        console.log(`[Jenna Auto-TTS] 🚀 Triggering automatic speech synthesis for message "${assistantMsg.id}" (${fullAssistantText.trim().length} chars, engine: ${settings.voice.ttsEngine})`);
        speechService.speak(assistantMsg.id, {
          text: fullAssistantText,
          engine: settings.voice.ttsEngine,
          geminiVoice: settings.voice.geminiVoice,
          browserVoiceURI: settings.voice.browserVoiceURI,
          rate: settings.voice.speechRate,
          pitch: settings.voice.speechPitch,
          onSuccess: () => {
            console.log(`[Jenna Auto-TTS] ✅ Auto-TTS playback completed for message "${assistantMsg.id}".`);
            triggerContinuousVoiceNextTurn();
          },
          onError: (err) => {
            console.warn(`[Jenna Auto-TTS] ❌ Auto-TTS playback reported error for message "${assistantMsg.id}":`, err);
            triggerContinuousVoiceNextTurn();
          },
        });
      } else {
        if (!settings.voice.autoPlayTTS) {
          console.log('[Jenna Auto-TTS] ⏸️ Auto-TTS is disabled in settings, skipping voice playback.');
        }
        triggerContinuousVoiceNextTurn();
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        if (fullAssistantText.trim()) {
          await conversationService.finalizeStreamingMessage(assistantMsg.id, 'complete');
        } else {
          await conversationService.finalizeStreamingMessage(
            assistantMsg.id,
            'error',
            'Generation stopped by user.'
          );
        }
      } else {
        console.error('Chat error:', err);
        let rawMessage = err?.message || 'Failed to generate response.';
        if (
          rawMessage.includes('Failed to fetch') ||
          rawMessage.includes('NetworkError') ||
          rawMessage.includes('fetch failed') ||
          (typeof navigator !== 'undefined' && !navigator.onLine)
        ) {
          rawMessage = 'Network connection error. Please check your connection and retry.';
        }
        // Scrub any sensitive tokens/keys
        const safeErrorMessage = rawMessage.replace(/AIza[0-9A-Za-z-_]{20,50}/gi, '[REDACTED_API_KEY]');

        await conversationService.finalizeStreamingMessage(
          assistantMsg.id,
          'error',
          safeErrorMessage
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      agentStreamRef.current = null;
    }
  };

  const handleRegenerate = async () => {
    if (isStreaming) return;
    const currentMsgs = conversationService.getCurrentMessages();
    if (currentMsgs.length === 0) return;

    // Find the last user message
    let lastUserMsgIndex = -1;
    for (let i = currentMsgs.length - 1; i >= 0; i--) {
      if (currentMsgs[i].role === 'user') {
        lastUserMsgIndex = i;
        break;
      }
    }

    if (lastUserMsgIndex === -1) return;
    const lastUserMessage = currentMsgs[lastUserMsgIndex];

    // Remove any assistant responses after the last user message to cleanly regenerate
    const activeConvId = conversationService.getActiveConversationId();
    if (activeConvId) {
      const trimmedMsgs = currentMsgs.slice(0, lastUserMsgIndex + 1);
      await conversationService.setMessagesForConversation(activeConvId, trimmedMsgs);
    }

    await handleSendMessage(lastUserMessage.content, true /* isRetry */);
  };

  const handleExportAllData = () => {
    const data = {
      app: 'Jenna',
      version: '1.0.0-phase1',
      exportedAt: new Date().toISOString(),
      settings: settingsService.get(),
      memories: memoryService.getAll(),
      conversations: conversationService.getConversations(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jenna-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeConversation = conversationService.getActiveConversation();

  const isAndroidCompanionMode = settings.platform.mode === 'android_companion';

  const appLayout = (
    <div className="flex h-full w-full overflow-hidden bg-slate-950">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onUpdateTitle={handleUpdateTitle}
        onTogglePin={handleTogglePin}
        onOpenMemory={() => setIsMemoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        memoryCount={memoryCount}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Chat View */}
      <main className="flex-1 h-full min-w-0 flex flex-col relative">
        <ChatView
          messages={messages}
          conversationTitle={activeConversation?.title || 'Jenna Assistant'}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          onStopStreaming={handleStopStreaming}
          onRegenerate={handleRegenerate}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenMemory={() => setIsMemoryOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onUpdateSettings={handleUpdateSettings}
          settings={settings}
          agentState={agentState}
          onResolveApproval={handleResolveApproval}
        />
      </main>
    </div>
  );

  return (
    <div className="h-full w-full bg-slate-950 font-sans select-text">
      {isAndroidCompanionMode ? (
        /* Android Preview Frame Mode */
        <div className="h-full w-full flex flex-col items-center justify-center p-2 sm:p-6 bg-slate-950">
          <div className="mb-2 flex items-center justify-between w-full max-w-sm px-2 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-slate-200">Android Companion Simulator</span>
            </div>
            <button
              onClick={() => handleUpdateSettings({ platform: { mode: 'web_desktop' } })}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
            >
              Switch to Web
            </button>
          </div>

          {/* Phone Bezel */}
          <div className="relative w-full max-w-sm h-[88vh] bg-slate-900 rounded-[38px] p-2.5 shadow-2xl border-4 border-slate-800 flex flex-col overflow-hidden">
            {/* Phone Camera Hole */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-black z-30 ring-1 ring-slate-800" />
            <div className="relative flex-1 w-full h-full rounded-[28px] overflow-hidden bg-slate-950">
              {appLayout}
            </div>
          </div>
        </div>
      ) : (
        /* Standard Full Web Desktop / Responsive Mobile Mode */
        appLayout
      )}

      {/* Modals */}
      <MemoryModal
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        currentMessages={messages}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onExportAllData={handleExportAllData}
        onOpenMemoryHub={() => {
          setIsSettingsOpen(false);
          setIsMemoryOpen(true);
        }}
      />

      <DiagnosticModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />
    </div>
  );
}
