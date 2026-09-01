/**
 * AgentOrchestrator — owns the full run lifecycle:
 *   classify → (chat fast-path | plan → approvals → execute tool loop) →
 *   verify → done/failed, streaming AgentEvents throughout and persisting
 *   every event for resume after disconnect/process death.
 *
 * Budgets (hard caps): MAX_TOOL_CALLS tool invocations, MAX_MODEL_CALLS model
 * calls, WALL_CLOCK_MS per run. On breach the run fails honestly.
 */

import crypto from 'crypto';
import { AIBrain } from '../../src/core/ai/brain';
import { ModelRouter } from '../../src/core/ai/router';
import { AIChatMessage, AIToolCall, MessagePart } from '../../src/types/ai';
import {
  AgentEvent,
  AgentPlanDTO,
  AgentClientInfo,
  AgentRunOutcome,
} from '../../src/core/agent/eventTypes';
import { PermissionLevel, ToolResult, summarizeToolResult } from '../../src/core/tools/types';
import { AgentStateMachine } from './state';
import { TaskPlanner } from './planner';
import { toolRegistry, fromWireName } from '../tools/registry';
import { executeTool, argsPreview } from '../tools/executor';
import { insertRun, updateRun, getRun } from '../db/index';
import { redactSecrets } from '../middleware/redact';

const MAX_TOOL_CALLS = 12;
const MAX_MODEL_CALLS = 20;
const WALL_CLOCK_MS = 3 * 60 * 1000;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const CLIENT_TOOL_TIMEOUT_MS = 60 * 1000;

export interface AgentRunRequest {
  messages: AIChatMessage[];
  systemInstruction: string;
  model?: string; // 'auto' or explicit id
  temperature?: number;
  client: AgentClientInfo;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

interface PendingClientTool {
  resolve: (result: ToolResult) => void;
}

export class AgentRun {
  readonly id: string;
  private sm = new AgentStateMachine();
  private events: AgentEvent[] = [];
  private listeners: Array<(e: AgentEvent) => void> = [];
  private pendingApprovals = new Map<string, PendingApproval>();
  private pendingClientTools = new Map<string, PendingClientTool>();
  private cancelled = false;
  private toolCallCount = 0;
  private modelCallCount = 0;
  private startedAt = Date.now();
  private plan: AgentPlanDTO | undefined;
  /** Permissions granted for the remainder of this run (per-run allow). */
  private runGrantedLevels = new Set<PermissionLevel>();

