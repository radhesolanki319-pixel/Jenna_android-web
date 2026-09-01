import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIBrain } from '../src/core/ai/brain';
import { ModelRouter } from '../src/core/ai/router';
import { TaskPlanner } from '../server/agent/planner';
import { AgentRun } from '../server/agent/orchestrator';
import { bootstrapTools } from '../server/tools/index';
import { AIProvider, AIStreamOptions, AIGenerationOptions, AIChatMessage } from '../src/types/ai';
import { AgentEvent } from '../src/core/agent/eventTypes';
import { _closeDb } from '../server/db/index';

process.env.JARVIS_DB_MEMORY = 'true';
process.env.GEMINI_API_KEY = 'test-key-for-agent-tests';

bootstrapTools();

/**
 * Scriptable fake Gemini provider: each generateText/generateStream call pops
 * the next scripted behavior.
 */
type ScriptedTurn =
  | { kind: 'text'; text: string }
  | { kind: 'stream_text'; text: string }
  | { kind: 'stream_tool'; name: string; args: Record<string, unknown> };

function makeFakeProvider(script: ScriptedTurn[]): AIProvider {
  return {
    providerId: 'gemini',
    displayName: 'Fake Gemini',
    isConfigured: () => true,
    async generateText(_model: string, _messages: AIChatMessage[], _options?: AIGenerationOptions) {
      const turn = script.shift();
      if (!turn || turn.kind !== 'text') {
        throw new Error(`Fake provider: unexpected generateText call (got ${JSON.stringify(turn)})`);
      }
      return { text: turn.text, modelUsed: 'fake-model', provider: 'gemini' as const };
    },
    async generateStream(_model: string, _messages: AIChatMessage[], options: AIStreamOptions) {
      const turn = script.shift();
      if (!turn) throw new Error('Fake provider: script exhausted');
      if (turn.kind === 'stream_text') {
        for (const token of turn.text.split(' ')) {
          options.onToken(token + ' ');
        }
        return { modelUsed: 'fake-model', provider: 'gemini' as const, tokensEmitted: turn.text.split(' ').length };
      }
      if (turn.kind === 'stream_tool') {
        const call = { id: `call_${Math.random().toString(36).slice(2, 8)}`, name: turn.name, args: turn.args };
        options.onToolCall?.(call);
        return { modelUsed: 'fake-model', provider: 'gemini' as const, tokensEmitted: 0, toolCalls: [call] };
      }
      throw new Error('Fake provider: unexpected stream turn');
    },
  };
}

function buildRun(script: ScriptedTurn[], clientToolIds: string[] = []) {
  const brain = new AIBrain();
  brain.registerProvider(makeFakeProvider(script)); // overrides real gemini
  const router = new ModelRouter(brain);
  const planner = new TaskPlanner(brain, router);
  const run = new AgentRun(brain, router, planner, {
    messages: [{ role: 'user', content: 'What time is it in Kolkata?' }],
    systemInstruction: 'You are Jenna.',
    model: 'auto',
    temperature: 0.7,
    client: { platform: 'web', clientToolIds },
  });
  const events: AgentEvent[] = [];
  run.onEvent((e) => events.push(e));
  return { run, events };
}

const eventTypes = (events: AgentEvent[]) => events.map((e) => e.type);

