import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIBrain } from '../src/core/ai/brain';
import { ModelRouter } from '../src/core/ai/router';
import { setModelVerification, MODEL_REGISTRY } from '../src/core/ai/registry';

describe('ModelRouter (Jarvis Phase 2 — WS1)', () => {
  const ORIGINAL_GEMINI = process.env.GEMINI_API_KEY;
  const ORIGINAL_OPENAI = process.env.OPENAI_API_KEY;
  const ORIGINAL_ANTHROPIC = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    // Reset verification flags
    for (const meta of Object.values(MODEL_REGISTRY)) {
      meta.verification = undefined;
    }
  });

  afterEach(() => {
    if (ORIGINAL_GEMINI !== undefined) process.env.GEMINI_API_KEY = ORIGINAL_GEMINI;
    else delete process.env.GEMINI_API_KEY;
    if (ORIGINAL_OPENAI !== undefined) process.env.OPENAI_API_KEY = ORIGINAL_OPENAI;
    else delete process.env.OPENAI_API_KEY;
    if (ORIGINAL_ANTHROPIC !== undefined) process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('lists only Gemini models when only GEMINI_API_KEY is configured', () => {
    const router = new ModelRouter(new AIBrain());
    const models = router.availableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === 'gemini')).toBe(true);
  });

  it('registers the OpenAI provider only when its key is configured', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai-key-000000';
    const router = new ModelRouter(new AIBrain());
    const providers = new Set(router.availableModels().map((m) => m.provider));
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('anthropic')).toBe(false);
  });

  it('resolves "auto" to the default Gemini model for fast_chat', () => {
    const router = new ModelRouter(new AIBrain());
    const route = router.resolve('fast_chat', 'auto');
    expect(route.provider).toBe('gemini');
    expect(route.modelId).toBeTruthy();
    expect(route.usedOverride).toBe(false);
  });

  it('honors a valid explicit override', () => {
    const router = new ModelRouter(new AIBrain());
    const route = router.resolve('fast_chat', 'gemini-3.1-flash-lite');
    expect(route.modelId).toBe('gemini-3.1-flash-lite');
    expect(route.usedOverride).toBe(true);
  });

  it('falls back gracefully when overriding to an unconfigured provider model', () => {
    const router = new ModelRouter(new AIBrain());
    const route = router.resolve('fast_chat', 'gpt-4o');
    expect(route.provider).toBe('gemini');
    expect(route.usedOverride).toBe(false);
    expect(route.overrideRejectedReason).toBeTruthy();
  });

  it('falls back gracefully for unknown model ids', () => {
    const router = new ModelRouter(new AIBrain());
    const route = router.resolve('fast_chat', 'totally-made-up-model');
    expect(route.provider).toBe('gemini');
    expect(route.overrideRejectedReason).toContain('Unknown model');
  });

  it('refuses models marked unavailable by live verification', () => {
    setModelVerification('gemini-3.7-flash', 'unavailable');
    const router = new ModelRouter(new AIBrain());
    const route = router.resolve('fast_chat', 'gemini-3.7-flash');
    expect(route.usedOverride).toBe(false);
    expect(route.modelId).not.toBe('gemini-3.7-flash');
    // And the unavailable model is excluded from fallback chains
    expect(route.fallbackChain).not.toContain('gemini-3.7-flash');
  });

  it('exposes a catalog with availability flags for the UI', () => {
    const router = new ModelRouter(new AIBrain());
    const catalog = router.modelCatalog();
    const gpt = catalog.find((m) => m.id === 'gpt-4o');
    const gemini = catalog.find((m) => m.provider === 'gemini');
    expect(gpt?.available).toBe(false);
    expect(gemini?.available).toBe(true);
  });
});
