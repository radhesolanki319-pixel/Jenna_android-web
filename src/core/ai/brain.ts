/**
 * Jenna AI Brain Coordinator
 * Central Model-Agnostic AI Brain Hub for Jenna.
 * Dispatches requests to the appropriate AI Provider based on model metadata.
 */

import {
  AIProvider,
  AIProviderId,
  AIChatMessage,
  AIGenerationOptions,
  AIStreamOptions,
  AIGenerationResult,
  AIStreamResult,
  AIProviderError,
} from '../../types/ai';
import { getModelMetadata, getDefaultModel } from './registry';
import { GeminiProvider } from './providers/geminiProvider';

export class AIBrain {
  private providers: Map<AIProviderId, AIProvider> = new Map();

  constructor() {
    // Register the canonical Gemini provider by default
    const gemini = new GeminiProvider();
    this.registerProvider(gemini);
  }

  public registerProvider(provider: AIProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  public getProvider(providerId: AIProviderId): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AIProviderError(`AI Provider "${providerId}" is not registered.`, providerId);
    }
    return provider;
  }

  public getProviderForModel(modelId?: string): { provider: AIProvider; resolvedModelId: string } {
    const defaultModel = getDefaultModel();
    const effectiveModelId = modelId || defaultModel.id;
    const metadata = getModelMetadata(effectiveModelId);
    const providerId = metadata?.provider || 'gemini';
    const provider = this.getProvider(providerId);

    return { provider, resolvedModelId: effectiveModelId };
  }

  /**
   * Primary entry point for streaming chat completions
   */
  public async streamChat(
    modelId: string | undefined,
    messages: AIChatMessage[],
    options: AIStreamOptions
  ): Promise<AIStreamResult> {
    const { provider, resolvedModelId } = this.getProviderForModel(modelId);
    return provider.generateStream(resolvedModelId, messages, options);
  }

  /**
   * Entry point for non-streaming text/structured content generation
   */
  public async generateText(
    modelId: string | undefined,
    messages: AIChatMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    const { provider, resolvedModelId } = this.getProviderForModel(modelId);
    return provider.generateText(resolvedModelId, messages, options);
  }

  /**
   * Entry point for Neural TTS Speech Generation
   */
  public async generateSpeech(
    text: string,
    voice?: string,
    apiKey?: string
  ): Promise<{ audioBase64: string; mimeType: string; voice: string }> {
    const geminiProvider = this.getProvider('gemini') as GeminiProvider;
    if (!geminiProvider.generateSpeech) {
      throw new Error('TTS Speech synthesis is not supported by current provider.');
    }
    return geminiProvider.generateSpeech(text, voice, apiKey);
  }
}

// Singleton AI Brain instance
export const aiBrain = new AIBrain();
