/**
 * ToolExecutor — the single authority for tool execution on the server.
 * Pipeline: schema validation → permission gate → timeout-bounded execution
 * → output capping → secret redaction → persistent logging.
 */

import crypto from 'crypto';
import { Tool, ToolContext, ToolResult, PermissionLevel, maxPermission } from '../../src/core/tools/types';
import { redactSecrets, redactDeep } from '../middleware/redact';
import { logToolCall, completeToolCall } from '../db/index';

const MAX_OUTPUT_CHARS = 32_000;

export interface PermissionDecider {
  /**
   * Returns true if the call may proceed, false if denied.
   * For SENSITIVE/DANGEROUS calls the orchestrator wires this to the
   * user-approval flow; SAFE calls are auto-approved.
   */
  (toolId: string, permission: PermissionLevel, argsPreview: string): Promise<boolean>;
}

export function validateAgainstSchema(
  input: unknown,
  schema: { type?: string; properties?: Record<string, any>; required?: string[] }
): { valid: boolean; error?: string } {
  if (schema.type === 'object') {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, error: 'Input must be an object.' };
    }
    const obj = input as Record<string, unknown>;
    for (const req of schema.required || []) {
      if (!(req in obj) || obj[req] === undefined || obj[req] === null) {
        return { valid: false, error: `Missing required parameter "${req}".` };
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (!(key in obj) || obj[key] === undefined) continue;
      const value = obj[key];
      const t = (propSchema as any).type;
      if (t === 'string' && typeof value !== 'string') {
        return { valid: false, error: `Parameter "${key}" must be a string.` };
      }
      if (t === 'number' && typeof value !== 'number') {
        return { valid: false, error: `Parameter "${key}" must be a number.` };
      }
      if (t === 'boolean' && typeof value !== 'boolean') {
        return { valid: false, error: `Parameter "${key}" must be a boolean.` };
      }
      if (t === 'array' && !Array.isArray(value)) {
        return { valid: false, error: `Parameter "${key}" must be an array.` };
      }
      const enumVals = (propSchema as any).enum;
      if (Array.isArray(enumVals) && !enumVals.includes(value)) {
        return { valid: false, error: `Parameter "${key}" must be one of: ${enumVals.join(', ')}.` };
      }
    }
    return { valid: true };
  }
  return { valid: true };
}

export function argsPreview(args: unknown, maxChars = 400): string {
  let raw: string;
  try {
    raw = JSON.stringify(redactDeep(args));
  } catch {
    raw = String(args);
  }
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}…` : raw;
}

function capAndRedact(result: ToolResult): ToolResult {
  const out: ToolResult = { ...result };
  if (typeof out.data === 'string') {
    let text = out.data;
    if (text.length > MAX_OUTPUT_CHARS) {
      text = text.slice(0, MAX_OUTPUT_CHARS);
      out.truncated = true;
    }
    out.data = redactSecrets(text);
  } else if (out.data !== undefined) {
    out.data = redactDeep(out.data);
  }
  if (out.error) {
    out.error = { ...out.error, message: redactSecrets(out.error.message) };
  }
  if (out.artifacts) {
    out.artifacts = out.artifacts.map((a) => ({ ...a, content: redactSecrets(a.content) }));
  }
  return out;
}

export async function executeTool(
  tool: Tool,
  input: unknown,
  ctx: ToolContext,
  decidePermission: PermissionDecider
): Promise<ToolResult> {
  const callLogId = `tc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const started = Date.now();

  const finish = (result: ToolResult, approved: boolean): ToolResult => {
    const finalResult = capAndRedact({ ...result, durationMs: Date.now() - started });
    try {
      logToolCall({
        id: callLogId,
        runId: ctx.runId,
        toolId: tool.id,
        argsJson: argsPreview(input, 4000),
        permission: effectivePermission,
        approved,
      });
      completeToolCall(callLogId, JSON.stringify(redactDeep(finalResult)).slice(0, 16_000));
    } catch (err) {
      console.warn('[ToolExecutor] Failed to log tool call:', err);
    }
    return finalResult;
  };

  // 1. Schema validation
  const validation = validateAgainstSchema(input, tool.inputSchema);
  let effectivePermission: PermissionLevel = tool.permission;
  if (!validation.valid) {
    return finish(
      {
        ok: false,
        error: { code: 'invalid_input', message: validation.error || 'Invalid input.', retryable: false },
        durationMs: 0,
      },
      false
    );
  }

  // 2. Per-invocation risk escalation
  if (tool.assessRisk) {
    try {
      effectivePermission = maxPermission(tool.permission, tool.assessRisk(input));
    } catch {
      effectivePermission = tool.permission;
    }
  }

  // 3. Permission gate (SAFE auto-approves inside the decider)
  const approved = await decidePermission(tool.id, effectivePermission, argsPreview(input));
  if (!approved) {
    return finish(
      {
        ok: false,
        error: { code: 'permission_denied', message: 'The user declined this action.', retryable: false },
        durationMs: 0,
      },
      false
    );
  }

  // 4. Timeout-bounded execution
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);
  const linkedCtx: ToolContext = { ...ctx, signal: controller.signal };
  try {
    const result = await Promise.race<ToolResult>([
      tool.execute(input, linkedCtx),
      new Promise<ToolResult>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`Tool "${tool.id}" timed out after ${tool.timeoutMs}ms.`))
        );
      }),
    ]);
    return finish(result, true);
  } catch (err: any) {
    return finish(
      {
        ok: false,
        error: {
          code: controller.signal.aborted ? 'timeout' : 'execution_error',
          message: err?.message || 'Tool execution failed.',
          retryable: controller.signal.aborted,
        },
        durationMs: 0,
      },
      true
    );
  } finally {
    clearTimeout(timeout);
  }
}
