/**
 * Client-executed tool declarations (memory + device tools).
 *
 * These tools run on the CLIENT (web or Android) because the data/hardware
 * lives there (localStorage/Room memories, vibration motor, share sheet).
 * The server declares them to the model and gates permissions; execution is
 * delegated over the agent event stream:
 *
 *   server → event: tool_call { executeOn: 'client' }
 *   client → POST /api/agent/runs/:id/tool-result
 *
 * The `execute` implementations here are placeholders that must never run —
 * the PlanExecutor routes client tools through the delegation path instead.
 */

import { Tool, toolResultErr } from '../../../src/core/tools/types';

function clientOnlyExecute(toolId: string) {
  return async () =>
    toolResultErr(
      'client_only',
      `Tool "${toolId}" executes on the client; server-side execution is not permitted.`
    );
}

export const memorySearchTool: Tool<{ query: string }> = {
  id: 'memory.search',
  description:
    "Search the user's long-term memory (personal facts, preferences, directives, projects, work context). Use when the user references something they may have told you before.",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to search memories for.' },
    },
    required: ['query'],
  },
  permission: 'SAFE',
  platforms: ['web', 'android'],
  timeoutMs: 10_000,
  execute: clientOnlyExecute('memory.search'),
};

export const memorySaveTool: Tool<{ category: string; content: string }> = {
  id: 'memory.save',
  description:
    'Save a durable fact about the user to long-term memory. Use only for facts the user would want remembered across sessions (preferences, personal facts, standing instructions, projects).',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['personal_facts', 'preferences', 'directives', 'projects_and_goals', 'work_context'],
        description: 'Memory category.',
      },
      content: {
        type: 'string',
        description: 'A clear, standalone statement about the user in third person.',
      },
    },
    required: ['category', 'content'],
  },
  permission: 'SENSITIVE',
  platforms: ['web', 'android'],
  timeoutMs: 10_000,
  execute: clientOnlyExecute('memory.save'),
};

export const deviceVibrateTool: Tool<{ pattern?: string }> = {
  id: 'device.vibrate',
  description: 'Vibrate the user\'s device briefly (haptic feedback). Android and supported browsers only.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        enum: ['light', 'medium', 'heavy', 'success', 'warning'],
        description: 'Haptic pattern intensity. Defaults to "light".',
      },
    },
  },
  permission: 'SAFE',
  platforms: ['web', 'android'],
  timeoutMs: 5_000,
  execute: clientOnlyExecute('device.vibrate'),
};

export const deviceShareTextTool: Tool<{ text: string; title?: string }> = {
  id: 'device.share_text',
  description: 'Open the device share sheet with the given text so the user can share it to another app.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text content to share.' },
      title: { type: 'string', description: 'Optional share dialog title.' },
    },
    required: ['text'],
  },
  permission: 'SAFE',
  platforms: ['web', 'android'],
  timeoutMs: 30_000,
  execute: clientOnlyExecute('device.share_text'),
};

export const deviceOpenUrlTool: Tool<{ url: string }> = {
  id: 'device.open_url',
  description: 'Open a URL in the user\'s external browser. Requires user approval.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The https:// URL to open.' },
    },
    required: ['url'],
  },
  permission: 'SENSITIVE',
  platforms: ['web', 'android'],
  timeoutMs: 15_000,
  execute: clientOnlyExecute('device.open_url'),
};

export const CLIENT_TOOLS = [
  memorySearchTool,
  memorySaveTool,
  deviceVibrateTool,
  deviceShareTextTool,
  deviceOpenUrlTool,
];
