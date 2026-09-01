/**
 * OpenAI-Compatible Provider Adapter (config-only until credentials exist).
 * Speaks the /v1/chat/completions dialect over plain fetch — no SDK dependency.
 * Base URL is configurable (OPENAI_BASE_URL) so this also covers OpenRouter,
 * local llama.cpp/ollama gateways, and other OpenAI-compatible endpoints.
 *
 * Registered by AIBrain ONLY when isConfigured() is true.
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
  AIToolCall,
  readEnv,
} from '../../../types/ai';

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export class OpenAICompatProvider implements AIProvider {
  public readonly providerId: AIProviderId = 'openai';
  public readonly displayName = 'OpenAI-Compatible';

  public isConfigured(): boolean {
    return Boolean(readEnv('OPENAI_API_KEY'));
  }

  private baseUrl(): string {
    return (readEnv('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${readEnv('OPENAI_API_KEY') || ''}`,
    };
  }

  private toOpenAIMessages(
    messages: AIChatMessage[],
    systemInstruction?: string
  ): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    if (systemInstruction) {
      out.push({ role: 'system', content: systemInstruction });
    }
    for (const m of messages) {
      const role = m.role === 'model' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
      if (m.parts && m.parts.length > 0) {
        for (const part of m.parts) {
          if (part.type === 'text') {
            out.push({ role, content: part.text });
          } else if (part.type === 'tool_call') {
            out.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: part.id,
                  type: 'function',
                  function: { name: part.name, arguments: JSON.stringify(part.args) },
                },
              ],
            });
          } else if (part.type === 'tool_result') {
            out.push({ role: 'tool', tool_call_id: part.callId, content: part.content });
          } else if (part.type === 'image') {
            out.push({
              role,
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` },
                },
              ],
            });
          }
        }
      } else {
        out.push({ role, content: m.content });
      }
    }
    return out;
  }

  private buildBody(
    modelId: string,
    messages: AIChatMessage[],
    options?: AIGenerationOptions,
    stream = false
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: this.toOpenAIMessages(messages, options?.systemInstruction),
      stream,
    };
    if (typeof options?.temperature === 'number') body.temperature = options.temperature;
    if (typeof options?.topP === 'number') body.top_p = options.topP;
    if (typeof options?.maxTokens === 'number') body.max_tokens = options.maxTokens;
    if (options?.responseMimeType === 'application/json') {
      body.response_format = { type: 'json_object' };
    }
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      if (options.toolChoice === 'none') body.tool_choice = 'none';
      else if (options.toolChoice && typeof options.toolChoice === 'object') {
        body.tool_choice = { type: 'function', function: { name: options.toolChoice.name } };
      }
    }
    return body;
  }

  private normalizeError(err: any, status?: number): AIProviderError {
    const msg = err?.message || String(err || 'OpenAI-compatible request failed');
    const isRetryable = status === 429 || status === 500 || status === 502 || status === 503;
    return new AIProviderError(msg, 'openai', { statusCode: status, isRetryable, originalError: err });
  }

  public async generateText(
    modelId: string,
    messages: AIChatMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(modelId, messages, options, false)),
    });
    if (!res.ok) {
      throw this.normalizeError(new Error(`HTTP ${res.status}`), res.status);
    }
    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    const toolCalls: AIToolCall[] = (choice?.message?.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name || '',
      args: safeParseJson(tc.function?.arguments),
    }));
    return {
      text: choice?.message?.content || '',
      modelUsed: modelId,
      provider: 'openai',
      finishReason: choice?.finish_reason,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      metadata: { usage: data.usage },
    };
  }

  public async generateStream(
    modelId: string,
    messages: AIChatMessage[],
    options: AIStreamOptions
  ): Promise<AIStreamResult> {
    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(modelId, messages, options, true)),
    });
    if (!res.ok || !res.body) {
      throw this.normalizeError(new Error(`HTTP ${res.status}`), res.status);
    }

    const reader = (res.body as any).getReader
      ? (res.body as unknown as ReadableStream<Uint8Array>).getReader()
      : null;
    let tokensEmitted = 0;
    let finishReason: string | undefined;
    const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta;
        finishReason = json.choices?.[0]?.finish_reason || finishReason;
        if (delta?.content) {
          tokensEmitted++;
          options.onToken(delta.content);
        }
        for (const tc of (delta?.tool_calls || []) as OpenAIToolCallDelta[]) {
          const acc = toolCallAccum.get(tc.index) || { id: '', name: '', args: '' };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolCallAccum.set(tc.index, acc);
        }
      } catch {
        // partial line; ignore
      }
    };

    if (reader) {
      while (true) {
        if (options.isAborted?.()) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
    }

    const toolCalls: AIToolCall[] = Array.from(toolCallAccum.values())
      .filter((tc) => tc.name)
      .map((tc) => ({ id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: tc.name, args: safeParseJson(tc.args) }));

    for (const call of toolCalls) {
      options.onToolCall?.(call);
    }

    return {
      modelUsed: modelId,
      provider: 'openai',
      tokensEmitted,
      finishReason,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }
}

function safeParseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
