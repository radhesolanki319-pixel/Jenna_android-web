/**
 * Model catalog API — the client renders its model selector from this
 * endpoint instead of hardcoding registry contents.
 */

import { Router, Request, Response } from 'express';
import { modelRouter } from '../../src/core/ai/router';
import { getDefaultModel } from '../../src/core/ai/registry';

export function createModelsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({
      defaultModelId: getDefaultModel().id,
      routingModes: ['auto', 'manual'],
      models: modelRouter.modelCatalog().map((m) => ({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        description: m.description,
        tier: m.tier,
        capabilities: m.capabilities,
        available: m.available,
        verification: m.verification || 'unverified',
        isDefault: Boolean(m.isDefault),
      })),
    });
  });

  return router;
}
