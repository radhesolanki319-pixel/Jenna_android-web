/**
 * Jarvis Tool System — shared contracts (client + server).
 * Every tool declares a JSON-Schema input contract, a permission tier,
 * and the platforms it can execute on. The server-side ToolExecutor is the
 * single authority for permission gating; client UIs only present approvals.
 */

export type PermissionLevel = 'SAFE' | 'SENSITIVE' | 'DANGEROUS';

export type ToolPlatform = 'server' | 'web' | 'android';

export interface JSONSchemaObject {
  type: 'object';
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface ToolDescriptor {
  /** Namespaced id, e.g. 'web.fetch_url', 'memory.search'. */
  id: string;
  description: string;
  inputSchema: JSONSchemaObject;
  permission: PermissionLevel;
  platforms: ToolPlatform[];
  timeoutMs: number;
}

export interface ToolArtifact {
  kind: 'text' | 'diff' | 'url' | 'citation' | 'json';
  title?: string;
  content: string;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolResult<O = unknown> {
  ok: boolean;
  data?: O;
  error?: ToolError;
  artifacts?: ToolArtifact[];
  durationMs: number;
  truncated?: boolean;
}

export interface ToolContext {
  runId: string;
  platform: ToolPlatform;
  signal?: AbortSignal;
}

export interface Tool<I = any, O = unknown> extends ToolDescriptor {
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
  /** Optional per-invocation risk escalation (e.g. destructive shell args). */
  assessRisk?(input: I): PermissionLevel;
}

/** Permission ordering helper: returns the more restrictive of two levels. */
export function maxPermission(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  const order: PermissionLevel[] = ['SAFE', 'SENSITIVE', 'DANGEROUS'];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

export function toolResultOk<O>(data: O, extra?: Partial<ToolResult<O>>): ToolResult<O> {
  return { ok: true, data, durationMs: 0, ...extra };
}

export function toolResultErr(
  code: string,
  message: string,
  retryable = false
): ToolResult<never> {
  return { ok: false, error: { code, message, retryable }, durationMs: 0 };
}

/** Compact, safe summary of a ToolResult for model consumption / event streams. */
export function summarizeToolResult(result: ToolResult, maxChars = 4000): string {
  if (!result.ok) {
    return `ERROR(${result.error?.code || 'unknown'}): ${result.error?.message || 'Tool failed.'}`;
  }
  let text: string;
  if (typeof result.data === 'string') {
    text = result.data;
  } else {
    try {
      text = JSON.stringify(result.data);
    } catch {
      text = String(result.data);
    }
  }
  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
  }
  return text;
}
