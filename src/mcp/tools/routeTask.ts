import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { routeTask } from '../../services/routeTask.js';
import { guarded } from '../encode.js';
import { ActorSchema, AttachedLayerShape, DecisionShape, LitePackShape, WarningsShape, WorkspaceShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerRouteTask(server: McpServer, deps: McpDeps): void {
  server.registerTool('route_task', {
    title: 'Route a task to an SDD framework',
    description: [
      'Decides which spec-driven-development framework and track fit a task, using explainable rules over the app policy, the task text and workspace facts.',
      'Use it first for any new piece of work, and again with better facts when it returns clarifying_questions. It records one routing event per unit of work (deduplicated by external_ref or by task text) and returns its routing_id; it never touches repositories or lifecycle state.',
      'Returns decision {intent, framework or "none", track, confidence, rule, reasons, high_risk, policy_version, framework_pack_version}, clarifying_questions at medium confidence,',
      'guidance for spikes, a lite_pack for trivial work (no feature, no gates) and attached_layers. Pass the decision to start_feature to create lifecycle state.',
      'Example: route_task({"task_description":"Add CSV export to the orders page","app":"checkout","workspace":{"stack":["typescript","react"],"is_greenfield":false,"has_spec_library":true,"estimated_files":4,"paths_touched":["src/orders/"],"host":"claude-code"}})',
    ].join(' '),
    inputSchema: {
      task_description: z.string().min(1),
      app: z.string().min(1).describe('App slug registered with sdd-admin'),
      workspace: WorkspaceShape,
      framework_preference: z.string().min(1).optional().describe('Framework name, optionally with a track: "bmad:quick"'),
      actor: ActorSchema.optional(),
      external_ref: z.string().trim().min(1).optional().describe('Ticket id (Linear, Jira); becomes the dedup identity for this work'),
      trigger_ref: z.string().min(1).optional().describe('What caused the work: incident id, CVE, alert'),
    },
    outputSchema: {
      decision: DecisionShape,
      clarifying_questions: z.array(z.string()),
      guidance: z.string().nullable(),
      lite_pack: LitePackShape.nullable(),
      attached_layers: z.array(AttachedLayerShape),
      warnings: WarningsShape,
      routing_id: z.string(),
    },
  }, async (args) => guarded(deps.logger, 'route_task', async () => {
    const r = await routeTask(deps, {
      task_description: args.task_description, app: args.app, workspace: args.workspace, framework_preference: args.framework_preference ?? null,
      actor: args.actor ?? null, external_ref: args.external_ref ?? null, trigger_ref: args.trigger_ref ?? null,
    });
    const structured = {
      decision: r.decision, clarifying_questions: r.clarifying_questions, guidance: r.guidance,
      lite_pack: r.lite_pack ? { rendered: r.lite_pack.rendered, token_count: r.lite_pack.token_count, budget: r.lite_pack.budget, degraded: r.lite_pack.degraded, over_budget: r.lite_pack.over_budget, items: r.lite_pack.items } : null,
      attached_layers: r.attached_layers, warnings: r.warnings, routing_id: r.routing_id,
    };
    const text = r.lite_pack ? r.lite_pack.rendered : r.guidance ?? JSON.stringify({ decision: r.decision, clarifying_questions: r.clarifying_questions, attached_layers: r.attached_layers, warnings: r.warnings, routing_id: r.routing_id }, null, 2);
    return { structured, text };
  }));
}
