/**
 * Agent client — consumes the AgentEvent SSE stream from /api/agent/stream,
 * maintains per-run UI state, executes client-delegated tools, and exposes
 * approve/reject/cancel controls.
 */

import { AgentEvent, AgentPlanDTO } from './eventTypes';
import { ToolArtifact, PermissionLevel } from '../tools/types';
import { executeClientTool, getClientToolIds } from '../tools/deviceTools';
import { authFetch } from '../apiClient';

export interface ToolActivityItem {
  callId: string;
  toolId: string;
  argsPreview: string;
  permission: PermissionLevel;
  executeOn: 'server' | 'client';
  status: 'running' | 'ok' | 'error';
  resultPreview?: string;
  durationMs?: number;
  artifacts?: ToolArtifact[];
}

export interface PendingApprovalItem {
  approvalId: string;
  scope: 'plan' | 'tool';
  permission: PermissionLevel;
  detail: string;
  toolId?: string;
  argsPreview?: string;
}

export interface AgentRunState {
  runId: string | null;
  mode: 'chat' | 'task' | null;
  status: string;
  model?: string;
  plan?: AgentPlanDTO;
  toolActivity: ToolActivityItem[];
  pendingApprovals: PendingApprovalItem[];
  verification?: { passed: boolean; evidence: string };
  outcome?: 'success' | 'partial' | 'failed';
  errorMessage?: string;
}

export function initialRunState(): AgentRunState {
  return {
    runId: null,
    mode: null,
    status: 'idle',
    toolActivity: [],
    pendingApprovals: [],
  };
}

export interface AgentStreamCallbacks {
  onToken: (text: string) => void;
  onStateChange: (state: AgentRunState) => void;
  onDone: (state: AgentRunState, model?: string) => void;
  onError: (message: string) => void;
}

export interface AgentStreamRequest {
  messages: Array<{ role: string; content: string }>;
  systemInstruction?: string;
  injectedMemories?: Array<{ category?: string; fact: string }>;
  userProfile?: Record<string, unknown>;
  model?: string;
  temperature?: number;
  platform: 'web' | 'android';
}

export class AgentStream {
  private state: AgentRunState = initialRunState();
  private aborted = false;
  private abortController = new AbortController();

  constructor(private callbacks: AgentStreamCallbacks) {}

  getState(): AgentRunState {
    return this.state;
  }

  private update(mutator: (s: AgentRunState) => void): void {
    mutator(this.state);
    this.callbacks.onStateChange({ ...this.state });
  }

  abort(): void {
    this.aborted = true;
    this.abortController.abort();
    if (this.state.runId) {
      authFetch(`/api/agent/runs/${this.state.runId}/cancel`, { method: 'POST' }).catch(() => {});
    }
  }

  async approve(approvalId: string, approved: boolean, grantForRun = false): Promise<void> {
    if (!this.state.runId) return;
    this.update((s) => {
      s.pendingApprovals = s.pendingApprovals.filter((a) => a.approvalId !== approvalId);
    });
    try {
      await authFetch(`/api/agent/runs/${this.state.runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, approved, grantForRun }),
      });
    } catch {
      // server will time the approval out
    }
  }

  async start(request: AgentStreamRequest): Promise<void> {
    const body = {
      ...request,
      client: {
        platform: request.platform,
        clientToolIds: getClientToolIds(),
      },
    };

    let response: Response;
    try {
      response = await authFetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err: any) {
      if (!this.aborted) this.callbacks.onError(err?.message || 'Could not reach the agent.');
      return;
    }

    if (!response.ok || !response.body) {
      let message = `Agent request failed (HTTP ${response.status}).`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {
        // keep default
      }
      this.callbacks.onError(message);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!this.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            await this.handleEvent(event);
          } catch {
            // malformed frame; skip
          }
        }
      }
    } catch (err: any) {
      if (!this.aborted) {
        this.callbacks.onError(err?.message || 'Stream interrupted.');
      }
    }
  }

  private async handleEvent(event: AgentEvent | { type: 'run_created'; runId: string }): Promise<void> {
    switch (event.type) {
      case 'run_created':
        this.update((s) => {
          s.runId = event.runId;
        });
        break;
      case 'run_started':
        this.update((s) => {
          s.mode = event.mode;
          s.model = event.model;
        });
        break;
      case 'token':
        this.callbacks.onToken(event.text);
        break;
      case 'status':
        this.update((s) => {
          s.status = event.status;
        });
        break;
      case 'plan_created':
        this.update((s) => {
          s.plan = event.plan;
        });
        break;
      case 'step_started':
      case 'step_completed':
      case 'step_failed':
        this.update((s) => {
          const step = s.plan?.steps.find((st) => st.id === (event as any).stepId);
          if (step) {
            step.status =
              event.type === 'step_started'
                ? 'running'
                : event.type === 'step_completed'
                  ? 'completed'
                  : 'failed';
          }
        });
        break;
      case 'tool_call': {
        this.update((s) => {
          s.toolActivity.push({
            callId: event.callId,
            toolId: event.toolId,
            argsPreview: event.argsPreview,
            permission: event.permission,
            executeOn: event.executeOn,
            status: 'running',
          });
        });
        // Client-delegated execution
        if (event.executeOn === 'client' && this.state.runId) {
          const result = await executeClientTool(event.toolId, event.args || {});
          authFetch(`/api/agent/runs/${this.state.runId}/tool-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: event.callId, result }),
          }).catch(() => {});
        }
        break;
      }
      case 'tool_result':
        this.update((s) => {
          const item = s.toolActivity.find((t) => t.callId === event.callId);
          if (item) {
            item.status = event.ok ? 'ok' : 'error';
            item.resultPreview = event.resultPreview;
            item.durationMs = event.durationMs;
            item.artifacts = event.artifacts;
          }
        });
        break;
      case 'approval_required':
        this.update((s) => {
          s.pendingApprovals.push({
            approvalId: event.approvalId,
            scope: event.scope,
            permission: event.permission,
            detail: event.detail,
            toolId: event.toolId,
            argsPreview: event.argsPreview,
          });
        });
        break;
      case 'approval_resolved':
        this.update((s) => {
          s.pendingApprovals = s.pendingApprovals.filter((a) => a.approvalId !== event.approvalId);
        });
        break;
      case 'verification':
        this.update((s) => {
          s.verification = { passed: event.passed, evidence: event.evidence };
        });
        break;
      case 'error':
        this.update((s) => {
          s.errorMessage = event.message;
        });
        break;
      case 'done':
        this.update((s) => {
          s.outcome = event.outcome;
          s.status = event.outcome === 'failed' ? 'failed' : 'done';
        });
        this.callbacks.onDone({ ...this.state }, (event as any).model);
        break;
      default:
        break;
    }
  }
}
