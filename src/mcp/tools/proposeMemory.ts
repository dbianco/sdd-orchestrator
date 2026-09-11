import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { proposeMemory } from '../../services/proposeMemory.js';
import { guarded } from '../encode.js';
import { ActorSchema } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerProposeMemory(server: McpServer, deps: McpDeps): void {
  server.registerTool('propose_memory', {
    title: 'Propose new app memory or a standard',
    description: [
      'Records a proposal for a new ADR, decision, constraint, incident note or standard, linked to the feature that produced it, for an admin to approve with sdd-admin.',
      'Use it in the learn phase or whenever a durable decision was made. Approved proposals become retrievable items; supersedes retires the item a change replaces. Refused on archived features.',
      'Returns proposal_id and status "pending".',
      'Example: propose_memory({"feature_id":"f_01j9...","actor":"daniel","kind":"app_memory","memory_type":"adr","title":"ADR-9 CSV exports stream rather than buffer","body":"...","links":["openspec/changes/archive/2026-09-10-orders-csv-export/"]})',
    ].join(' '),
    inputSchema: {
      feature_id: z.string().min(1), actor: ActorSchema, kind: z.enum(['app_memory', 'standard']),
      memory_type: z.enum(['adr', 'decision', 'constraint', 'incident']).optional().describe('Required for app_memory'),
      title: z.string().min(1), body: z.string().min(1), stack_tags: z.array(z.string()).optional(),
      links: z.array(z.string()).optional().describe('Paths or ticket ids of archived artifacts'), supersedes: z.string().min(1).optional().describe('stable_id of an active item this one replaces'),
    },
    outputSchema: { proposal_id: z.string(), status: z.literal('pending') },
  }, async (args) => guarded(deps.logger, 'propose_memory', async () => {
    const r = await proposeMemory(deps, { ...args, memory_type: args.memory_type ?? null, supersedes: args.supersedes ?? null });
    return { structured: { ...r }, text: JSON.stringify(r) };
  }));
}
