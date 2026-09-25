import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { startFeature } from '../../services/startFeature.js';
import { authorizeCall } from '../../auth/authorize.js';
import type { AuthContext } from '../../auth/context.js';
import { guarded } from '../encode.js';
import { ActorSchema, DecisionShape, FeatureStateShape, WarningsShape, WorkspaceShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerStartFeature(server: McpServer, deps: McpDeps, auth: AuthContext): void {
  server.registerTool('start_feature', {
    title: 'Start a feature from an accepted routing decision',
    description: [
      'Creates lifecycle state for a task after the user accepted the route_task decision, pins the current framework version and policy, and builds the first context pack for the specify phase.',
      'Use it once per unit of work; to resume later use get_context or get_feature_status with the feature id. Refused when decision.framework is "none".',
      'Returns feature_id (keep it), routing_id, context_pack (also in the text block), pack_id, feature state and next_instructions.',
      'Example: start_feature({"app":"checkout","actor":"daniel","task_description":"Add CSV export","decision":{"intent":"feature","framework":"openspec","track":"default","confidence":"high","rule":"10-brownfield-small-medium","reasons":["brownfield"],"high_risk":false,"policy_version":1,"framework_pack_version":"1.4.0"},"workspace":{"estimated_files":4},"external_ref":"YAL-123"})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1), actor: ActorSchema, task_description: z.string().min(1),
      decision: DecisionShape.describe('The decision object returned by route_task, possibly with framework or track overridden by the user'),
      workspace: WorkspaceShape.optional(), feature_slug: z.string().min(1).optional(), external_ref: z.string().trim().min(1).optional(),
      trigger_ref: z.string().min(1).optional(), policy_override_reason: z.string().min(1).optional(),
      routing_id: z.string().min(1).optional().describe('The routing_id returned by route_task; when omitted the event is found by external_ref or task text, or created'),
    },
    outputSchema: {
      feature_id: z.string(), routing_id: z.string(), context_pack: z.string(), pack_id: z.string(), feature: FeatureStateShape, next_instructions: z.string(), warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'start_feature', async () => {
    const a = await authorizeCall(deps.pool, auth, { apps: [args.app] }, args.actor, true);
    const raw = await startFeature(deps, {
      app: args.app, actor: a.actor!, task_description: args.task_description, decision: args.decision, workspace: args.workspace ?? null,
      feature_slug: args.feature_slug ?? null, external_ref: args.external_ref ?? null, trigger_ref: args.trigger_ref ?? null, policy_override_reason: args.policy_override_reason ?? null,
      routing_id: args.routing_id ?? null,
    });
    const r = { ...raw, warnings: [...a.warnings, ...raw.warnings] };
    return { structured: { ...r }, text: r.context_pack };
  }));
}
