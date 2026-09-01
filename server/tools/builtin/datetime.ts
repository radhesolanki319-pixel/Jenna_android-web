/**
 * SAFE tool: current date/time with optional timezone.
 */

import { Tool, toolResultOk, toolResultErr } from '../../../src/core/tools/types';

export const datetimeNowTool: Tool<{ timezone?: string }> = {
  id: 'datetime.now',
  description:
    'Get the current date and time. Optionally specify an IANA timezone (e.g. "Asia/Kolkata", "America/New_York"). Use this whenever the user asks about the current time, date, or day.',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone identifier. Defaults to UTC when omitted.',
      },
    },
  },
  permission: 'SAFE',
  platforms: ['server'],
  timeoutMs: 2000,
  async execute(input) {
    const tz = input?.timezone || 'UTC';
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
      return toolResultOk({
        iso: now.toISOString(),
        timezone: tz,
        formatted,
        epochMs: now.getTime(),
      });
    } catch {
      return toolResultErr('invalid_timezone', `Unknown timezone "${tz}".`);
    }
  },
};