  constructor(
    private brain: AIBrain,
    private router: ModelRouter,
    private planner: TaskPlanner,
    private request: AgentRunRequest
  ) {
    this.id = `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    insertRun({ id: this.id, status: 'idle', mode: 'chat' });
  }

  // ---- event plumbing -----------------------------------------------------

  onEvent(listener: (e: AgentEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getEvents(): AgentEvent[] {
    return this.events;
  }

  getStatus(): string {
    return this.sm.status;
  }

  private emit(event: AgentEvent): void {
    this.events.push(event);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listener errors must not break the run
      }
    }
    // Persist opportunistically (token events are high-frequency; batch them)
    if (event.type !== 'token' && event.type !== 'thinking') {
      this.persist();
    }
  }

  private persist(): void {
    try {
      updateRun(this.id, {
        status: this.sm.status,
        planJson: this.plan ? JSON.stringify(this.plan) : undefined,
        eventsJson: JSON.stringify(this.events.filter((e) => e.type !== 'token')),
      });
    } catch (err) {
      console.warn('[AgentRun] Persist failed:', err);
    }
  }

  private setStatus(status: Parameters<AgentStateMachine['transition']>[0]): void {
    this.sm.transition(status);
    this.emit({ type: 'status', status });
  }

  // ---- external controls --------------------------------------------------

  cancel(): void {
    if (this.sm.isTerminal()) return;
    this.cancelled = true;
    for (const [id, p] of this.pendingApprovals) {
      p.resolve(false);
      this.pendingApprovals.delete(id);
    }
    for (const [id, p] of this.pendingClientTools) {
      p.resolve({
        ok: false,
        error: { code: 'cancelled', message: 'Run was cancelled.', retryable: false },
        durationMs: 0,
      });
      this.pendingClientTools.delete(id);
    }
  }

  resolveApproval(approvalId: string, approved: boolean, grantForRun = false): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);
    if (approved && grantForRun) {
      this.runGrantedLevels.add('SENSITIVE');
    }
    this.emit({ type: 'approval_resolved', approvalId, approved });
    pending.resolve(approved);
    return true;
  }

  submitClientToolResult(callId: string, result: ToolResult): boolean {
    const pending = this.pendingClientTools.get(callId);
    if (!pending) return false;
    this.pendingClientTools.delete(callId);
    pending.resolve(result);
    return true;
  }

  // ---- permission gate ----------------------------------------------------

  private async decidePermission(
    toolId: string,
    permission: PermissionLevel,
    preview: string
  ): Promise<boolean> {
    if (this.cancelled) return false;
    if (permission === 'SAFE') return true;
    if (permission === 'SENSITIVE' && this.runGrantedLevels.has('SENSITIVE')) return true;
    // DANGEROUS never honors per-run grants: always ask, every single time.

    const approvalId = `apv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const wasExecuting = this.sm.status === 'executing';
    if (wasExecuting) this.setStatus('awaiting_approval');
    this.emit({
      type: 'approval_required',
      approvalId,
      scope: 'tool',
      permission,
      detail: `The assistant wants to run "${toolId}".`,
      toolId,
      argsPreview: preview,
    });

    const approved = await new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(approvalId, { resolve });
      setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId);
          this.emit({ type: 'approval_resolved', approvalId, approved: false });
          resolve(false);
        }
      }, APPROVAL_TIMEOUT_MS);
    });
    if (wasExecuting && this.sm.status === 'awaiting_approval') this.setStatus('executing');
    return approved;
  }

  // ---- tool execution (server or client-delegated) -------------------------

  private async runToolCall(call: AIToolCall): Promise<ToolResult> {
    const toolId = fromWireName(call.name);
    const tool = toolRegistry.get(toolId);
    if (!tool) {
      return {
        ok: false,
        error: { code: 'unknown_tool', message: `Tool "${toolId}" does not exist.`, retryable: false },
        durationMs: 0,
      };
    }

    this.toolCallCount++;
    if (this.toolCallCount > MAX_TOOL_CALLS) {
      return {
        ok: false,
        error: { code: 'budget_exceeded', message: 'Tool-call budget exceeded for this run.', retryable: false },
        durationMs: 0,
      };
    }

    const isServerTool = tool.platforms.includes('server');
    const preview = argsPreview(call.args);
    const permission = tool.assessRisk
      ? tool.assessRisk(call.args)
      : tool.permission;

    this.emit({
      type: 'tool_call',
      callId: call.id,
      toolId,
      argsPreview: preview,
      args: isServerTool ? undefined : call.args,
      permission,
      executeOn: isServerTool ? 'server' : 'client',
    });

    let result: ToolResult;
    if (isServerTool) {
      result = await executeTool(
        tool,
        call.args,
        { runId: this.id, platform: 'server' },
        (id, level, p) => this.decidePermission(id, level, p)
      );
    } else {
      // Client-delegated execution — still permission-gated server-side first.
      const approved = await this.decidePermission(toolId, tool.permission, preview);
      if (!approved) {
        result = {
          ok: false,
          error: { code: 'permission_denied', message: 'The user declined this action.', retryable: false },
          durationMs: 0,
        };
      } else {
        const prevStatus = this.sm.status;
        if (prevStatus === 'executing') this.setStatus('awaiting_tool_result');
        result = await new Promise<ToolResult>((resolve) => {
          this.pendingClientTools.set(call.id, { resolve });
          setTimeout(() => {
            if (this.pendingClientTools.has(call.id)) {
              this.pendingClientTools.delete(call.id);
              resolve({
                ok: false,
                error: {
                  code: 'client_timeout',
                  message: 'The client did not return a tool result in time.',
                  retryable: false,
                },
                durationMs: CLIENT_TOOL_TIMEOUT_MS,
              });
            }
          }, CLIENT_TOOL_TIMEOUT_MS);
        });
        if (this.sm.status === 'awaiting_tool_result') this.setStatus('executing');
      }
    }

    this.emit({
      type: 'tool_result',
      callId: call.id,
      toolId,
      ok: result.ok,
      resultPreview: redactSecrets(summarizeToolResult(result, 600)),
      durationMs: result.durationMs,
      artifacts: result.artifacts,
    });
    return result;
  }

  // ---- main loop ----------------------------------------------------------

  async run(): Promise<void> {
    try {
      this.setStatus('classifying');
      const lastUser = [...this.request.messages].reverse().find((m) => m.role === 'user');
      const userText = lastUser?.content || '';

      const classification = await this.planner.classify(
        userText,
        this.request.client.clientToolIds
      );
      this.modelCallCount++;

      const route = this.router.resolve(
        classification.mode === 'task' ? 'agent_planning' : 'fast_chat',
        this.request.model
      );

      this.emit({
        type: 'run_started',
        runId: this.id,
        mode: classification.mode,
        model: route.modelId,
      });

      if (classification.mode === 'chat') {
        await this.runChatFastPath(route.modelId);
        return;
      }
      await this.runTask(route.modelId, userText);
    } catch (err: any) {
      this.failRun('run_error', err?.message || 'Agent run failed unexpectedly.');
    }
  }

  private async runChatFastPath(modelId: string): Promise<void> {
    this.sm.markChatFastPath();
    this.setStatus('executing');
    this.modelCallCount++;

    const { tokensEmitted } = await this.brain.streamChat(modelId, this.request.messages, {
      systemInstruction: this.request.systemInstruction,
      temperature: this.request.temperature ?? 0.7,
      onToken: (t) => this.emit({ type: 'token', text: t }),
      isAborted: () => this.cancelled,
    });

    if (this.cancelled) {
      this.setStatus('cancelled');
      this.persist();
      return;
    }
    if (tokensEmitted === 0) {
      this.failRun('empty_response', 'No response was generated. Please retry.');
      return;
    }
    this.sm.finish('success');
    this.emit({
      type: 'done',
      runId: this.id,
      outcome: 'success',
      model: modelId,
      report: {
        outcome: 'success',
        summary: 'Conversational response completed.',
        toolCallCount: 0,
      },
    });
    this.persist();
  }

  private async runTask(modelId: string, userText: string): Promise<void> {
    // 1. Plan
    this.setStatus('planning');
    this.modelCallCount++;
    this.plan = await this.planner.createPlan(userText, this.request.client.clientToolIds);
    this.emit({ type: 'plan_created', plan: this.plan });

    // 2. Plan-level approval when any step is beyond SAFE
    const needsApproval = this.plan.steps.some((s) => s.permission !== 'SAFE');
    if (needsApproval) {
      const approvalId = `apv_plan_${crypto.randomBytes(3).toString('hex')}`;
      this.setStatus('awaiting_approval');
      this.emit({
        type: 'approval_required',
        approvalId,
        scope: 'plan',
        permission: this.plan.steps.reduce<PermissionLevel>(
          (acc, s) => (s.permission === 'DANGEROUS' || acc === 'DANGEROUS' ? 'DANGEROUS' : s.permission === 'SENSITIVE' ? 'SENSITIVE' : acc),
          'SAFE'
        ),
        detail: `This plan includes ${this.plan.steps.filter((s) => s.permission !== 'SAFE').length} step(s) requiring approval.`,
      });
      const approved = await new Promise<boolean>((resolve) => {
        this.pendingApprovals.set(approvalId, { resolve });
        setTimeout(() => {
          if (this.pendingApprovals.has(approvalId)) {
            this.pendingApprovals.delete(approvalId);
            this.emit({ type: 'approval_resolved', approvalId, approved: false });
            resolve(false);
          }
        }, APPROVAL_TIMEOUT_MS);
      });
      if (!approved || this.cancelled) {
        this.failRun('plan_rejected', this.cancelled ? 'Run cancelled.' : 'The user rejected the plan.');
        return;
      }
      // Plan approval grants SENSITIVE for the run (DANGEROUS still per-call).
      this.runGrantedLevels.add('SENSITIVE');
      this.setStatus('executing');
    } else {
      this.setStatus('executing');
    }

    // 3. Tool-enabled generation loop
    const conversation: AIChatMessage[] = [...this.request.messages];
    const specs = toolRegistry.toProviderSpecs({
      clientToolIds: this.request.client.clientToolIds,
    });
    let verificationEvidence = '';
    let sawSuccessfulTool = false;
    let loops = 0;

    while (!this.cancelled) {
      loops++;
      if (Date.now() - this.startedAt > WALL_CLOCK_MS) {
        this.failRun('wall_clock', 'Run exceeded the time budget.');
        return;
      }
      if (this.modelCallCount >= MAX_MODEL_CALLS) {
        this.failRun('budget_exceeded', 'Model-call budget exceeded for this run.');
        return;
      }

      this.modelCallCount++;
      let streamedText = '';
      const streamResult = await this.brain.streamChat(modelId, conversation, {
        systemInstruction:
          this.request.systemInstruction +
          `\n\n### AGENT MODE\nYou are executing a task with tools. Plan: ${JSON.stringify(
            this.plan?.goal
          )}. Call tools when a step requires them; when all needed information is gathered, produce the final answer for the user as plain text.`,
        temperature: this.request.temperature ?? 0.4,
        tools: specs,
        onToken: (t) => {
          streamedText += t;
          this.emit({ type: 'token', text: t });
        },
        isAborted: () => this.cancelled,
      });

      const toolCalls = streamResult.toolCalls || [];
      if (toolCalls.length === 0) {
        // Model produced its final text answer.
        if (this.cancelled) break;
        if (!streamedText.trim() && !sawSuccessfulTool) {
          this.failRun('empty_response', 'The model produced no output for this task.');
          return;
        }
        // 4. Verification: tool evidence recorded during the loop.
        this.setStatus('verifying');
        const passed = sawSuccessfulTool || streamedText.trim().length > 0;
        this.sm.recordVerification(passed);
        this.emit({
          type: 'verification',
          passed,
          evidence: verificationEvidence || 'Final response produced; no tool evidence required.',
        });
        const outcome: AgentRunOutcome = passed ? 'success' : 'partial';
        this.sm.finish(outcome);
        this.emit({
          type: 'done',
          runId: this.id,
          outcome,
          model: streamResult.modelUsed,
          report: {
            outcome,
            summary: this.plan?.goal || 'Task completed.',
            toolCallCount: this.toolCallCount,
            verificationEvidence: verificationEvidence || undefined,
          },
        });
        this.persist();
        return;
      }

      // Record the model's tool-call turn, then execute each call.
      const callParts: MessagePart[] = toolCalls.map((c) => ({
        type: 'tool_call' as const,
        id: c.id,
        name: c.name,
        args: c.args,
      }));
      conversation.push({ role: 'model', content: streamedText, parts: streamedText ? [{ type: 'text', text: streamedText }, ...callParts] : callParts });

      const resultParts: MessagePart[] = [];
      for (const call of toolCalls) {
        if (this.cancelled) break;
        const result = await this.runToolCall(call);
        if (result.ok) {
          sawSuccessfulTool = true;
          verificationEvidence += `${fromWireName(call.name)} → ok (${result.durationMs}ms); `;
        }
        resultParts.push({
          type: 'tool_result',
          callId: call.id,
          name: call.name,
          ok: result.ok,
          content: summarizeToolResult(result),
        });
      }
      conversation.push({ role: 'user', content: '', parts: resultParts });

      if (loops > MAX_TOOL_CALLS) {
        this.failRun('loop_limit', 'Too many tool-call iterations.');
        return;
      }
    }

    if (this.cancelled) {
      this.setStatus('cancelled');
      this.persist();
    }
  }

  private failRun(code: string, message: string): void {
    if (this.sm.isTerminal()) return;
    this.emit({ type: 'error', code, message: redactSecrets(message), recoverable: false });
    try {
      this.sm.finish('failed');
    } catch {
      // force-transition if the graph disallows (e.g. from idle)
    }
    this.emit({
      type: 'done',
      runId: this.id,
      outcome: 'failed',
      report: {
        outcome: 'failed',
        summary: redactSecrets(message),
        toolCallCount: this.toolCallCount,
      },
    });
    this.persist();
  }
}

