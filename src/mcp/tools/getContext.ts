import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getContext } from '../../services/getContext.js';
import { guarded } from '../encode.js';
import { ActorSchema, FeatureStateShape, PhaseSchema, ScopeSchema, WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerGetContext(server: McpServer, deps: McpDeps): void {
  server.registerTool('get_context', {
    title: 'Get the context pack for a feature phase',
    description: [
      'Assembles and persists a budgeted context pack for a feature: header and instructions, always-on standards, the phase template, retrieved app memory and standards, stack guide sections, stop conditions and the next gate.',
      'Use it to resume a feature in a new session, to refresh context in the current phase, or to steer retrieval with focus. Works on archived features. Each call persists a new pack.',
      'Returns context_pack (also in the text block), pack_id and feature state.',
      'Example: get_context({"feature_id":"f_01j9...","actor":"daniel","focus":"csv encoding","scope":"app"})',
    ].join(' '),
    inputSchema: {
      feature_id: z.string().min(1), actor: ActorSchema, phase: PhaseSchema.optional().describe('Defaults to the current phase'),
      focus: z.string().min(1).optional(), scope: ScopeSchema.optional(),
    },
    outputSchema: { context_pack: z.string(), pack_id: z.string(), feature: FeatureStateShape, warnings: WarningsShape },
  }, async (args) => guarded(deps.logger, 'get_context', async () => {
    const r = await getContext(deps, { feature_id: args.feature_id, actor: args.actor, phase: args.phase ?? null, focus: args.focus ?? null, scope: args.scope ?? 'app' });
    return { structured: { ...r }, text: r.context_pack };
  }));
}
