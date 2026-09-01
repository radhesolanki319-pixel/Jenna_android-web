/**
 * Gemini Provider Adapter
 * Encapsulates the Google Gen AI SDK under the canonical AIProvider interface.
 */

import { GoogleGenAI, Modality } from '@google/genai';
import {
  AIProvider,
  AIProviderId,
  AIChatMessage,
  AIGenerationOptions,
  AIStreamOptions,
  AIGenerationResult,
  AIStreamResult,
  AIProviderError,
  AIToolCall,
} from '../../../types/ai';
import { getFallbackChain } from '../registry';

export class GeminiProvider implements AIProvider {
  public readonly providerId: AIProviderId = 'gemini';
  public readonly displayName = 'Google Gemini';

  private client: GoogleGenAI | null = null;
  private ttsQuotaCooldownUntil = 0;

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn('[GeminiProvider] GEMINI_API_KEY is not set in environment.');
      }
      this.client = new GoogleGenAI({
        apiKey: apiKey || '',
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return this.client;
  }

  public isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  public normalizeError(err: any): AIProviderError {
    if (err instanceof AIProviderError) {
      return err;
    }

    const status = err?.status || err?.code || err?.statusCode;
    let rawMsg = (err?.message || String(err || 'Unknown error'));

    // Scrub any potential API keys or sensitive credential patterns
    rawMsg = rawMsg.replace(/AIza[0-9A-Za-z-_]{20,50}/gi, '[REDACTED_API_KEY]');

    const msg = rawMsg.toLowerCase();

    const isRetryable =
      status === 503 ||
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 504 ||
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('resource_exhausted') ||
      msg.includes('rate limit') ||
      msg.includes('rate_limit') ||
      msg.includes('overloaded') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('timeout') ||
      msg.includes('fetch failed');

    let userFriendlyMessage = rawMsg || 'Gemini generation failed.';
    if (isRetryable) {
      userFriendlyMessage =
        'Jenna is currently experiencing high demand. Please retry in a moment.';
    } else if (
      status === 401 ||
      status === 403 ||
      msg.includes('api_key') ||
      msg.includes('unauthenticated') ||
      msg.includes('permission_denied')
    ) {
      userFriendlyMessage =
        'AI service authentication failed. Please check your API key configuration.';
    }

    return new AIProviderError(userFriendlyMessage, 'gemini', {
      statusCode: typeof status === 'number' ? status : undefined,
      isRetryable,
      originalError: err,
    });
  }

  private formatContents(messages: AIChatMessage[]): Array<{ role: string; parts: Array<Record<string, any>> }> {
    return messages.map((m) => {
      const role = m.role === 'model' ? 'model' : 'user';
      if (m.parts && m.parts.length > 0) {
        const parts: Array<Record<string, any>> = [];
        for (const part of m.parts) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image') {
            parts.push({ inlineData: { mimeType: part.mimeType, data: part.dataBase64 } });
          } else if (part.type === 'tool_call') {
            parts.push({ functionCall: { id: part.id, name: part.name, args: part.args } });
          } else if (part.type === 'tool_result') {
            parts.push({
              functionResponse: {
                id: part.callId,
                name: part.name,
                response: part.ok ? { output: part.content } : { error: part.content },
              },
            });
          }
        }
        return { role, parts };
      }
      return { role, parts: [{ text: m.content }] };
    });
  }

  private buildConfig(options?: AIGenerationOptions): Record<string, any> {
    const config: Record<string, any> = {};
    if (options?.systemInstruction) config.systemInstruction = options.systemInstruction;
    if (typeof options?.temperature === 'number') config.temperature = options.temperature;
    if (typeof options?.topP === 'number') config.topP = options.topP;
    if (typeof options?.maxTokens === 'number') config.maxOutputTokens = options.maxTokens;
    if (options?.responseMimeType) config.responseMimeType = options.responseMimeType;
    if (options?.responseSchema) config.responseSchema = options.responseSchema;
    if (options?.tools && options.tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.inputSchema,
          })),
        },
      ];
      if (options.toolChoice === 'none') {
        config.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      } else if (options.toolChoice && typeof options.toolChoice === 'object') {
        config.toolConfig = {
          functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [options.toolChoice.name] },
        };
      }
    }
    if (options?.thinking) {
      config.thinkingConfig = options.thinking.enabled
        ? { thinkingBudget: options.thinking.budgetTokens ?? -1 }
        : { thinkingBudget: 0 };
    }
    return config;
  }

  private extractToolCalls(source: any): AIToolCall[] {
    const rawCalls =
      source?.functionCalls ||
      source?.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.functionCall)
        .map((p: any) => p.functionCall) ||
      [];
    return (rawCalls as any[])
      .filter((fc) => fc && fc.name)
      .map((fc, i) => ({
        id: fc.id || `gcall_${Date.now()}_${i}`,
        name: fc.name as string,
        args: (fc.args as Record<string, unknown>) || {},
      }));
  }

  public async generateStream(
    modelId: string,
    messages: AIChatMessage[],
    options: AIStreamOptions
  ): Promise<AIStreamResult> {
    const client = this.getClient();
    const candidateModels = getFallbackChain(modelId);
    const contents = this.formatContents(messages);
    const config = this.buildConfig(options);

    let lastError: any = null;
    let totalTokensEmitted = 0;

    for (const modelToTry of candidateModels) {
      if (options.isAborted?.()) {
        return { modelUsed: modelToTry, provider: 'gemini', tokensEmitted: totalTokensEmitted };
      }

      try {
        let modelTokens = 0;
        const collectedToolCalls: AIToolCall[] = [];
        const seenCallKeys = new Set<string>();
        const stream = await client.models.generateContentStream({
          model: modelToTry,
          contents,
          config,
        });

        for await (const chunk of stream) {
          if (options.isAborted?.()) {
            break;
          }

          const token =
            chunk.text ||
            chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ||
            '';

          if (token) {
            modelTokens++;
            totalTokensEmitted++;
            options.onToken(token);
          }

          for (const call of this.extractToolCalls(chunk)) {
            const key = `${call.name}:${JSON.stringify(call.args)}`;
            if (!seenCallKeys.has(key)) {
              seenCallKeys.add(key);
              collectedToolCalls.push(call);
            }
          }
        }

        if (collectedToolCalls.length > 0) {
          for (const call of collectedToolCalls) {
            options.onToolCall?.(call);
          }
          return {
            modelUsed: modelToTry,
            provider: 'gemini',
            tokensEmitted: totalTokensEmitted,
            toolCalls: collectedToolCalls,
          };
        }

        if (modelTokens > 0 || options.isAborted?.()) {
          return { modelUsed: modelToTry, provider: 'gemini', tokensEmitted: totalTokensEmitted };
        }

        console.warn(`[GeminiProvider] Model ${modelToTry} returned 0 tokens. Trying fallback...`);
      } catch (err: any) {
        if (options.isAborted?.()) {
          return { modelUsed: modelToTry, provider: 'gemini', tokensEmitted: totalTokensEmitted };
        }

        lastError = err;
        // If tokens were already partially emitted to client, propagate error
        if (totalTokensEmitted > 0) {
          throw this.normalizeError(err);
        }

        console.warn(`[GeminiProvider] Failover: model ${modelToTry} busy/unavailable. Trying next model...`);
      }
    }

    throw this.normalizeError(lastError || new Error('All candidate models failed to generate stream.'));
  }

  public async generateText(
    modelId: string,
    messages: AIChatMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    const client = this.getClient();
    const candidateModels = getFallbackChain(modelId);
    const contents = this.formatContents(messages);
    const config = this.buildConfig(options);

    let lastError: any = null;

    for (const modelToTry of candidateModels) {
      try {
        const response = await client.models.generateContent({
          model: modelToTry,
          contents,
          config,
        });

        const text = response.text || '';
        const toolCalls = this.extractToolCalls(response);
        return {
          text,
          modelUsed: modelToTry,
          provider: 'gemini',
          finishReason: response.candidates?.[0]?.finishReason,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          metadata: {
            usageMetadata: response.usageMetadata,
          },
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiProvider] Text gen failover from ${modelToTry}...`);
      }
    }

    throw this.normalizeError(lastError || new Error('Content generation failed on all models.'));
  }

  public async generateSpeech(
    text: string,
    voice = 'Kore'
  ): Promise<{ audioBase64: string; mimeType: string; voice: string }> {
    if (!text || typeof text !== 'string') {
      throw new Error('Text parameter is required for speech generation.');
    }

    if (Date.now() < this.ttsQuotaCooldownUntil) {
      throw new AIProviderError(
        'Neural TTS in quota cooldown, defaulting to browser speech synthesis.',
        'gemini',
        { isRetryable: true }
      );
    }

    const validVoice = ['Kore', 'Zephyr', 'Puck', 'Fenrir', 'Charon'].includes(voice) ? voice : 'Kore';
    const client = this.getClient();

    const cleanText = text
      .replace(/[*_#`[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);

    try {
      const response = await client.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: validVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      const mimeType =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType ||
        'audio/l16; rate=24000; channels=1';

      if (!base64Audio) {
        throw new Error('No audio data received from Gemini TTS.');
      }

      return {
        audioBase64: base64Audio,
        mimeType,
        voice: validVoice,
      };
    } catch (ttsErr: any) {
      const errMsg = ttsErr?.message || String(ttsErr);
      if (
        errMsg.includes('429') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('quota') ||
        errMsg.includes('Quota exceeded')
      ) {
        this.ttsQuotaCooldownUntil = Date.now() + 60000;
        console.info(
          '[GeminiProvider] Neural TTS rate limit reached, setting 60s cooldown.'
        );
      }
      throw this.normalizeError(ttsErr);
    }
  }
}
