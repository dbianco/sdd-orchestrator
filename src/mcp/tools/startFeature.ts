import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { startFeature } from '../../services/startFeature.js';
import { guarded } from '../encode.js';
import { ActorSchema, DecisionShape, FeatureStateShape, WarningsShape, WorkspaceShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerStartFeature(server: McpServer, deps: McpDeps): void {
  server.registerTool('start_feature', {
    title: 'Start a feature from an accepted routing decision',
    description: [
      'Creates lifecycle state for a task after the user accepted the route_task decision, pins the current framework version and policy, and builds the first context pack for the specify phase.',
      'Use it once per unit of work; to resume later use get_context or get_feature_status with the feature id. Refused when decision.framework is "none".',
      'Returns feature_id (keep it), context_pack (also in the text block), pack_id, feature state and next_instructions.',
      'Example: start_feature({"app":"checkout","actor":"daniel","task_description":"Add CSV export","decision":{...from route_task...},"workspace":{"estimated_files":4},"external_ref":"YAL-123"})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1), actor: ActorSchema, task_description: z.string().min(1),
      decision: DecisionShape.describe('The decision object returned by route_task, possibly with framework or track overridden by the user'),
      workspace: WorkspaceShape.optional(), feature_slug: z.string().min(1).optional(), external_ref: z.string().min(1).optional(),
      trigger_ref: z.string().min(1).optional(), policy_override_reason: z.string().min(1).optional(),
    },
    outputSchema: {
      feature_id: z.string(), context_pack: z.string(), pack_id: z.string(), feature: FeatureStateShape, next_instructions: z.string(), warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'start_feature', async () => {
    const r = await startFeature(deps, {
      app: args.app, actor: args.actor, task_description: args.task_description, decision: args.decision, workspace: args.workspace ?? null,
      feature_slug: args.feature_slug ?? null, external_ref: args.external_ref ?? null, trigger_ref: args.trigger_ref ?? null, policy_override_reason: args.policy_override_reason ?? null,
    });
    return { structured: { ...r }, text: r.context_pack };
  }));
}
