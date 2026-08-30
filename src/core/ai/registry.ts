/**
 * Model Registry — Single Source of Truth for Models and Providers in Jenna Brain
 */

import { AIModelMetadata, AIProviderId } from '../../types/ai';

export const MODEL_REGISTRY: Record<string, AIModelMetadata> = {
  'gemini-3.7-flash': {
    id: 'gemini-3.7-flash',
    provider: 'gemini',
    displayName: 'Gemini 3.7 Flash',
    description: 'Primary intelligent model with multimodal reasoning and low latency.',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json'],
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
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json'],
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
    capabilities: ['text', 'chat', 'stream', 'vision', 'structured_json'],
    tier: 'fast',
    recommendedFor: ['High Availability', 'Resilient Failover'],
  },
};

export const DEFAULT_FALLBACK_CHAINS: Record<AIProviderId, string[]> = {
  gemini: ['gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
  openai: [],
  anthropic: [],
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
