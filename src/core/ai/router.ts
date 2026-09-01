/**
 * ModelRouter — selects a model/provider for a task profile.
 *
 * Decisions applied:
 * - Gemini is the default provider (all default routes resolve to Gemini).
 * - Providers without configured credentials never appear in routing tables
 *   or `availableModels()`; they degrade gracefully (no errors, no dead UI).
 * - User override wins when the override's provider is configured; otherwise
 *   the router silently falls back to the default route and reports it.
 */

import { AIModelMetadata, AIProviderId } from '../../types/ai';
import { AIBrain } from './brain';
import { getModelMetadata, getAvailableModels, getDefaultModel, getFallbackChain } from './registry';

export type TaskProfile =
  | 'fast_chat'
  | 'deep_reasoning'
  | 'agent_planning'
  | 'tool_execution'
  | 'summarize_cheap'
  | 'title_gen'
  | 'vision';

export interface ResolvedRoute {
  provider: AIProviderId;
  modelId: string;
  fallbackChain: string[];
  usedOverride: boolean;
  overrideRejectedReason?: string;
}

/** Profile → preferred tier mapping (v1: all Gemini per project decision). */
const PROFILE_TIER: Record<TaskProfile, 'fast' | 'standard' | 'pro'> = {
  fast_chat: 'standard',
  deep_reasoning: 'standard',
  agent_planning: 'standard',
  tool_execution: 'standard',
  summarize_cheap: 'fast',
  title_gen: 'fast',
  vision: 'standard',
};

export class ModelRouter {
  constructor(private brain: AIBrain) {}

  private isModelRoutable(meta: AIModelMetadata): boolean {
    if (meta.verification === 'unavailable') return false;
    try {
      const provider = this.brain.getProvider(meta.provider);
      return provider.isConfigured();
    } catch {
      return false;
    }
  }

  /** Models whose provider is registered & configured (for UI + routing). */
  availableModels(): AIModelMetadata[] {
    return getAvailableModels().filter((m) => this.isModelRoutable(m));
  }

  /** All registry models with an availability flag (for the settings UI). */
  modelCatalog(): Array<AIModelMetadata & { available: boolean }> {
    return getAvailableModels().map((m) => ({ ...m, available: this.isModelRoutable(m) }));
  }

  resolve(profile: TaskProfile, userOverride?: string): ResolvedRoute {
    // 1. Honor a valid user override
    if (userOverride && userOverride !== 'auto') {
      const meta = getModelMetadata(userOverride);
      if (meta && this.isModelRoutable(meta)) {
        return {
          provider: meta.provider,
          modelId: meta.id,
          fallbackChain: this.routableChain(meta.id),
          usedOverride: true,
        };
      }
      const fallback = this.resolveAuto(profile);
      return {
        ...fallback,
        usedOverride: false,
        overrideRejectedReason: meta
          ? `Model "${userOverride}" is not available (provider not configured or model unavailable).`
          : `Unknown model "${userOverride}".`,
      };
    }
    return this.resolveAuto(profile);
  }

  private resolveAuto(profile: TaskProfile): ResolvedRoute {
    const tier = PROFILE_TIER[profile];
    const candidates = this.availableModels();

    // Prefer: matching tier → default model → any routable model.
    const needsVision = profile === 'vision';
    const pool = needsVision
      ? candidates.filter((m) => m.capabilities.includes('vision'))
      : candidates;

    const byTier = pool.find((m) => m.tier === tier && m.provider === 'gemini')
      || pool.find((m) => m.tier === tier);
    const def = getDefaultModel();
    const defaultRoutable = pool.find((m) => m.id === def.id);
    const chosen = byTier || defaultRoutable || pool[0];

    if (!chosen) {
      // Nothing configured at all — surface the default; the provider will
      // produce a clear "API key missing" error downstream.
      return {
        provider: def.provider,
        modelId: def.id,
        fallbackChain: getFallbackChain(def.id),
        usedOverride: false,
      };
    }
    return {
      provider: chosen.provider,
      modelId: chosen.id,
      fallbackChain: this.routableChain(chosen.id),
      usedOverride: false,
    };
  }

  private routableChain(modelId: string): string[] {
    return getFallbackChain(modelId).filter((id) => {
      const meta = getModelMetadata(id);
      return meta ? meta.verification !== 'unavailable' : false;
    });
  }
}

// Singleton router bound to the singleton brain.
import { aiBrain } from './brain';
export const modelRouter = new ModelRouter(aiBrain);
