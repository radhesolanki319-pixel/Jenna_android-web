/**
 * Account-connection routes (OAuth device flow — RFC 8628).
 * GitHub tooling arrives in Phase 3; the pairing framework ships now behind
 * the JARVIS_GITHUB_ENABLED flag. No PATs, no embedded secrets.
 */

import { Router, Request, Response } from 'express';
import {
  startDeviceFlow,
  pollDeviceFlow,
  sessionPublicView,
  isProviderAvailable,
  PROVIDERS,
} from '../connections/deviceFlow';
import { connectionStatuses, removeConnection } from '../connections/store';

export function createConnectionsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const connected = connectionStatuses();
    const providers = Object.values(PROVIDERS).map((cfg) => {
      const avail = isProviderAvailable(cfg.provider);
      const conn = connected.find((c) => c.provider === cfg.provider);
      return {
        provider: cfg.provider,
        available: avail.available,
        reason: avail.reason,
        connected: Boolean(conn),
        scopes: conn?.scopes || [],
      };
    });
    res.json({ providers });
  });

  router.post('/:provider/start', async (req: Request, res: Response) => {
    try {
      const session = await startDeviceFlow(req.params.provider);
      res.json(sessionPublicView(session));
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Could not start pairing.' });
    }
  });

  router.post('/:provider/poll', async (req: Request, res: Response) => {
    try {
      const session = await pollDeviceFlow(req.params.provider);
      res.json(sessionPublicView(session));
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Polling failed.' });
    }
  });

  router.delete('/:provider', (req: Request, res: Response) => {
    removeConnection(req.params.provider);
    res.json({ ok: true });
  });

  return router;
}
