import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../logging.js';
import type { ServiceDeps } from '../services/deps.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAdvancePhase } from './tools/advancePhase.js';
import { registerGetContext } from './tools/getContext.js';
import { registerGetFeatureStatus } from './tools/getFeatureStatus.js';
import { registerListFeatures } from './tools/listFeatures.js';
import { registerProposeMemory } from './tools/proposeMemory.js';
import { registerRouteTask } from './tools/routeTask.js';
import { registerSearchMemory } from './tools/searchMemory.js';
import { registerStartFeature } from './tools/startFeature.js';

export interface McpDeps extends ServiceDeps { logger: Logger }

export const SERVER_INFO = { name: 'sdd-orchestrator', version: '0.1.0' };

export type Registrar = (server: McpServer, deps: McpDeps) => void;
const registrars: Registrar[] = [registerRouteTask, registerStartFeature, registerGetContext, registerAdvancePhase, registerGetFeatureStatus, registerListFeatures, registerSearchMemory, registerProposeMemory, registerResources, registerPrompts];

/** Later tasks push their registrar to the array literal directly. Keep the array literal as the single list of what the server exposes. */
export function addRegistrar(r: Registrar): void { registrars.push(r); }

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const r of registrars) r(server, deps);
  return server;
}
