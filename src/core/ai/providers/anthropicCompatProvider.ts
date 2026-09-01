/**
 * Anthropic-Compatible Provider Adapter (config-only until credentials exist).
 * Speaks the /v1/messages dialect over plain fetch — no SDK dependency.
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

export class AnthropicCompatProvider implements AIProvider {
  public readonly providerId: AIProviderId = 'anthropic';
  public readonly displayName = 'Anthropic-Compatible';

  public isConfigured(): boolean {
    return Boolean(readEnv('ANTHROPIC_API_KEY'));
  }

  private baseUrl(): string {
    return (readEnv('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': readEnv('ANTHROPIC_API_KEY') || '',
      'anthropic-version': '2023-06-01',
    };
  }

  private toAnthropicMessages(messages: AIChatMessage[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m.role === 'system') continue; // handled via top-level `system`
      const role = m.role === 'model' ? 'assistant' : 'user';
      if (m.parts && m.parts.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        for (const part of m.parts) {
          if (part.type === 'text') {
            content.push({ type: 'text', text: part.text });
          } else if (part.type === 'image') {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: part.mimeType, data: part.dataBase64 },
            });
          } else if (part.type === 'tool_call') {
            content.push({ type: 'tool_use', id: part.id, name: part.name, input: part.args });
          } else if (part.type === 'tool_result') {
            content.push({ type: 'tool_result', tool_use_id: part.callId, content: part.content });
          }
        }
        out.push({ role, content });
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
      messages: this.toAnthropicMessages(messages),
      max_tokens: options?.maxTokens || 8192,
      stream,
    };
    if (options?.systemInstruction) body.system = options.systemInstruction;
    if (typeof options?.temperature === 'number') body.temperature = options.temperature;
    if (typeof options?.topP === 'number') body.top_p = options.topP;
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      if (options.toolChoice === 'none') body.tool_choice = { type: 'none' };
      else if (options.toolChoice && typeof options.toolChoice === 'object') {
        body.tool_choice = { type: 'tool', name: options.toolChoice.name };
      }
    }
    if (options?.thinking?.enabled) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: options.thinking.budgetTokens || 4096,
      };
    }
    return body;
  }

  private normalizeError(err: any, status?: number): AIProviderError {
    const msg = err?.message || String(err || 'Anthropic-compatible request failed');
    const isRetryable = status === 429 || status === 500 || status === 529;
    return new AIProviderError(msg, 'anthropic', { statusCode: status, isRetryable, originalError: err });
  }

  public async generateText(
    modelId: string,
    messages: AIChatMessage[],
    options?: AIGenerationOptions
  ): Promise<AIGenerationResult> {
    const res = await fetch(`${this.baseUrl()}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(modelId, messages, options, false)),
    });
    if (!res.ok) {
      throw this.normalizeError(new Error(`HTTP ${res.status}`), res.status);
    }
    const data = (await res.json()) as any;
    let text = '';
    const toolCalls: AIToolCall[] = [];
    for (const block of data.content || []) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
      }
    }
    return {
      text,
      modelUsed: modelId,
      provider: 'anthropic',
      finishReason: data.stop_reason,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      metadata: { usage: data.usage },
    };
  }

  public async generateStream(
    modelId: string,
    messages: AIChatMessage[],
    options: AIStreamOptions
  ): Promise<AIStreamResult> {
    const res = await fetch(`${this.baseUrl()}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(modelId, messages, options, true)),
    });
    if (!res.ok || !res.body) {
      throw this.normalizeError(new Error(`HTTP ${res.status}`), res.status);
    }

    const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensEmitted = 0;
    let finishReason: string | undefined;
    const toolBlocks = new Map<number, { id: string; name: string; argsJson: string }>();

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      try {
        const evt = JSON.parse(trimmed.slice(5).trim());
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          toolBlocks.set(evt.index, {
            id: evt.content_block.id,
            name: evt.content_block.name,
            argsJson: '',
          });
        } else if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            tokensEmitted++;
            options.onToken(evt.delta.text);
          } else if (evt.delta?.type === 'input_json_delta') {
            const blk = toolBlocks.get(evt.index);
            if (blk) blk.argsJson += evt.delta.partial_json || '';
          }
        } else if (evt.type === 'message_delta') {
          finishReason = evt.delta?.stop_reason || finishReason;
        }
      } catch {
        // partial line; ignore
      }
    };

    while (true) {
      if (options.isAborted?.()) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) processLine(line);
    }

    const toolCalls: AIToolCall[] = Array.from(toolBlocks.values()).map((b) => ({
      id: b.id,
      name: b.name,
      args: safeParseJson(b.argsJson),
    }));
    for (const call of toolCalls) options.onToolCall?.(call);

    return {
      modelUsed: modelId,
      provider: 'anthropic',
      tokensEmitted,
      finishReason,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
