import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll, embedder } from '../helpers/seed.js';
import { startFeature } from '../../src/services/startFeature.js';
import { createHttpApp, type HttpDeps } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import { createApp } from '../../src/store/apps.js';
import { createToken } from '../../src/store/tokens.js';
import type { AuthMode } from '../../src/auth/context.js';
import type { Config } from '../../src/config.js';
import type { Decision } from '../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const config = (authMode: AuthMode): Config => ({
  databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' }, listen: { host: '127.0.0.1', port: 0 },
  allowedHosts: ['127.0.0.1'], tokenBudget: 6000, adminToken: null, authMode,
});
const evidence = { tests: { command: 'npm test', passed: 9, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/a.ts'] };

describe.skipIf(!url)('POST /api/ci/evidence', () => {
  let deps: HttpDeps;
  let server: Server | null = null;
  let fid: string;
  let ci: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    const { registry, hooks } = createMetrics();
    deps = { pool, embedder, tokenBudget: 6000, logger: createLogger('silent'), metrics: hooks, registry };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'CSV export', decision })).feature_id;
    ci = (await createToken(pool, { actor: 'checkout-ci', name: 'pipeline', scopes: ['ci'], app_ids: null, expires_at: null }, 'test')).secret;
  });
  afterEach(() => { server?.close(); server = null; });
  afterAll(closeTestPool);

  async function post(mode: AuthMode, body: unknown, token?: string): Promise<{ status: number; body: any }> {
    const app = createHttpApp(deps, config(mode));
    const origin = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => { const a = server!.address(); resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`); });
    });
    const res = await fetch(`${origin}/api/ci/evidence`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const out = { status: res.status, body: await res.json().catch(() => null) };
    server!.close(); server = null;
    return out;
  }

  it('stores evidence and a ci commit anchored to the feature', async () => {
    const r = await post('warn', { app: 'checkout', feature_id: fid, commit_sha: 'ABC1234', branch: 'feature/csv', run_url: 'https://ci.example/runs/1', evidence }, ci);
    expect(r.status).toBe(201);
    expect(r.body.ci_evidence_id).toMatch(/^ce_/);
    const row = (await deps.pool.query('SELECT * FROM ci_evidence WHERE id = $1', [r.body.ci_evidence_id])).rows[0];
    expect(row).toMatchObject({ feature_id: fid, commit_sha: 'abc1234', created_by: 'checkout-ci', evidence });
    const commit = (await deps.pool.query('SELECT sha, source, feature_id, routing_id, files_changed FROM commits WHERE id = $1', [r.body.commit_id])).rows[0];
    expect(commit).toMatchObject({ sha: 'abc1234', source: 'ci', feature_id: fid, files_changed: ['src/a.ts'] });
    expect(commit.routing_id).toMatch(/^r_/);
  });

  it('answers 401, 403, 404 and 400 for the usual mistakes', async () => {
    const ok = { app: 'checkout', feature_id: fid, commit_sha: 'abc1234', evidence };
    const host = (await createToken(deps.pool, { actor: 'dana', name: 'h', scopes: ['host'], app_ids: null, expires_at: null }, 'test')).secret;
    const other = await createApp(deps.pool, { slug: 'billing', name: 'Billing' }, 'test');
    const billingCi = (await createToken(deps.pool, { actor: 'billing-ci', name: 'b', scopes: ['ci'], app_ids: [other.id], expires_at: null }, 'test')).secret;
    expect((await post('warn', ok)).status).toBe(401);
    expect((await post('warn', ok, 'sdd_wrong')).status).toBe(401);
    expect((await post('warn', ok, host)).status).toBe(403);
    expect((await post('warn', ok, billingCi)).status).toBe(403);
    expect((await post('warn', { ...ok, app: 'billing' }, ci)).status).toBe(403);
    expect((await post('warn', { ...ok, feature_id: 'f_nope' }, ci)).status).toBe(404);
    expect((await post('warn', { ...ok, app: 'nope' }, ci)).status).toBe(404);
    expect((await post('warn', { ...ok, commit_sha: 'xyz' }, ci)).status).toBe(400);
    expect((await post('warn', { ...ok, evidence: { lint: 'maybe' } }, ci)).status).toBe(400);
  });

  it('is not mounted when SDD_AUTH_MODE is off', async () => {
    expect((await post('off', { app: 'checkout', feature_id: fid, commit_sha: 'abc1234', evidence }, ci)).status).toBe(404);
  });
});
