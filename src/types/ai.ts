/**
 * Model-Agnostic AI Brain Architecture Types
 * Defines provider abstractions, model registry metadata, and streaming contracts for Jenna.
 */

export type AIProviderId = 'gemini' | 'openai' | 'anthropic' | 'custom';

export type AIModelCapability =
  | 'text'
  | 'chat'
  | 'stream'
  | 'vision'
  | 'audio_tts'
  | 'structured_json';

export type AIChatRole = 'user' | 'model' | 'system';

export interface AIChatMessage {
  role: AIChatRole;
  content: string;
}

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
}

export interface AIStreamOptions extends AIGenerationOptions {
  onToken: (token: string) => void;
  isAborted?: () => boolean;
}

export interface AIGenerationResult {
  text: string;
  modelUsed: string;
  provider: AIProviderId;
  finishReason?: string;
  metadata?: Record<string, any>;
}

export interface AIStreamResult {
  modelUsed: string;
  provider: AIProviderId;
  tokensEmitted: number;
  finishReason?: string;
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
