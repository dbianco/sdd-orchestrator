import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf, errorOf, textOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('Streamable HTTP transport', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('serves the same tools, resources and prompts as stdio, statelessly', async () => {
    await withClient('http', async (client) => {
      expect((await client.listTools()).tools).toHaveLength(8);
      expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(5);
      expect((await client.listPrompts()).prompts).toHaveLength(7);
      const s = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision } }));
      const st = structuredOf<{ current_phase: string }>(await client.callTool({ name: 'get_feature_status', arguments: { feature_id: s.feature_id } }));
      expect(st.current_phase).toBe('specify');
      expect(errorOf(await client.callTool({ name: 'get_context', arguments: { feature_id: 'f_nope', actor: 'd' } })).code).toBe('FEATURE_NOT_FOUND');
      expect(textOf(await client.callTool({ name: 'route_task', arguments: { task_description: 'Can we cache?', app: 'checkout', workspace: {} } }))).toMatch(/Prototype first/);
    });
  });

  it('exposes healthz and metrics', async () => {
    await withClient('http', async (client, info) => {
      const origin = info.baseUrl!;
      const h = await fetch(`${origin}/healthz`);
      expect(h.status).toBe(200);
      expect(await h.json()).toMatchObject({ status: 'ok', database: 'ok', embedding: 'ok' });
      await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: { estimated_files: 2, is_greenfield: false }, framework_preference: 'mini' } });
      const m = await (await fetch(`${origin}/metrics`)).text();
      expect(m).toContain('sdd_routing_decisions_total{rule="2-preference"}');
    });
  });

  it('returns a JSON-RPC parse error for a malformed JSON body', async () => {
    await withClient('http', async (_client, info) => {
      const origin = info.baseUrl!;
      const r = await fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: '{not valid json',
      });
      expect(r.status).toBe(400);
      expect(r.headers.get('content-type')).toMatch(/application\/json/);
      const body = await r.json();
      expect(body).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 }, id: null });
    });
  });
});
