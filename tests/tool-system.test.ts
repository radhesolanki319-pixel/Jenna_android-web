import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry, toWireName, fromWireName } from '../server/tools/registry';
import { executeTool, validateAgainstSchema } from '../server/tools/executor';
import { Tool, toolResultOk } from '../src/core/tools/types';
import { datetimeNowTool } from '../server/tools/builtin/datetime';
import { calculatorTool } from '../server/tools/builtin/calculator';
import { isPublicAddress } from '../server/tools/builtin/fetchUrl';

// In-memory DB for tool-call logging
process.env.JARVIS_DB_MEMORY = 'true';

const autoApprove = async () => true;
const autoDeny = async () => false;
const ctx = { runId: 'run_test', platform: 'server' as const };

describe('Tool System (Jarvis Phase 2 — WS2)', () => {
  describe('ToolRegistry', () => {
    let registry: ToolRegistry;
    beforeEach(() => {
      registry = new ToolRegistry();
    });

    it('registers and resolves tools, rejecting duplicates', () => {
      registry.register(datetimeNowTool);
      expect(registry.get('datetime.now')).toBeDefined();
      expect(() => registry.register(datetimeNowTool)).toThrow();
    });

    it('maps dotted tool ids to wire-safe function names and back', () => {
      expect(toWireName('web.fetch_url')).toBe('web__fetch_url');
      expect(fromWireName('web__fetch_url')).toBe('web.fetch_url');
    });

    it('exports provider specs only for server tools plus supported client tools', () => {
      registry.register(datetimeNowTool);
      const clientTool: Tool = {
        id: 'device.vibrate',
        description: 'vibrate',
        inputSchema: { type: 'object' },
        permission: 'SAFE',
        platforms: ['android'],
        timeoutMs: 1000,
        execute: async () => toolResultOk({}),
      };
      registry.register(clientTool);

      const withoutClient = registry.toProviderSpecs({ clientToolIds: [] });
      expect(withoutClient.map((s) => s.name)).toEqual(['datetime__now']);

      const withClient = registry.toProviderSpecs({ clientToolIds: ['device.vibrate'] });
      expect(withClient.map((s) => s.name)).toContain('device__vibrate');
    });
  });

  describe('Schema validation', () => {
    it('rejects missing required parameters', () => {
      const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };
      expect(validateAgainstSchema({}, schema).valid).toBe(false);
      expect(validateAgainstSchema({ q: 'ok' }, schema).valid).toBe(true);
    });

    it('rejects wrong types and invalid enums', () => {
      const schema = {
        type: 'object',
        properties: { n: { type: 'number' }, mode: { type: 'string', enum: ['a', 'b'] } },
      };
      expect(validateAgainstSchema({ n: 'not-a-number' }, schema).valid).toBe(false);
      expect(validateAgainstSchema({ mode: 'c' }, schema).valid).toBe(false);
      expect(validateAgainstSchema({ n: 3, mode: 'a' }, schema).valid).toBe(true);
    });
  });

  describe('ToolExecutor', () => {
    it('executes a SAFE tool end-to-end', async () => {
      const result = await executeTool(datetimeNowTool, { timezone: 'Asia/Kolkata' }, ctx, autoApprove);
      expect(result.ok).toBe(true);
      expect((result.data as any).timezone).toBe('Asia/Kolkata');
    });

    it('returns invalid_input for schema violations without executing', async () => {
      const spy = vi.fn();
      const tool: Tool = {
        id: 'test.tool',
        description: 't',
        inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
        permission: 'SAFE',
        platforms: ['server'],
        timeoutMs: 1000,
        execute: async (i) => {
          spy();
          return toolResultOk(i);
        },
      };
      const result = await executeTool(tool, {}, ctx, autoApprove);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('invalid_input');
      expect(spy).not.toHaveBeenCalled();
    });

    it('denies execution when permission decider rejects', async () => {
      const result = await executeTool(datetimeNowTool, {}, ctx, autoDeny);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('permission_denied');
    });

    it('escalates permission via assessRisk (fake dangerous tool)', async () => {
      const seen: string[] = [];
      const dangerousTool: Tool<{ cmd: string }> = {
        id: 'test.shell',
        description: 'fake shell',
        inputSchema: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
        permission: 'SENSITIVE',
        platforms: ['server'],
        timeoutMs: 1000,
        assessRisk: (input) => (/rm\s+-rf/.test(input.cmd) ? 'DANGEROUS' : 'SENSITIVE'),
        execute: async () => toolResultOk({ ran: true }),
      };
      const decider = async (_id: string, level: string) => {
        seen.push(level);
        return true;
      };
      await executeTool(dangerousTool, { cmd: 'ls -la' }, ctx, decider);
      await executeTool(dangerousTool, { cmd: 'rm -rf /' }, ctx, decider);
      expect(seen).toEqual(['SENSITIVE', 'DANGEROUS']);
    });

    it('times out long-running tools', async () => {
      const slowTool: Tool = {
        id: 'test.slow',
        description: 'slow',
        inputSchema: { type: 'object' },
        permission: 'SAFE',
        platforms: ['server'],
        timeoutMs: 50,
        execute: () => new Promise((resolve) => setTimeout(() => resolve(toolResultOk({})), 5000)),
      };
      const result = await executeTool(slowTool, {}, ctx, autoApprove);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('timeout');
    });

    it('caps oversized string output and flags truncation', async () => {
      const bigTool: Tool = {
        id: 'test.big',
        description: 'big',
        inputSchema: { type: 'object' },
        permission: 'SAFE',
        platforms: ['server'],
        timeoutMs: 1000,
        execute: async () => toolResultOk('x'.repeat(100_000)),
      };
      const result = await executeTool(bigTool, {}, ctx, autoApprove);
      expect(result.ok).toBe(true);
      expect((result.data as string).length).toBeLessThanOrEqual(32_000);
      expect(result.truncated).toBe(true);
    });

    it('redacts secrets from tool output', async () => {
      const leakyTool: Tool = {
        id: 'test.leaky',
        description: 'leaks',
        inputSchema: { type: 'object' },
        permission: 'SAFE',
        platforms: ['server'],
        timeoutMs: 1000,
        execute: async () => toolResultOk('found key AIzaSyD-1234567890abcdefghijklmnopqrst here'),
      };
      const result = await executeTool(leakyTool, {}, ctx, autoApprove);
      expect(result.data as string).not.toContain('AIzaSyD-1234567890');
    });
  });

  describe('Builtin: math.calculate', () => {
    it('evaluates arithmetic without eval()', async () => {
      const result = await executeTool(calculatorTool, { expression: '(145*38)/sqrt(16)' }, ctx, autoApprove);
      expect(result.ok).toBe(true);
      expect((result.data as any).result).toBeCloseTo(1377.5);
    });

    it('handles operator precedence and powers', async () => {
      const result = await executeTool(calculatorTool, { expression: '2+3*4^2' }, ctx, autoApprove);
      expect((result.data as any).result).toBe(50);
    });

    it('rejects division by zero and garbage input', async () => {
      const div = await executeTool(calculatorTool, { expression: '1/0' }, ctx, autoApprove);
      expect(div.ok).toBe(false);
      const garbage = await executeTool(calculatorTool, { expression: 'process.exit(1)' }, ctx, autoApprove);
      expect(garbage.ok).toBe(false);
    });
  });

  describe('Builtin: web.fetch_url SSRF guard', () => {
    it('classifies private/internal addresses correctly', () => {
      expect(isPublicAddress('127.0.0.1')).toBe(false);
      expect(isPublicAddress('10.0.0.5')).toBe(false);
      expect(isPublicAddress('172.16.9.1')).toBe(false);
      expect(isPublicAddress('192.168.1.1')).toBe(false);
      expect(isPublicAddress('169.254.169.254')).toBe(false); // cloud metadata
      expect(isPublicAddress('100.64.0.1')).toBe(false); // CGNAT
      expect(isPublicAddress('::1')).toBe(false);
      expect(isPublicAddress('fd00::1')).toBe(false);
      expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
      expect(isPublicAddress('8.8.8.8')).toBe(true);
      expect(isPublicAddress('142.250.183.14')).toBe(true);
    });

    it('blocks non-https schemes and IP literals', async () => {
      const { fetchUrlTool } = await import('../server/tools/builtin/fetchUrl');
      const httpRes = await executeTool(fetchUrlTool, { url: 'http://example.com' }, ctx, autoApprove);
      expect(httpRes.ok).toBe(false);
      expect(httpRes.error?.code).toBe('blocked_url');

      const ipRes = await executeTool(fetchUrlTool, { url: 'https://127.0.0.1/secret' }, ctx, autoApprove);
      expect(ipRes.ok).toBe(false);

      const fileRes = await executeTool(fetchUrlTool, { url: 'file:///etc/passwd' }, ctx, autoApprove);
      expect(fileRes.ok).toBe(false);

      const localhostRes = await executeTool(fetchUrlTool, { url: 'https://localhost/admin' }, ctx, autoApprove);
      expect(localhostRes.ok).toBe(false);
    });

    it('is registered as SENSITIVE by default', async () => {
      const { fetchUrlTool } = await import('../server/tools/builtin/fetchUrl');
      expect(fetchUrlTool.permission).toBe('SENSITIVE');
    });
  });
});
