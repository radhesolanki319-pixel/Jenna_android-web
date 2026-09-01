/**
 * Agent activity UI — plan card, tool timeline, approval cards, run status.
 * Rendered inline above/inside the streaming assistant message.
 */

import React, { useState } from 'react';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Ban,
} from 'lucide-react';
import { AgentRunState, ToolActivityItem, PendingApprovalItem } from '../../core/agent/agentClient';

// ---------------------------------------------------------------------------

function PermissionBadge({ level }: { level: string }) {
  if (level === 'DANGEROUS') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
        <ShieldAlert className="h-3 w-3" /> Dangerous
      </span>
    );
  }
  if (level === 'SENSITIVE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
        <ShieldAlert className="h-3 w-3" /> Sensitive
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
      <ShieldCheck className="h-3 w-3" /> Safe
    </span>
  );
}

// ---------------------------------------------------------------------------

export function PlanCard({ state }: { state: AgentRunState }) {
  const [expanded, setExpanded] = useState(true);
  if (!state.plan) return null;

  return (
    <div className="mb-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
        <ListChecks className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-medium text-slate-200">Plan: {state.plan.goal}</span>
      </button>
      {expanded && (
        <ol className="mt-2 space-y-1.5 pl-6">
          {state.plan.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2 text-sm">
              {step.status === 'completed' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : step.status === 'failed' ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              ) : step.status === 'running' ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-400" />
              ) : (
                <div className="mt-1 h-3 w-3 shrink-0 rounded-full border border-slate-600" />
              )}
              <span className="text-slate-300">
                {step.description}
                {step.toolIntent && (
                  <code className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-indigo-300">
                    {step.toolIntent}
                  </code>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ToolActivityRow({ item }: { item: ToolActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {item.status === 'running' ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />
        ) : item.status === 'ok' ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <code className="text-xs text-slate-200">{item.toolId}</code>
        <span className="ml-auto flex items-center gap-2">
          {typeof item.durationMs === 'number' && (
            <span className="text-[10px] text-slate-500">{item.durationMs}ms</span>
          )}
          <PermissionBadge level={item.permission} />
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-800 px-3 py-2 text-xs">
          <div className="mb-1 text-slate-400">
            <span className="font-semibold text-slate-300">Args: </span>
            <code className="break-all">{item.argsPreview}</code>
          </div>
          {item.resultPreview && (
            <div className="text-slate-400">
              <span className="font-semibold text-slate-300">Result: </span>
              <span className="whitespace-pre-wrap break-all">{item.resultPreview}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolActivityTimeline({ state }: { state: AgentRunState }) {
  if (state.toolActivity.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5">
      {state.toolActivity.map((item) => (
        <ToolActivityRow key={item.callId} item={item} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: PendingApprovalItem;
  onResolve: (approvalId: string, approved: boolean, grantForRun: boolean) => void;
}) {
  const isDangerous = approval.permission === 'DANGEROUS';
  return (
    <div
      className={`mb-3 rounded-xl border p-3 ${
        isDangerous
          ? 'border-red-500/50 bg-red-950/30'
          : 'border-amber-500/40 bg-amber-950/20'
      }`}
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${isDangerous ? 'text-red-400' : 'text-amber-400'}`} />
        <span className="text-sm font-semibold text-slate-100">
          {isDangerous ? 'Confirmation required' : 'Approval required'}
        </span>
        <PermissionBadge level={approval.permission} />
      </div>
      <p className="mt-1.5 text-sm text-slate-300">{approval.detail}</p>
      {approval.toolId && (
        <div className="mt-1 text-xs text-slate-400">
          Tool: <code className="text-indigo-300">{approval.toolId}</code>
        </div>
      )}
      {approval.argsPreview && (
        <pre className="mt-1.5 max-h-32 overflow-auto rounded-lg bg-slate-900/80 p-2 text-[11px] text-slate-300">
          {approval.argsPreview}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onResolve(approval.approvalId, true, false)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          Approve
        </button>
        {!isDangerous && approval.scope === 'tool' && (
          <button
            onClick={() => onResolve(approval.approvalId, true, true)}
            className="rounded-lg bg-emerald-800/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-700/70"
          >
            Approve for this run
          </button>
        )}
        <button
          onClick={() => onResolve(approval.approvalId, false, false)}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-600"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function RunStatusBar({
  state,
  onCancel,
}: {
  state: AgentRunState;
  onCancel: () => void;
}) {
  if (!state.runId || state.mode !== 'task') return null;
  const isActive = !['done', 'failed', 'cancelled', 'idle'].includes(state.status);
  const label =
    state.status === 'classifying'
      ? 'Understanding request…'
      : state.status === 'planning'
        ? 'Creating plan…'
        : state.status === 'awaiting_approval'
          ? 'Waiting for your approval'
          : state.status === 'awaiting_tool_result'
            ? 'Running on device…'
            : state.status === 'executing'
              ? 'Working…'
              : state.status === 'verifying'
                ? 'Verifying…'
                : state.status === 'failed'
                  ? 'Task failed'
                  : state.status === 'done'
                    ? state.outcome === 'success'
                      ? 'Task completed'
                      : 'Task partially completed'
                    : state.status;

  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-1.5">
      {isActive ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
      ) : state.outcome === 'failed' ? (
        <XCircle className="h-3.5 w-3.5 text-red-400" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      )}
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {state.verification && (
        <span className="text-[10px] text-slate-500">
          · verification {state.verification.passed ? 'passed' : 'not passed'}
        </span>
      )}
      {isActive && (
        <button
          onClick={onCancel}
          className="ml-auto flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
        >
          <Ban className="h-3 w-3" /> Cancel
        </button>
      )}
    </div>
  );
}

export function AgentActivityBlock({
  state,
  onResolveApproval,
  onCancel,
}: {
  state: AgentRunState;
  onResolveApproval: (approvalId: string, approved: boolean, grantForRun: boolean) => void;
  onCancel: () => void;
}) {
  if (!state.runId || state.mode !== 'task') return null;
  return (
    <div className="mb-2">
      <RunStatusBar state={state} onCancel={onCancel} />
      <PlanCard state={state} />
      <ToolActivityTimeline state={state} />
      {state.pendingApprovals.map((a) => (
        <ApprovalCard key={a.approvalId} approval={a} onResolve={onResolveApproval} />
      ))}
    </div>
  );
}
