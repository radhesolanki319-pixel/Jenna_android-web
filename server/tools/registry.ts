/**
 * Server ToolRegistry — registration, discovery, and provider-spec export.
 */

import { Tool, ToolDescriptor } from '../../src/core/tools/types';
import { AIToolSpec } from '../../src/types/ai';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool "${tool.id}" is already registered.`);
    }
    this.tools.set(tool.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  list(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map(
      ({ id, description, inputSchema, permission, platforms, timeoutMs }) => ({
        id,
        description,
        inputSchema,
        permission,
        platforms,
        timeoutMs,
      })
    );
  }

  /**
   * Exports tool declarations for the model. Tool ids use dots (web.fetch_url)
   * but most providers restrict function names, so dots become double
   * underscores on the wire and are mapped back on receipt.
   */
  toProviderSpecs(opts?: { clientToolIds?: string[] }): AIToolSpec[] {
    const clientSet = new Set(opts?.clientToolIds || []);
    return Array.from(this.tools.values())
      .filter((t) => {
        if (t.platforms.includes('server')) return true;
        // client-executed tools are only offered when the client supports them
        return clientSet.has(t.id);
      })
      .map((t) => ({
        name: toWireName(t.id),
        description: t.description,
        inputSchema: t.inputSchema,
      }));
  }

  resolveWireName(wireName: string): Tool | undefined {
    return this.tools.get(fromWireName(wireName));
  }

  /** Test hook. */
  _clear(): void {
    this.tools.clear();
  }
}

export function toWireName(toolId: string): string {
  return toolId.replace(/\./g, '__');
}

export function fromWireName(wireName: string): string {
  return wireName.replace(/__/g, '.');
}

export const toolRegistry = new ToolRegistry();
