/**
 * Jarvis server assembly — middleware, routes, and static/Vite hosting.
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { requireAuth, rateLimit, isAuthEnforced } from './middleware/auth';
import { registerEnvSecrets } from './middleware/redact';
import { createChatRouter } from './routes/chat';
import { createAgentRouter } from './routes/agent';
import { createModelsRouter } from './routes/models';
import { createConnectionsRouter } from './routes/connections';
import { verifyGeminiModels } from '../src/core/ai/registry';
import { bootstrapTools } from './tools/index';
import { getDb } from './db/index';

export function createApp(): express.Express {
  registerEnvSecrets();
  bootstrapTools();
  getDb(); // initialize schema on boot

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check — unauthenticated by design (reports whether auth is on).
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      assistant: 'Jenna',
      version: '2.0.0-jarvis-phase2',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      authEnforced: isAuthEnforced(),
      timestamp: Date.now(),
    });
  });

  // All other /api/* routes: rate-limited + (optionally) token-authenticated.
  const guard = [rateLimit(120), requireAuth] as const;
  app.use('/api/chat', ...guard);
  app.use('/api/memory', ...guard);
  app.use('/api/tts', ...guard);
  app.use('/api/agent', ...guard);
  app.use('/api/models', ...guard);
  app.use('/api/connections', ...guard);

  app.use('/api', createChatRouter());
  app.use('/api/agent', createAgentRouter());
  app.use('/api/models', createModelsRouter());
  app.use('/api/connections', createConnectionsRouter());

  return app;
}

export async function startServer(): Promise<void> {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  // Best-effort live verification of Gemini registry models (never blocks boot).
  verifyGeminiModels()
    .then((r) => {
      if (!r.skipped) {
        console.log(
          `[Jarvis] Model verification — verified: [${r.verified.join(', ')}]` +
            (r.unavailable.length ? ` unavailable: [${r.unavailable.join(', ')}]` : '')
        );
      }
    })
    .catch(() => {});

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Jenna Server] Ready on http://0.0.0.0:${PORT}`);
    if (isAuthEnforced()) {
      console.log('[Jarvis] API auth: ENFORCED (JARVIS_API_TOKEN set).');
    } else {
      console.log('[Jarvis] API auth: open (set JARVIS_API_TOKEN to enforce pairing).');
    }
  });
}
