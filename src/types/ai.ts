/**
 * Model-Agnostic AI Brain Architecture Types
 * Defines provider abstractions, model registry metadata, multimodal message parts,
 * tool-calling contracts, and streaming contracts for Jenna/Jarvis.
 */

export type AIProviderId = 'gemini' | 'openai' | 'anthropic' | 'custom';

export type AIModelCapability =
  | 'text'
  | 'chat'
  | 'stream'
  | 'vision'
  | 'audio_tts'
  | 'structured_json'
  | 'tools'
  | 'thinking';

export type AIChatRole = 'user' | 'model' | 'system';

/**
 * Multimodal / tool-aware message parts.
 * `content` on AIChatMessage remains the canonical plain-text field for
 * backward compatibility; `parts` takes precedence when present.
 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; dataBase64: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; name: string; ok: boolean; content: string };

export interface AIChatMessage {
  role: AIChatRole;
  content: string;
  parts?: MessagePart[];
}

/** JSON-Schema-ish tool declaration exported by the ToolRegistry per provider. */
export interface AIToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AIToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AIModelVerification = 'unverified' | 'verified' | 'unavailable';

export interface AIModelMetadata {
  id: string;
  provider: AIProviderId;
  displayName: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: AIModelCapability[];
  isDefault?: boolean;
  tier?: 'fast' | 'standard' | 'pro';
  recommendedFor?: string[];
  verification?: AIModelVerification;
}

export interface AIGenerationOptions {
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  responseMimeType?: string;
  responseSchema?: any;
  responseModalities?: any[];
  speechConfig?: any;
  /** Tool declarations available to the model for this call. */
  tools?: AIToolSpec[];
  /** Tool-choice behavior. Defaults to 'auto' when tools are present. */
  toolChoice?: 'auto' | 'none' | { name: string };
  /** Reasoning/thinking configuration (provider maps or ignores gracefully). */
  thinking?: { enabled: boolean; budgetTokens?: number };
}

export interface AIStreamOptions extends AIGenerationOptions {
  onToken: (token: string) => void;
  /** Invoked once per tool call requested by the model during this turn. */
  onToolCall?: (call: AIToolCall) => void;
  isAborted?: () => boolean;
}

export interface AIGenerationResult {
  text: string;
  modelUsed: string;
  provider: AIProviderId;
  finishReason?: string;
  toolCalls?: AIToolCall[];
  metadata?: Record<string, any>;
}

export interface AIStreamResult {
  modelUsed: string;
  provider: AIProviderId;
  tokensEmitted: number;
  finishReason?: string;
  /** Tool calls the model requested this turn (turn ends awaiting tool results). */
  toolCalls?: AIToolCall[];
}

export class AIProviderError extends Error {
  public readonly provider: AIProviderId;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;
  public readonly originalError?: any;

  constructor(
    message: string,
    provider: AIProviderId,
    options?: { statusCode?: number; isRetryable?: boolean; originalError?: any }
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.statusCode = options?.statusCode;
    this.isRetryable = options?.isRetryable ?? false;
    this.originalError = options?.originalError;
  }
}

export interface AIProvider {
  readonly providerId: AIProviderId;
  readonly displayName: string;
  isConfigured(): boolean;
  generateText(
    modelId: string,
    messages: AIChatMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult>;
  generateStream(
    modelId: string,
    messages: AIChatMessage[],
    options: AIStreamOptions
  ): Promise<AIStreamResult>;
  generateSpeech?(
    text: string,
    voice?: string
  ): Promise<{ audioBase64: string; mimeType: string; voice: string }>;
}

/** Safe cross-runtime env read (browser bundles have no `process`). */
export function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}
