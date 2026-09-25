import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf, errorOf } from '../helpers/mcp.js';
import { createApp } from '../../src/store/apps.js';
import { startFeature } from '../../src/services/startFeature.js';
import { embedder } from '../helpers/seed.js';
import type { Decision } from '../../src/domain/types.js';
import { createToken } from '../../src/store/tokens.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const enforce = { SDD_AUTH_MODE: 'enforce' };
const bearer = (s: string) => ({ Authorization: `Bearer ${s}` });

describe.skipIf(!url)('authentication over Streamable HTTP', () => {
  let secret: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    secret = (await createToken(pool, { actor: 'dana', name: 'test', scopes: ['host'], app_ids: null, expires_at: null }, 'test')).secret;
  });
  afterAll(closeTestPool);

  it('refuses an unauthenticated client in enforce mode', async () => {
    await expect(withClient('http', async (client) => { await client.listTools(); }, { env: { SDD_AUTH_MODE: 'enforce' } })).rejects.toThrow(/401|unauthorized/i);
  });

  it('serves an authenticated client in enforce mode', async () => {
    await withClient('http', async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('route_task');
    }, { env: { SDD_AUTH_MODE: 'enforce' }, headers: { Authorization: `Bearer ${secret}` } });
  });

  it('refuses a token without the host scope, and a token restricted to another app', async () => {
    const pool = await getTestPool();
    const billing = await createApp(pool, { slug: 'billing', name: 'Billing', default_stack: [] }, 'test');
    const ci = (await createToken(pool, { actor: 'pipeline', name: 'ci', scopes: ['ci'], app_ids: null, expires_at: null }, 'test')).secret;
    const billingOnly = (await createToken(pool, { actor: 'bob', name: 'b', scopes: ['host'], app_ids: [billing.id], expires_at: null }, 'test')).secret;
    const fid = (await startFeature({ pool, embedder, tokenBudget: 6000 }, { app: 'checkout', actor: 'dana', task_description: 'CSV export', decision })).feature_id;
    await withClient('http', async (client) => {
      const r = await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: {} } });
      expect(errorOf(r).code).toBe('FORBIDDEN');
    }, { env: enforce, headers: bearer(ci) });
    await withClient('http', async (client) => {
      expect(errorOf(await client.callTool({ name: 'get_context', arguments: { feature_id: fid } })).code).toBe('FORBIDDEN');
      expect(errorOf(await client.callTool({ name: 'list_features', arguments: { app: 'checkout' } })).code).toBe('FORBIDDEN');
      expect(errorOf(await client.callTool({ name: 'search_memory', arguments: { query: 'x', app: 'billing', scope: 'company' } })).code).toBe('FORBIDDEN');
      expect(structuredOf<{ features: unknown[] }>(await client.callTool({ name: 'list_features', arguments: { app: 'billing' } })).features).toEqual([]);
    }, { env: enforce, headers: bearer(billingOnly) });
  });

  it('records the token actor and token id, warning when the payload names someone else', async () => {
    const pool = await getTestPool();
    const tokenId = (await pool.query("SELECT id FROM api_tokens WHERE actor = 'dana'")).rows[0].id;
    await withClient('http', async (client) => {
      const started = structuredOf<{ feature_id: string; warnings: string[] }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'mallory', task_description: 'CSV export', decision } }));
      expect(started.warnings).toContain('actor "mallory" ignored; the token belongs to "dana"');
      const adv = structuredOf<{ result: string; warnings: string[] }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: started.feature_id, expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nx\n\n## What Changes\ny\n' }, human_approved: true } }));
      expect(adv.result).toBe('awaiting_approval');
      expect(adv.warnings).toContain('human_approved is ignored; approval is requested from a person on the server');
      const row = (await pool.query('SELECT created_by, token_id FROM phase_transitions WHERE feature_id = $1', [started.feature_id])).rows[0];
      expect(row).toEqual({ created_by: 'dana', token_id: tokenId });
      expect((await pool.query('SELECT created_by FROM features WHERE id = $1', [started.feature_id])).rows[0].created_by).toBe('dana');
    }, { env: enforce, headers: bearer(secret) });
  });

  it('accepts anonymous calls in warn mode with a warning, and requires actor then', async () => {
    await withClient('http', async (client) => {
      const routed = structuredOf<{ warnings: string[] }>(await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: {}, framework_preference: 'mini' } }));
      expect(routed.warnings).toContain('unauthenticated call accepted because SDD_AUTH_MODE=warn');
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', task_description: 'x', decision } })).code).toBe('VALIDATION_ERROR');
    }, { env: { SDD_AUTH_MODE: 'warn' } });
  });
});
