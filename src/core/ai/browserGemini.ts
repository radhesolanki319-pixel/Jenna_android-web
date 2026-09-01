/**
 * Browser-Direct Gemini Streaming Client
 * Routes Jenna's AI requests straight from the user's browser to the Gemini API
 * using their locally-connected API key. Used automatically when the hosting
 * server cannot reach Google's API (e.g. restricted egress environments), so
 * Jenna keeps working end-to-end wherever she is opened.
 */

import { GoogleGenAI } from '@google/genai';
import { buildJennaSystemPrompt, optimizeConversationContext } from '../promptBuilder';
import { getFallbackChain } from './registry';
import { apiKeyService } from '../apiKeyStore';

export interface BrowserStreamParams {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  userProfile?: {
    id?: string;
    name?: string;
    handle?: string;
    preferredTone?: string;
    customInstructions?: string;
  };
  injectedMemories?: Array<{ category?: string; fact: string; priority?: string }>;
  isAborted?: () => boolean;
}

/** Normalize raw chat history into valid Gemini dialogue turns (mirrors server logic). */
function normalizeTurns(
  messages: Array<{ role: string; content: string }>
): Array<{ role: 'user' | 'model'; content: string }> {
  const turns: Array<{ role: 'user' | 'model'; content: string }> = [];
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
    const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].content += `\n\n${msg.content.trim()}`;
    } else {
      turns.push({ role, content: msg.content.trim() });
    }
  }
  while (turns.length > 0 && turns[0].role !== 'user') {
    turns.shift();
  }
  return turns;
}

let cachedClient: { key: string; client: GoogleGenAI } | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (!cachedClient || cachedClient.key !== apiKey) {
    cachedClient = { key: apiKey, client: new GoogleGenAI({ apiKey }) };
  }
  return cachedClient.client;
}

function scrubKey(text: string): string {
  return text.replace(/AIza[0-9A-Za-z-_]{20,50}/gi, '[REDACTED_API_KEY]');
}

/**
 * Streams a Jenna chat completion directly from the browser to the Gemini API.
 * Yields tokens as they arrive. `onModelUsed` reports the model that served the
 * response (the registry fallback chain is applied on failure).
 */
export async function* browserStreamChat(
  params: BrowserStreamParams,
  onModelUsed?: (modelUsed: string) => void
): AsyncGenerator<string> {
  const apiKey = apiKeyService.get();
  if (!apiKey) {
    throw new Error('No Gemini API key connected in this browser.');
  }

  const client = getClient(apiKey);
  const rawTurns = normalizeTurns(params.messages);
  if (rawTurns.length === 0) {
    throw new Error('No valid message content provided.');
  }

  const validTurns = optimizeConversationContext(rawTurns, {
    maxTurns: 30,
    maxEstimatedTokens: 24000,
  });
  const contents = validTurns.map((t) => ({ role: t.role, parts: [{ text: t.content }] }));

  const systemInstruction = buildJennaSystemPrompt({
    userProfile: params.userProfile,
    injectedMemories: params.injectedMemories || [],
  });

  const candidateModels = getFallbackChain(params.model || 'gemini-3.7-flash');
  let lastError: any = null;

  for (const modelId of candidateModels) {
    try {
      let emitted = 0;
      const stream = await client.models.generateContentStream({
        model: modelId,
        contents,
        config: {
          systemInstruction,
          temperature: typeof params.temperature === 'number' ? params.temperature : 0.7,
        },
      });

      for await (const chunk of stream) {
        if (params.isAborted?.()) break;
        const token =
          chunk.text ||
          chunk.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text)
            .filter(Boolean)
            .join('') ||
          '';
        if (token) {
          emitted++;
          yield token;
        }
      }

      if (emitted > 0 || params.isAborted?.()) {
        onModelUsed?.(modelId);
        return;
      }
    } catch (err: any) {
      if (params.isAborted?.()) {
        onModelUsed?.(modelId);
        return;
      }
      lastError = err;
      // If tokens were already yielded to the UI, propagate immediately — no fallback.
      throw new Error(scrubKey(err?.message || 'Direct browser generation failed.'));
    }
  }

  throw new Error(scrubKey(lastError?.message || 'All candidate models failed to generate.'));
}
