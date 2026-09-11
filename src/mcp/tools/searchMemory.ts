import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchMemory } from '../../services/searchMemory.js';
import { guarded } from '../encode.js';
import { ScopeSchema, WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerSearchMemory(server: McpServer, deps: McpDeps): void {
  server.registerTool('search_memory', {
    title: 'Search the knowledge base',
    description: [
      'Searches app memory, standards, stack guides and framework material by meaning and by exact identifiers (ADR-n, REQ-n, US-n, INC-n), scoped to the app by default.',
      'Use it for an explicit lookup outside the context pack, including cross-app questions with scope "company" or a list of app slugs. Read-only; degrades to exact-id matches when embeddings are unavailable.',
      'Returns chunks[] {item_id, stable_id, version, app, kind, memory_type, heading_path, text, score, match}.',
      'Example: search_memory({"query":"how do other apps handle CSV encoding","app":"checkout","scope":"company"})',
    ].join(' '),
    inputSchema: {
      query: z.string().min(1), app: z.string().min(1).describe('Referent app for scope "app"'), scope: ScopeSchema.optional(),
      kinds: z.array(z.enum(['framework_pack', 'standard', 'stack_guide', 'app_memory'])).optional(), limit: z.number().int().positive().max(50).optional(),
    },
    outputSchema: {
      chunks: z.array(z.object({
        item_id: z.string(), stable_id: z.string(), version: z.number().int(), app: z.string().nullable(), kind: z.string(), memory_type: z.string().nullable(),
        heading_path: z.string(), text: z.string(), score: z.number(), match: z.enum(['vector', 'exact_id']),
      })),
      degraded: z.boolean(), warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'search_memory', async () => {
    const r = await searchMemory(deps, { query: args.query, app: args.app, scope: args.scope, kinds: args.kinds, limit: args.limit });
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
