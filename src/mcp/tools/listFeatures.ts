import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listFeaturesService } from '../../services/listFeatures.js';
import { authorizeCall } from '../../auth/authorize.js';
import type { AuthContext } from '../../auth/context.js';
import { guarded } from '../encode.js';
import { WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerListFeatures(server: McpServer, deps: McpDeps, auth: AuthContext): void {
  server.registerTool('list_features', {
    title: 'List features of an app',
    description: [
      'Lists features for an app filtered by status (default active and blocked) and optionally by exact external_ref, newest first.',
      'Use it before route_task when working through a backlog, so an in-flight ticket is resumed with get_context instead of routed twice. Read-only.',
      'Returns features[] {feature_id, slug, intent, framework, track, current_phase, status, external_ref, trigger_ref, updated_at}.',
      'Example: list_features({"app":"checkout","external_ref":"YAL-123"})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1), status: z.array(z.enum(['active', 'blocked', 'archived'])).optional(), external_ref: z.string().min(1).optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    outputSchema: {
      features: z.array(z.object({
        feature_id: z.string(), slug: z.string(), intent: z.string(), framework: z.string(), track: z.string().nullable(), current_phase: z.string(),
        status: z.string(), external_ref: z.string().nullable(), trigger_ref: z.string().nullable(), updated_at: z.string(),
      })),
      warnings: WarningsShape.optional(),
    },
  }, async (args) => guarded(deps.logger, 'list_features', async () => {
    const a = await authorizeCall(deps.pool, auth, { apps: [args.app] }, undefined, false);
    const listed = await listFeaturesService(deps, { app: args.app, status: args.status, external_ref: args.external_ref ?? null, limit: args.limit });
    const r = { ...listed, ...(a.warnings.length > 0 ? { warnings: a.warnings } : {}) };
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
