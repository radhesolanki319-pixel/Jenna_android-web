import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Copy,
  Check,
  RotateCw,
  Sparkles,
  Menu,
  Brain,
  Layers,
  AlertCircle,
  Play,
  Pause,
  Download,
  Info,
  ChevronDown,
  Settings,
  Radio,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, JennaSettings } from '../types';
import { speechService } from '../core/speechService';
import { platformBridge } from '../core/bridge';
import { memoryService } from '../core/memoryStore';
import { AgentRunState } from '../core/agent/agentClient';
import { AgentActivityBlock } from './agent/AgentActivity';

interface ChatViewProps {
  messages: Message[];
  conversationTitle: string;
  isStreaming: boolean;
  onSendMessage: (content: string) => Promise<void>;
  onStopStreaming: () => void;
  onRegenerate: () => Promise<void>;
  onOpenMobileMenu: () => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
  onUpdateSettings?: (updates: Partial<JennaSettings>) => Promise<void>;
  settings: JennaSettings;
  agentState?: AgentRunState;
  onResolveApproval?: (approvalId: string, approved: boolean, grantForRun: boolean) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  conversationTitle,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onRegenerate,
  onOpenMobileMenu,
  onOpenMemory,
  onOpenSettings,
  onUpdateSettings,
  settings,
  agentState,
  onResolveApproval,
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechInterim, setSpeechInterim] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeAudioMessageId, setActiveAudioMessageId] = useState<string | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeMemories = memoryService.getInjectedMemories(settings.memory.maxInjectedMemories);

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputText]);

  // Listen to speech service updates
  useEffect(() => {
    const unsub = speechService.subscribe(() => {
      const playingId = speechService.getCurrentPlayingMessageId();
      const state = speechService.getPlaybackState();
      const recState = speechService.getRecognitionState();
      setActiveAudioMessageId(playingId);
      setIsAudioLoading(state === 'loading');
      setIsListening(recState === 'listening');
    });
    return unsub;
  }, []);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text || isStreaming) return;

    platformBridge.unlockAudio();
    setInputText('');
    setSpeechInterim('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleSpeechRecognition = () => {
    if (isListening) {
      speechService.stopListening();
      setIsListening(false);
      setSpeechInterim('');
    } else {
      setIsListening(true);
      setSpeechInterim('');
      speechService.startListening(
        settings.voice.sttLanguage || 'en-US',
        (transcript, isFinal) => {
          if (isFinal) {
            setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
            setSpeechInterim('');
            setIsListening(false);
          } else {
            setSpeechInterim(transcript);
          }
        },
        (error) => {
          console.warn('Speech Recognition error:', error);
          setIsListening(false);
          setSpeechInterim('');
        }
      );
    }
  };

  const handlePlayTTS = async (msg: Message) => {
    platformBridge.unlockAudio();
    if (activeAudioMessageId === msg.id) {
      speechService.stopPlayback();
      return;
    }

    await speechService.speak(msg.id, {
      text: msg.content,
      engine: settings.voice.ttsEngine,
      geminiVoice: settings.voice.geminiVoice,
      browserVoiceURI: settings.voice.browserVoiceURI,
      rate: settings.voice.speechRate,
      pitch: settings.voice.speechPitch,
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // ignore
    }
  };

  const promptSuggestions = [
    {
      title: 'Analyze Architecture',
      prompt: 'Explain the Phase 1 cross-platform architecture of Jenna for Web and Android.',
    },
    {
      title: 'Check Long-Term Memory',
      prompt: 'What facts and preferences do you currently remember about me from your long-term memory?',
    },
    {
      title: 'Test Reasoning',
      prompt: 'Help me design a clean API schema for synchronizing conversation states between Android and Web.',
    },
    {
      title: 'Voice Assistant Guide',
      prompt: 'How do speech recognition and neural text-to-speech work in Jenna?',
    },
  ];

  const handleToggleContinuousVoice = async () => {
    const nextVal = !settings.voice.continuousVoiceMode;
    if (onUpdateSettings) {
      await onUpdateSettings({
        voice: {
          ...settings.voice,
          continuousVoiceMode: nextVal,
        },
      });
    }
    await platformBridge.setContinuousVoiceEnabled(nextVal);
    if (nextVal) {
      platformBridge.vibrate('light');
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* Top Header Bar */}
      <header
        id="jenna-header"
        className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md shrink-0 z-10"
      >
        <div className="flex items-center gap-3">
          <button
            id="btn-mobile-menu"
            onClick={onOpenMobileMenu}
            className="md:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Open Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm sm:text-base text-white tracking-tight truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                {conversationTitle || 'Jenna Assistant'}
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                {settings.ai.model}
              </span>
            </div>
          </div>
        </div>

        {/* Action Pills */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Active Memory Indicator */}
          <button
            id="btn-header-memory-pill"
            onClick={onOpenMemory}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
              settings.memory.enabled
                ? 'bg-indigo-950/60 hover:bg-indigo-900/70 text-indigo-300 border-indigo-750/50'
                : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 border-slate-700/60'
            }`}
            title={`Long-Term Memory Hub: ${activeMemories.length} facts active. Click to open.`}
          >
            <Brain className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Memory</span>
            <span className="px-1.5 py-0.2 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold font-mono">
              {activeMemories.length}
            </span>
          </button>

          {/* Voice Engine Indicator */}
          <button
            id="btn-voice-indicator"
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs transition-colors cursor-pointer"
            title={`Voice: ${settings.voice.geminiVoice} (${settings.voice.ttsEngine}). Click to configure.`}
          >
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline text-slate-300 font-mono text-[11px]">
              {settings.voice.geminiVoice}
            </span>
          </button>

          {/* Hands-Free / Continuous Voice Mode Toggle */}
          <button
            id="btn-continuous-voice-toggle"
            onClick={handleToggleContinuousVoice}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all duration-200 cursor-pointer ${
              settings.voice.continuousVoiceMode
                ? 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border-rose-700/60 shadow-xs shadow-rose-900/30'
                : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 border-slate-700/60'
            }`}
            title={
              settings.voice.continuousVoiceMode
                ? 'Continuous Voice / Hands-Free Mode is ACTIVE. Click to turn off.'
                : 'Continuous Voice / Hands-Free Mode is OFF. Click to activate.'
            }
          >
            <Radio
              className={`w-3.5 h-3.5 ${
                settings.voice.continuousVoiceMode ? 'text-rose-400 animate-pulse' : 'text-slate-400'
              }`}
            />
            <span className="hidden sm:inline">
              {settings.voice.continuousVoiceMode ? 'Hands-Free' : 'Hands-Free'}
            </span>
          </button>

          {/* Settings Quick Access Button */}
          <button
            id="btn-header-settings"
            onClick={onOpenSettings}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 transition-colors cursor-pointer"
            title="Jenna Settings & Preferences"
          >
            <Settings className="w-4 h-4 text-slate-300" />
          </button>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-8 py-6 space-y-6">
        {messages.length === 0 ? (
          /* Ambient Welcome Hero State */
          <div className="max-w-2xl mx-auto py-8 text-center flex flex-col items-center justify-center min-h-[60vh]">
            {/* Ambient Jenna Orb */}
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-xl shadow-indigo-500/25 animate-pulse">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <div className="absolute -inset-2 rounded-3xl bg-indigo-500/20 blur-xl -z-10 animate-pulse" />
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
              Hello {settings.profile.name || 'there'}, I'm Jenna
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-md mb-8 leading-relaxed">
              Your personal AI assistant built for Web and Android. Powered by real-time streaming, persistent memory, and neural voice capabilities.
            </p>

            {/* Quick Starters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
              {promptSuggestions.map((item, idx) => (
                <button
                  key={idx}
                  id={`starter-chip-${idx}`}
                  onClick={() => {
                    platformBridge.unlockAudio();
                    onSendMessage(item.prompt);
                  }}
                  className="p-3.5 rounded-2xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/40 text-left transition-all duration-150 group cursor-pointer shadow-xs"
                >
                  <div className="font-semibold text-xs text-indigo-300 group-hover:text-indigo-200 mb-1 flex items-center justify-between">
                    <span>{item.title}</span>
                    <Sparkles className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-400" />
                  </div>
                  <div className="text-xs text-slate-400 group-hover:text-slate-300 line-clamp-2 leading-relaxed">
                    {item.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Chat Stream */
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              const isStreamingThis = msg.status === 'streaming';
              const isAudioPlayingThis = activeAudioMessageId === msg.id;

              return (
                <div
                  key={msg.id || index}
                  id={`chat-msg-${msg.id}`}
                  className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="relative shrink-0 mt-0.5">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-xs ${
                          isStreamingThis
                            ? 'bg-gradient-to-tr from-indigo-500 to-cyan-400 ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-950 animate-pulse'
                            : 'bg-indigo-600 text-white'
                        }`}
                      >
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  )}

                  <div className={`max-w-[85%] sm:max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                    {/* Role Header (Assistant) */}
                    {!isUser && (
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <span className="text-xs font-semibold text-slate-300">Jenna</span>
                        {msg.modelUsed && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {msg.modelUsed}
                          </span>
                        )}
                        {msg.injectedMemoryIds && msg.injectedMemoryIds.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-indigo-300 bg-indigo-500/15 px-1.5 py-0.2 rounded-sm border border-indigo-500/30">
                            <Brain className="w-2.5 h-2.5" />
                            Memory Context
                          </span>
                        )}
                      </div>
                    )}

                    {/* Agent Activity (plan, tools, approvals) for the streaming turn */}
                    {!isUser && isStreamingThis && agentState && onResolveApproval && (
                      <div className="w-full min-w-[260px]">
                        <AgentActivityBlock
                          state={agentState}
                          onResolveApproval={onResolveApproval}
                          onCancel={onStopStreaming}
                        />
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div
                      className={`relative px-4 py-3.5 rounded-2xl text-sm leading-relaxed ${
                        isUser
                          ? 'bg-indigo-600 text-white rounded-tr-xs shadow-sm shadow-indigo-900/30'
                          : 'bg-slate-900/90 text-slate-100 border border-slate-800/90 rounded-tl-xs shadow-xs'
                      }`}
                    >
                      {isUser ? (
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      ) : (
                        <div className="markdown-body">
                          {msg.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          ) : isStreamingThis ? (
                            <div className="flex items-center gap-2 text-slate-400 text-xs py-1">
                              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                              <span>Jenna is thinking...</span>
                            </div>
                          ) : null}

                          {isStreamingThis && (
                            <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle" />
                          )}
                        </div>
                      )}

                      {/* Error State */}
                      {msg.status === 'error' && (
                        <div className="mt-2.5 pt-2.5 border-t border-rose-500/20 flex items-center justify-between text-xs text-rose-300">
                          <div className="flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>{msg.error || 'Failed to complete response.'}</span>
                          </div>
                          <button
                            id={`btn-retry-${msg.id}`}
                            onClick={() => {
                              platformBridge.unlockAudio();
                              onRegenerate();
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium transition-colors"
                          >
                            <RotateCw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Message Action Toolbar */}
                    <div className="flex items-center gap-1 mt-1 px-1 opacity-80 hover:opacity-100 transition-opacity">
                      {/* Copy Button */}
                      <button
                        id={`btn-copy-${msg.id}`}
                        onClick={() => copyToClipboard(msg.content, msg.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
                        title="Copy text"
                      >
                        {copiedMessageId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* TTS Voice Playback Button (for Assistant) */}
                      {!isUser && msg.status === 'complete' && msg.content && (
                        <button
                          id={`btn-tts-${msg.id}`}
                          onClick={() => handlePlayTTS(msg)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
                            isAudioPlayingThis
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                          }`}
                          title="Listen with Neural TTS"
                        >
                          {isAudioPlayingThis ? (
                            <>
                              <Square className="w-3 h-3 text-emerald-400 fill-current" />
                              <span className="text-[11px] font-mono">Playing</span>
                            </>
                          ) : isAudioLoading && activeAudioMessageId === msg.id ? (
                            <span className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {/* Regenerate Button (last assistant message) */}
                      {!isUser && index === messages.length - 1 && !isStreaming && (
                        <button
                          id="btn-regenerate"
                          onClick={() => {
                            platformBridge.unlockAudio();
                            onRegenerate();
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
                          title="Regenerate response"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <span className="text-[10px] text-slate-400 ml-1 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Speech Interim Feedback Bar */}
      {isListening && (
        <div className="px-4 py-2 bg-indigo-950/80 border-t border-indigo-800/60 backdrop-blur-md flex items-center justify-between text-xs text-indigo-200 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            <span className="font-semibold text-rose-300">Listening...</span>
            <span className="italic text-slate-300 truncate max-w-xs sm:max-w-md">
              {speechInterim || 'Speak clearly into your microphone'}
            </span>
          </div>
          <button
            onClick={toggleSpeechRecognition}
            className="px-2 py-0.5 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[11px] font-medium"
          >
            Done
          </button>
        </div>
      )}

      {/* Bottom Chat Input Bar */}
      <div className="p-3 sm:p-4 border-t border-slate-800/80 bg-slate-900/90 backdrop-blur-md shrink-0">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSend} className="relative flex items-end gap-2">
            {/* Microphone Button (Speech to Text) */}
            <button
              id="btn-voice-input"
              type="button"
              onClick={toggleSpeechRecognition}
              className={`p-3 rounded-2xl transition-all duration-150 shrink-0 cursor-pointer ${
                isListening
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30 animate-pulse'
                  : 'bg-slate-800/90 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700/60'
              }`}
              title={isListening ? 'Stop listening' : 'Start voice input (Speech to Text)'}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {/* Expanding Textarea */}
            <div className="relative flex-1 bg-slate-950/80 border border-slate-800 focus-within:border-indigo-500/60 rounded-2xl overflow-hidden transition-colors shadow-inner">
              <textarea
                id="input-chat-message"
                ref={textareaRef}
                rows={1}
                placeholder={isListening ? 'Listening to voice...' : 'Ask Jenna anything... (Shift+Enter for newline)'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                className="w-full bg-transparent px-4 py-3.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-hidden resize-none max-h-44 disabled:opacity-60"
              />
            </div>

            {/* Send or Stop Button */}
            {isStreaming ? (
              <button
                id="btn-stop-stream"
                type="button"
                onClick={onStopStreaming}
                className="p-3 rounded-2xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-md shadow-rose-600/25 transition-all duration-150 shrink-0 cursor-pointer"
                title="Stop generation"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
            ) : (
              <button
                id="btn-send-message"
                type="submit"
                disabled={!inputText.trim()}
                className="p-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-400 text-white shadow-md shadow-indigo-600/25 transition-all duration-150 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                title="Send message (Enter)"
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </form>

          {/* Footer Metadata */}
          <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Jenna Core Engine v1.0</span>
              <span className="text-slate-400">•</span>
              <span className="hidden sm:inline">Web + Android Architecture</span>
            </div>
            <div className="flex items-center gap-2">
              {settings.memory.enabled && (
                <span className="text-indigo-400/90 font-medium">
                  {activeMemories.length} active memory facts
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