describe('Agent Orchestrator (Jarvis Phase 2 — WS3)', () => {
  beforeEach(() => {
    _closeDb();
  });

  it('chat fast-path: streams tokens and finishes success without a plan', async () => {
    const { run, events } = buildRun([
      { kind: 'text', text: '{"mode":"chat","reason":"conversational"}' },
      { kind: 'stream_text', text: 'Hello there friend' },
    ]);
    await run.run();

    const types = eventTypes(events);
    expect(types).toContain('run_started');
    expect(types).toContain('token');
    expect(types).not.toContain('plan_created');
    const done = events.find((e) => e.type === 'done') as any;
    expect(done.outcome).toBe('success');
    expect(run.getStatus()).toBe('done');
  });

  it('task path: plan → SAFE tool call → tool result → final answer → verification → done', async () => {
    const { run, events } = buildRun([
      { kind: 'text', text: '{"mode":"task","reason":"needs current time"}' },
      {
        kind: 'text',
        text: JSON.stringify({
          goal: 'Tell the user the current time in Kolkata',
          steps: [
            { description: 'Look up current time', toolId: 'datetime.now' },
            { description: 'Answer the user', toolId: '' },
          ],
        }),
      },
      { kind: 'stream_tool', name: 'datetime__now', args: { timezone: 'Asia/Kolkata' } },
      { kind: 'stream_text', text: 'It is currently evening in Kolkata.' },
    ]);
    await run.run();

    const types = eventTypes(events);
    expect(types).toContain('plan_created');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('verification');

    const toolResult = events.find((e) => e.type === 'tool_result') as any;
    expect(toolResult.ok).toBe(true);
    expect(toolResult.toolId).toBe('datetime.now');

    const verification = events.find((e) => e.type === 'verification') as any;
    expect(verification.passed).toBe(true);
    expect(verification.evidence).toContain('datetime.now');

    const done = events.find((e) => e.type === 'done') as any;
    expect(done.outcome).toBe('success');
    // No approval events for an all-SAFE plan
    expect(types).not.toContain('approval_required');
  });

  it('SENSITIVE plan requires approval; rejection fails the run honestly', async () => {
    const { run, events } = buildRun([
      { kind: 'text', text: '{"mode":"task","reason":"needs web"}' },
      {
        kind: 'text',
        text: JSON.stringify({
          goal: 'Read a web page',
          steps: [
            { description: 'Fetch the page', toolId: 'web.fetch_url' },
            { description: 'Summarize', toolId: '' },
          ],
        }),
      },
      // never reached — plan gets rejected
    ]);

    const runPromise = run.run();
    // Wait for the approval_required event, then reject.
    await vi.waitFor(() => {
      if (!events.some((e) => e.type === 'approval_required')) throw new Error('no approval yet');
    });
    const approval = events.find((e) => e.type === 'approval_required') as any;
    expect(approval.scope).toBe('plan');
    expect(approval.permission).toBe('SENSITIVE');

    run.resolveApproval(approval.approvalId, false);
    await runPromise;

    const done = events.find((e) => e.type === 'done') as any;
    expect(done.outcome).toBe('failed');
    expect(run.getStatus()).toBe('failed');
  });

  it('SENSITIVE plan approval grants run-level SENSITIVE and executes', async () => {
    const { run, events } = buildRun(
      [
        { kind: 'text', text: '{"mode":"task","reason":"memory save"}' },
        {
          kind: 'text',
          text: JSON.stringify({
            goal: 'Remember user preference',
            steps: [
              { description: 'Save the preference', toolId: 'memory.save' },
              { description: 'Confirm to user', toolId: '' },
            ],
          }),
        },
        { kind: 'stream_tool', name: 'memory__save', args: { category: 'preferences', content: 'User likes tea' } },
        { kind: 'stream_text', text: 'Saved your preference!' },
      ],
      ['memory.save', 'memory.search'] // client supports these tools
    );

    const runPromise = run.run();
    await vi.waitFor(() => {
      if (!events.some((e) => e.type === 'approval_required')) throw new Error('no approval yet');
    });
    const approval = events.find((e) => e.type === 'approval_required') as any;
    run.resolveApproval(approval.approvalId, true);

    // memory.save is client-executed: wait for the delegated tool_call, then post result.
    await vi.waitFor(() => {
      if (!events.some((e) => e.type === 'tool_call' && (e as any).executeOn === 'client')) {
        throw new Error('no client tool call yet');
      }
    });
    const toolCall = events.find((e) => e.type === 'tool_call') as any;
    expect(toolCall.executeOn).toBe('client');
    run.submitClientToolResult(toolCall.callId, {
      ok: true,
      data: { saved: true },
      durationMs: 5,
    });

    await runPromise;
    const done = events.find((e) => e.type === 'done') as any;
    expect(done.outcome).toBe('success');
  });

  it('cancel mid-run reaches cancelled state', async () => {
    const { run, events } = buildRun([
      { kind: 'text', text: '{"mode":"task","reason":"web"}' },
      {
        kind: 'text',
        text: JSON.stringify({
          goal: 'Web task',
          steps: [{ description: 'Fetch', toolId: 'web.fetch_url' }],
        }),
      },
    ]);
    const runPromise = run.run();
    await vi.waitFor(() => {
      if (!events.some((e) => e.type === 'approval_required')) throw new Error('not yet');
    });
    run.cancel();
    await runPromise;
    expect(['failed', 'cancelled']).toContain(run.getStatus());
  });

  it('classification failure degrades to chat fast-path (never breaks UX)', async () => {
    const { run, events } = buildRun([
      // classify call throws (script returns wrong kind)
      { kind: 'stream_text', text: 'irrelevant' } as any,
      { kind: 'stream_text', text: 'Plain chat answer works' },
    ]);
    await run.run();
    const done = events.find((e) => e.type === 'done') as any;
    expect(done).toBeTruthy();
    expect(done.outcome).toBe('success');
  });
});
