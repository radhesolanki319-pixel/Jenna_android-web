/**
 * Client-side tool implementations, backed by platformBridge and the memory
 * store. The server declares these tools to the model and gates permissions;
 * when a run needs one, the client receives a `tool_call` event with
 * executeOn:'client', executes here, and posts the result back.
 */

import { platformBridge } from '../bridge';
import { memoryService } from '../memoryStore';
import { ToolResult } from './types';

export type ClientToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const handlers: Record<string, ClientToolHandler> = {
  'memory.search': async (args) => {
    const started = Date.now();
    const query = String(args.query || '');
    const relevant = memoryService.getRelevantMemories(query, [], 8);
    return {
      ok: true,
      data: {
        query,
        results: relevant.map((m) => ({ category: m.category, fact: m.fact })),
      },
      durationMs: Date.now() - started,
    };
  },

  'memory.save': async (args) => {
    const started = Date.now();
    const category = String(args.category || 'preferences');
    const content = String(args.content || '').trim();
    if (!content) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'Memory content is empty.', retryable: false },
        durationMs: Date.now() - started,
      };
    }
    const validCategories = [
      'personal_facts',
      'preferences',
      'directives',
      'projects_and_goals',
      'work_context',
    ];
    await memoryService.addMemory(
      (validCategories.includes(category) ? category : 'preferences') as any,
      content,
      'medium',
      0.9
    );
    return { ok: true, data: { saved: true, category, content }, durationMs: Date.now() - started };
  },

  'device.vibrate': async (args) => {
    const started = Date.now();
    const pattern = String(args.pattern || 'light') as
      | 'light'
      | 'medium'
      | 'heavy'
      | 'success'
      | 'warning';
    platformBridge.vibrate(pattern);
    return { ok: true, data: { vibrated: true, pattern }, durationMs: Date.now() - started };
  },

  'device.share_text': async (args) => {
    const started = Date.now();
    const text = String(args.text || '');
    if (!text) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'Nothing to share.', retryable: false },
        durationMs: Date.now() - started,
      };
    }
    const shared = await platformBridge.shareText(text, args.title ? String(args.title) : undefined);
    return { ok: shared, data: { shared }, durationMs: Date.now() - started };
  },

  'device.open_url': async (args) => {
    const started = Date.now();
    const url = String(args.url || '');
    if (!/^https:\/\//i.test(url)) {
      return {
        ok: false,
        error: { code: 'blocked_url', message: 'Only https:// URLs can be opened.', retryable: false },
        durationMs: Date.now() - started,
      };
    }
    const opened = await platformBridge.openExternalUrl(url);
    return { ok: opened, data: { opened, url }, durationMs: Date.now() - started };
  },
};

export function getClientToolIds(): string[] {
  return Object.keys(handlers);
}

export async function executeClientTool(
  toolId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const handler = handlers[toolId];
  if (!handler) {
    return {
      ok: false,
      error: { code: 'unknown_tool', message: `Client tool "${toolId}" is not supported here.`, retryable: false },
      durationMs: 0,
    };
  }
  try {
    return await handler(args);
  } catch (err: any) {
    return {
      ok: false,
      error: { code: 'execution_error', message: err?.message || 'Client tool failed.', retryable: false },
      durationMs: 0,
    };
  }
}