// ---------------------------------------------------------------------------
// Run manager — in-memory registry of live runs + DB-backed snapshots.
// ---------------------------------------------------------------------------

const liveRuns = new Map<string, AgentRun>();

export function createRun(
  brain: AIBrain,
  router: ModelRouter,
  planner: TaskPlanner,
  request: AgentRunRequest
): AgentRun {
  const run = new AgentRun(brain, router, planner, request);
  liveRuns.set(run.id, run);
  // GC terminal runs after 15 minutes
  setTimeout(() => liveRuns.delete(run.id), 15 * 60 * 1000).unref?.();
  return run;
}

export function getLiveRun(id: string): AgentRun | undefined {
  return liveRuns.get(id);
}

export function getRunSnapshot(id: string): {
  runId: string;
  status: string;
  events: AgentEvent[];
} | null {
  const live = liveRuns.get(id);
  if (live) {
    return { runId: id, status: live.getStatus(), events: live.getEvents() };
  }
  const row = getRun(id);
  if (!row) return null;
  let events: AgentEvent[] = [];
  try {
    events = JSON.parse(row.events_json);
  } catch {
    events = [];
  }
  return { runId: id, status: row.status, events };
}

/** Test hook. */
export function _clearLiveRuns(): void {
  liveRuns.clear();
}
