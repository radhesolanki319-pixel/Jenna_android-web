/**
 * Tool bootstrap — registers all builtin tools once.
 */

import { toolRegistry } from './registry';
import { datetimeNowTool } from './builtin/datetime';
import { calculatorTool } from './builtin/calculator';
import { fetchUrlTool } from './builtin/fetchUrl';
import { CLIENT_TOOLS } from './builtin/clientTools';

let bootstrapped = false;

export function bootstrapTools(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  toolRegistry.register(datetimeNowTool);
  toolRegistry.register(calculatorTool);
  toolRegistry.register(fetchUrlTool);
  for (const tool of CLIENT_TOOLS) {
    toolRegistry.register(tool);
  }
}

export { toolRegistry } from './registry';
export { executeTool } from './executor';
