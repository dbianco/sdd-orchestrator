import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { recordCommit } from '../../services/recordCommit.js';
import { guarded } from '../encode.js';
import { ActorSchema } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerRecordCommit(server: McpServer, deps: McpDeps): void {
  server.registerTool('record_commit', {
    title: 'Link a commit to routed work or a feature',
    description: [
      'Records a commit the host made and anchors it to the work it belongs to: pass exactly one of routing_id (from route_task), feature_id (from start_feature) or external_ref (a ticket already routed).',
      'Call it after every commit for trivial work and for features alike. Idempotent per (app, sha): reporting the same commit again refreshes message and files and keeps existing links.',
      'The server never reads git; it stores what you report. Returns commit_id, the resolved routing_id and feature_id, and deduplicated.',
      'Example: record_commit({"app":"checkout","actor":"daniel","sha":"a1b2c3d","message":"fix: date range validation","files_changed":["src/dates.ts"],"routing_id":"r_01j9..."})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1).describe('App slug registered with sdd-admin'),
      actor: ActorSchema,
      sha: z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'sha must be 7-64 hex characters'),
      message: z.string().min(1).max(10_000),
      branch: z.string().min(1).optional(),
      files_changed: z.array(z.string().min(1).max(512)).max(500).optional(),
      committed_at: z.string().datetime({ offset: true }).optional().describe('Author date, ISO 8601'),
      routing_id: z.string().min(1).optional(),
      feature_id: z.string().min(1).optional(),
      external_ref: z.string().min(1).optional().describe('Ticket id already passed to route_task'),
    },
    outputSchema: {
      commit_id: z.string(), routing_id: z.string().nullable(), feature_id: z.string().nullable(), deduplicated: z.boolean(),
    },
  }, async (args) => guarded(deps.logger, 'record_commit', async () => {
    const r = await recordCommit(deps, {
      app: args.app, actor: args.actor, sha: args.sha, message: args.message, branch: args.branch ?? null, files_changed: args.files_changed ?? null,
      committed_at: args.committed_at ?? null, routing_id: args.routing_id ?? null, feature_id: args.feature_id ?? null, external_ref: args.external_ref ?? null,
    });
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
