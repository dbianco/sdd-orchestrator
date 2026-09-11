import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('route_task over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('lists exactly the eight tools with output schemas', async () => {
    await withClient('stdio', async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['advance_phase', 'get_context', 'get_feature_status', 'list_features', 'propose_memory', 'route_task', 'search_memory', 'start_feature']);
      for (const t of tools) {
        expect(t.description).toMatch(/Example:/);
        expect(t.outputSchema).toBeDefined();
        // The Example: line is `Example: tool_name({...})`; the JSON payload is everything
        // between the call's outer parens, i.e. the whole remainder minus the final `)`.
        const m = /Example:\s*[a-z_]+\((.+)\)$/.exec(t.description!);
        expect(m, `tool ${t.name} has no extractable Example: payload`).not.toBeNull();
        expect(() => JSON.parse(m![1]!), `tool ${t.name}'s Example: payload is not valid JSON`).not.toThrow();
      }
    });
  });

  it('routes, returns structuredContent, and writes nothing', async () => {
    await withClient('stdio', async (client) => {
      const r = await client.callTool({ name: 'route_task', arguments: { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' } });
      const s = structuredOf<{ decision: { framework: string }; attached_layers: unknown[] }>(r);
      expect(s.decision.framework).toBe('mini');
      expect(s.attached_layers).toHaveLength(2);
      expect(JSON.parse(textOf(r)).decision.framework).toBe('mini');
      const pool = await getTestPool();
      expect((await pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
    });
  });

  it('returns a lite pack for trivial and errors as isError results', async () => {
    await withClient('stdio', async (client) => {
      const lite = await client.callTool({ name: 'route_task', arguments: { task_description: 'Rename', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 } } });
      expect(textOf(lite)).toContain('# Lite pack');
      const err = await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'nope', workspace: {} } });
      expect(errorOf(err)).toMatchObject({ code: 'APP_NOT_FOUND' });
      const unknown = await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: {}, framework_preference: 'aiup' } });
      expect(errorOf(unknown).code).toBe('UNKNOWN_FRAMEWORK');
    });
  });
});
