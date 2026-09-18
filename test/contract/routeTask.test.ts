import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('route_task over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('lists exactly the nine tools with output schemas', async () => {
    await withClient('stdio', async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['advance_phase', 'get_context', 'get_feature_status', 'list_features', 'propose_memory', 'record_commit', 'route_task', 'search_memory', 'start_feature']);
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

  it('routes, returns structuredContent and a stable routing_id, and creates no feature', async () => {
    await withClient('stdio', async (client) => {
      const args = { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' };
      const r = await client.callTool({ name: 'route_task', arguments: args });
      const s = structuredOf<{ decision: { framework: string }; attached_layers: unknown[]; routing_id: string }>(r);
      expect(s.decision.framework).toBe('mini');
      expect(s.attached_layers).toHaveLength(2);
      expect(s.routing_id).toMatch(/^r_/);
      expect(JSON.parse(textOf(r)).decision.framework).toBe('mini');
      const again = structuredOf<{ routing_id: string }>(await client.callTool({ name: 'route_task', arguments: args }));
      expect(again.routing_id).toBe(s.routing_id);
      const pool = await getTestPool();
      expect((await pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
      expect((await pool.query('SELECT count(*)::int AS n FROM routing_events')).rows[0].n).toBe(1);
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

  it('record_commit links a host-reported commit to routed work over stdio', async () => {
    await withClient('stdio', async (client) => {
      const routed = structuredOf<{ routing_id: string }>(await client.callTool({ name: 'route_task', arguments: { task_description: 'Rename', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'YAL-8' } }));
      const r = await client.callTool({ name: 'record_commit', arguments: { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'fix: rename', files_changed: ['src/a.tsx'], external_ref: 'yal-8' } });
      expect(structuredOf<{ routing_id: string; deduplicated: boolean }>(r)).toMatchObject({ routing_id: routed.routing_id, deduplicated: false });
      expect(errorOf(await client.callTool({ name: 'record_commit', arguments: { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x' } })).code).toBe('VALIDATION_ERROR');
      // A whitespace-only external_ref is rejected by the trimmed schema. Like the `expected_phase: 'nope'`
      // case in lifecycle.test.ts, an SDK-validated rejection never reaches `guarded()`, so accept any shape.
      const blank = await client.callTool({ name: 'record_commit', arguments: { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', external_ref: '   ' } }).catch((e: Error) => e);
      const code = blank instanceof Error ? blank.message : (() => { try { return errorOf(blank).code; } catch { return textOf(blank); } })();
      expect(code).toMatch(/VALIDATION_ERROR|external_ref|Invalid/);
    });
  });
});
