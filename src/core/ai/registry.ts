/**
 * Model Registry — Single Source of Truth for Models and Providers in Jenna Brain
 */

import { AIModelMetadata, AIModelVerification, AIProviderId, readEnv } from '../../types/ai';

export const MODEL_REGISTRY: Record<string, AIModelMetadata> = {
  'gemini-3.7-flash': {
    id: 'gemini-3.7-flash',
    provider: 'gemini',
    displayName: 'Gemini 3.7 Flash',
    description: 'Primary intelligent model with multimodal reasoning and low latency.',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json', 'tools'],
    isDefault: true,
    tier: 'standard',
    recommendedFor: ['General Chat', 'Deep Reasoning', 'Coding', 'Multilingual'],
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    displayName: 'Gemini 3.1 Flash Lite',
    description: 'Ultra-low latency streaming model with high efficiency.',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json', 'tools'],
    tier: 'fast',
    recommendedFor: ['Fast Responses', 'Lightweight Tasks', 'Fallback'],
  },
  'gemini-flash-latest': {
    id: 'gemini-flash-latest',
    provider: 'gemini',
    displayName: 'Gemini Flash Latest',
    description: 'High-availability resilient flash endpoint.',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json', 'tools'],
    tier: 'fast',
    recommendedFor: ['High Availability', 'Resilient Failover'],
  },
  // -------------------------------------------------------------------------
  // Config-only entries: these models become routable ONLY when their provider
  // registers (i.e. the corresponding API key is configured). They are shown
  // greyed-out in the UI otherwise.
  // -------------------------------------------------------------------------
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o mini',
    description: 'OpenAI-compatible fast model (requires OPENAI_API_KEY).',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ['text', 'chat', 'stream', 'structured_json', 'tools'],
    tier: 'fast',
    recommendedFor: ['Fast Responses'],
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    description: 'OpenAI-compatible standard model (requires OPENAI_API_KEY).',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json', 'tools'],
    tier: 'standard',
    recommendedFor: ['General Chat', 'Coding'],
  },
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4',
    description: 'Anthropic-compatible standard model (requires ANTHROPIC_API_KEY).',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json', 'tools', 'thinking'],
    tier: 'standard',
    recommendedFor: ['Deep Reasoning', 'Coding'],
  },
};

export const DEFAULT_FALLBACK_CHAINS: Record<AIProviderId, string[]> = {
  gemini: ['gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-sonnet-4-20250514'],
  custom: [],
};

export function getModelMetadata(modelId: string): AIModelMetadata | undefined {
  if (MODEL_REGISTRY[modelId]) {
    return MODEL_REGISTRY[modelId];
  }
  // Try fuzzy match or fallback
  const match = Object.values(MODEL_REGISTRY).find(
    (m) => m.id.toLowerCase() === modelId.toLowerCase()
  );
  return match;
}

export function getAvailableModels(): AIModelMetadata[] {
  return Object.values(MODEL_REGISTRY);
}

export const AVAILABLE_MODELS: AIModelMetadata[] = Object.values(MODEL_REGISTRY);

export function getDefaultModel(): AIModelMetadata {
  return (
    Object.values(MODEL_REGISTRY).find((m) => m.isDefault) ||
    MODEL_REGISTRY['gemini-3.7-flash']
  );
}

export function getFallbackChain(primaryModelId: string): string[] {
  const metadata = getModelMetadata(primaryModelId);
  const provider = metadata?.provider || 'gemini';
  const chain = DEFAULT_FALLBACK_CHAINS[provider] || [];
  return Array.from(new Set([primaryModelId, ...chain])).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Live verification (server-side): marks Gemini registry entries as
// verified/unavailable by querying the models.list API on boot. The router
// refuses 'unavailable' models; 'unverified' models are still routable
// (verification is best-effort and must never take chat down).
// ---------------------------------------------------------------------------

export function setModelVerification(modelId: string, status: AIModelVerification): void {
  const meta = MODEL_REGISTRY[modelId];
  if (meta) meta.verification = status;
}

export async function verifyGeminiModels(): Promise<{
  verified: string[];
  unavailable: string[];
  skipped: boolean;
}> {
  const apiKey = readEnv('GEMINI_API_KEY');
  const result = { verified: [] as string[], unavailable: [] as string[], skipped: false };
  if (!apiKey) {
    result.skipped = true;
    return result;
  }
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': apiKey } }
    );
    if (!res.ok) {
      result.skipped = true;
      return result;
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const liveIds = new Set(
      (data.models || [])
        .map((m) => (m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
    );
    for (const meta of Object.values(MODEL_REGISTRY)) {
      if (meta.provider !== 'gemini') continue;
      if (liveIds.has(meta.id)) {
        meta.verification = 'verified';
        result.verified.push(meta.id);
      } else {
        meta.verification = 'unavailable';
        result.unavailable.push(meta.id);
      }
    }
  } catch {
    // Network failure — leave everything unverified; never block boot.
    result.skipped = true;
  }
  return result;
}
