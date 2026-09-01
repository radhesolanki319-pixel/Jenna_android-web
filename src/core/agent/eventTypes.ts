/**
 * Jarvis Agent Event Protocol — single source of truth shared by server and client.
 * Streamed over SSE from POST /api/agent/stream and persisted per-run for resume.
 */

import { PermissionLevel, ToolArtifact } from '../tools/types';

export type AgentRunStatus =
  | 'idle'
  | 'classifying'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'awaiting_tool_result'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled';

export type AgentRunOutcome = 'success' | 'partial' | 'failed';

export interface AgentStepDTO {
  id: string;
  description: string;
  toolIntent?: string;
  permission: PermissionLevel;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  summary?: string;
}

export interface AgentPlanDTO {
  goal: string;
  steps: AgentStepDTO[];
}

export interface FinalReport {
  outcome: AgentRunOutcome;
  summary: string;
  toolCallCount: number;
  verificationEvidence?: string;
}

export type AgentEvent =
  | { type: 'run_started'; runId: string; mode: 'chat' | 'task'; model: string }
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'plan_created'; plan: AgentPlanDTO }
  | { type: 'step_started'; stepId: string; description: string }
  | { type: 'step_completed'; stepId: string; summary?: string }
  | { type: 'step_failed'; stepId: string; error: string }
  | {
      type: 'tool_call';
      callId: string;
      toolId: string;
      argsPreview: string;
      args?: Record<string, unknown>;
      permission: PermissionLevel;
      executeOn: 'server' | 'client';
    }
  | {
      type: 'tool_result';
      callId: string;
      toolId: string;
      ok: boolean;
      resultPreview: string;
      durationMs: number;
      artifacts?: ToolArtifact[];
    }
  | {
      type: 'approval_required';
      approvalId: string;
      scope: 'plan' | 'tool';
      permission: PermissionLevel;
      detail: string;
      toolId?: string;
      argsPreview?: string;
    }
  | { type: 'approval_resolved'; approvalId: string; approved: boolean }
  | { type: 'verification'; passed: boolean; evidence: string }
  | { type: 'status'; status: AgentRunStatus }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'done'; runId: string; outcome: AgentRunOutcome; report: FinalReport; model?: string };

export interface AgentRunSnapshot {
  runId: string;
  status: AgentRunStatus;
  mode: 'chat' | 'task';
  plan?: AgentPlanDTO;
  events: AgentEvent[];
  createdAt: number;
  updatedAt: number;
}

/** Client-declared capabilities sent with each agent request. */
export interface AgentClientInfo {
  platform: 'web' | 'android';
  /** Ids of client-executable tools this client supports. */
  clientToolIds: string[];
}
