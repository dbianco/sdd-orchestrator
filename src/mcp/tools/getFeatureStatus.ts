import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getFeatureStatus } from '../../services/featureStatus.js';
import { guarded } from '../encode.js';
import { FeatureStateShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerGetFeatureStatus(server: McpServer, deps: McpDeps): void {
  server.registerTool('get_feature_status', {
    title: 'Read a feature\'s state and history',
    description: [
      'Returns a feature\'s intent, framework and pinned version, track, current phase and alias, status, blocked reason, high_risk, failed_cycles, refs, allowed forward and backward targets, transition summaries and the latest pack id per phase.',
      'Use it to resume work, to check what the next gate expects, or to audit what happened. Read-only.',
      'Example: get_feature_status({"feature_id":"f_01j9..."})',
    ].join(' '),
    inputSchema: { feature_id: z.string().min(1) },
    outputSchema: {
      ...FeatureStateShape.shape,
      transitions: z.array(z.object({
        id: z.string(), from_phase: z.string(), to_phase: z.string(), direction: z.string(), result: z.string(), human_approved: z.boolean(),
        reason: z.string().nullable(), created_by: z.string(), created_at: z.string(), findings_count: z.number().int(),
      })),
      latest_pack_per_phase: z.record(z.string()),
    },
  }, async (args) => guarded(deps.logger, 'get_feature_status', async () => {
    const r = await getFeatureStatus(deps, args.feature_id);
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
