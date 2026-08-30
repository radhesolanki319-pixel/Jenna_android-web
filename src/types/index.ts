/**
 * Core type definitions for Jenna AI Assistant
 * Designed for cross-platform compatibility (Web + Android)
 */

export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  timestamp: number;
  status: 'complete' | 'streaming' | 'error';
  error?: string;
  modelUsed?: string;
  injectedMemoryIds?: string[];
  audioUrl?: string; // Cache for TTS audio if generated
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  messageCount: number;
  previewText?: string;
  tags?: string[];
}

export type MemoryCategory = 
  | 'personal_facts'     // Personal Facts: Name, location, family, background, bio
  | 'preferences'        // Preferences: Preferred tone, format, coding style, communication habits
  | 'directives'         // Directives: Standing instructions and persistent rules Jenna must follow
  | 'projects_and_goals' // Projects & Goals: Active endeavors, objectives, milestones, learning tracks
  | 'work_context';      // Work Context: Tech stack, company/role, domain, tools, workflow environment

export type MemoryPriority = 'high' | 'medium' | 'low';

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  content: string;         // Primary text/fact for the memory
  fact?: string;           // Backward-compatible alias
  priority: MemoryPriority; // Priority level
  isPinned?: boolean;      // Backward-compatible alias for high priority
  confidence?: number;     // 0.0 to 1.0
  sourceConversationId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  name: string;
  preferredTone: 'warm_conversational' | 'direct_concise' | 'creative_intuitive' | 'analytical_deep';
  customInstructions: string;
}

export interface JennaSettings {
  profile: UserProfile;
  ai: {
    model: string;
    temperature: number;
    enableThinking: boolean;
    streamResponses: boolean;
  };
  memory: {
    enabled: boolean;
    autoExtractSuggestions: boolean;
    maxInjectedMemories: number;
  };
  voice: {
    ttsEngine: 'gemini_neural' | 'browser_native';
    geminiVoice: 'Kore' | 'Zephyr' | 'Puck' | 'Fenrir' | 'Charon';
    browserVoiceURI?: string;
    speechRate: number; // 0.8 to 1.5
    speechPitch: number; // 0.8 to 1.2
    autoPlayTTS: boolean;
    sttLanguage: string;
    continuousVoiceMode: boolean;
  };
  appearance: {
    theme: 'dark' | 'light' | 'amoled';
    accentColor: 'indigo' | 'cyan' | 'emerald' | 'rose' | 'amber';
    fontSize: 'sm' | 'base' | 'lg';
  };
  platform: {
    mode: 'web_desktop' | 'web_mobile' | 'android_companion';
  };
}

export interface StreamChunkPayload {
  type: 'token' | 'done' | 'error';
  token?: string;
  error?: string;
  model?: string;
  finishReason?: string;
}

export interface DiagnosticTestResult {
  id: string;
  name: string;
  category: 'api' | 'streaming' | 'storage' | 'memory' | 'audio' | 'platform';
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}
