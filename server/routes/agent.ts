/**
 * Agent API routes:
 *   POST /api/agent/stream            — start a run, stream AgentEvents (SSE)
 *   GET  /api/agent/runs/:id          — snapshot for resume after disconnect
 *   POST /api/agent/runs/:id/approve  — resolve an approval
 *   POST /api/agent/runs/:id/tool-result — client-executed tool result
 *   POST /api/agent/runs/:id/cancel   — cancel a run
 *   GET  /api/agent/tools             — tool catalog (for diagnostics/UI)
 */

import { Router, Request, Response } from 'express';
import { aiBrain } from '../../src/core/ai/brain';
import { modelRouter } from '../../src/core/ai/router';
import { TaskPlanner } from '../agent/planner';
import { createRun, getLiveRun, getRunSnapshot } from '../agent/orchestrator';
import { bootstrapTools, toolRegistry } from '../tools/index';
import { buildJennaSystemPrompt, optimizeConversationContext } from '../../src/core/promptBuilder';
import { AgentClientInfo } from '../../src/core/agent/eventTypes';

export function createAgentRouter(): Router {
  bootstrapTools();
  const router = Router();
  const planner = new TaskPlanner(aiBrain, modelRouter);

  router.post('/stream', async (req: Request, res: Response) => {
    try {
      const {
        messages = [],
        systemInstruction = '',
        injectedMemories = [],
        userProfile = {},
        model = 'auto',
        temperature = 0.7,
        client = { platform: 'web', clientToolIds: [] },
      } = req.body || {};

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: 'GEMINI_API_KEY is missing. Configure it in Settings > Secrets.' });
        return;
      }

      const fullSystemPrompt = buildJennaSystemPrompt({
        userProfile,
        injectedMemories,
        systemInstruction,
      });

      // Normalize turns exactly like the classic chat endpoint.
      const rawTurns: Array<{ role: 'user' | 'model'; content: string }> = [];
      for (const msg of messages) {
        if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
        const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';
        if (rawTurns.length > 0 && rawTurns[rawTurns.length - 1].role === role) {
          rawTurns[rawTurns.length - 1].content += `\n\n${msg.content.trim()}`;
        } else {
          rawTurns.push({ role, content: msg.content.trim() });
        }
      }
      if (rawTurns.length > 0 && rawTurns[0].role !== 'user') rawTurns.shift();
      if (rawTurns.length === 0) {
        res.status(400).json({ error: 'No valid message content provided.' });
        return;
      }
      const validTurns = optimizeConversationContext(rawTurns, {
        maxTurns: 30,
        maxEstimatedTokens: 24000,
      });

      const clientInfo: AgentClientInfo = {
        platform: client.platform === 'android' ? 'android' : 'web',
        clientToolIds: Array.isArray(client.clientToolIds)
          ? client.clientToolIds.filter((id: unknown) => typeof id === 'string').slice(0, 50)
          : [],
      };

      const run = createRun(aiBrain, modelRouter, planner, {
        messages: validTurns.map((t) => ({ role: t.role, content: t.content })),
        systemInstruction: fullSystemPrompt,
        model: typeof model === 'string' ? model : 'auto',
        temperature: Number(temperature) || 0.7,
        client: clientInfo,
      });

      // SSE setup
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      // First frame: run id so the client can approve/cancel/resume.
      res.write(`data: ${JSON.stringify({ type: 'run_created', runId: run.id })}\n\n`);
      (res as any).flush?.();

      const unsubscribe = run.onEvent((event) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          (res as any).flush?.();
          if (event.type === 'done') {
            res.end();
          }
        }
      });

      req.on('close', () => {
        unsubscribe();
        // Note: the run keeps executing server-side; the client can resume
        // via GET /runs/:id. Explicit cancellation uses /cancel.
      });

      run.run().catch((err) => {
        console.error('[Agent] Run crashed:', err?.message);
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({ type: 'error', code: 'crash', message: 'Agent run failed.', recoverable: false })}\n\n`
          );
          res.end();
        }
      });
    } catch (err: any) {
      console.error('[Agent] Stream setup error:', err?.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start agent run.' });
      }
    }
  });

  router.get('/runs/:id', (req: Request, res: Response) => {
    const snapshot = getRunSnapshot(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: 'Run not found.' });
      return;
    }
    res.json(snapshot);
  });

  router.post('/runs/:id/approve', (req: Request, res: Response) => {
    const run = getLiveRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found or no longer active.' });
      return;
    }
    const { approvalId, approved, grantForRun } = req.body || {};
    if (typeof approvalId !== 'string' || typeof approved !== 'boolean') {
      res.status(400).json({ error: 'approvalId (string) and approved (boolean) are required.' });
      return;
    }
    const resolved = run.resolveApproval(approvalId, approved, Boolean(grantForRun));
    if (!resolved) {
      res.status(404).json({ error: 'No pending approval with that id.' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/runs/:id/tool-result', (req: Request, res: Response) => {
    const run = getLiveRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found or no longer active.' });
      return;
    }
    const { callId, result } = req.body || {};
    if (typeof callId !== 'string' || !result || typeof result !== 'object') {
      res.status(400).json({ error: 'callId (string) and result (object) are required.' });
      return;
    }
    const accepted = run.submitClientToolResult(callId, {
      ok: Boolean(result.ok),
      data: result.data,
      error: result.error,
      durationMs: Number(result.durationMs) || 0,
    });
    if (!accepted) {
      res.status(404).json({ error: 'No pending client tool call with that id.' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/runs/:id/cancel', (req: Request, res: Response) => {
    const run = getLiveRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found or no longer active.' });
      return;
    }
    run.cancel();
    res.json({ ok: true });
  });

  router.get('/tools', (_req: Request, res: Response) => {
    res.json({ tools: toolRegistry.list() });
  });

  return router;
}
