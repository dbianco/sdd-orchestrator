import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll, embedder } from '../helpers/seed.js';
import { startFeature } from '../../src/services/startFeature.js';
import { routeTask } from '../../src/services/routeTask.js';
import { recordCommit } from '../../src/services/recordCommit.js';
import { createHttpApp, type HttpDeps } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import type { Config } from '../../src/config.js';
import type { Decision } from '../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
// admin-ui/dist is gitignored and only exists after `npm --prefix admin-ui run build`,
// so the static-serving test skips itself rather than failing a fresh checkout.
const adminUiIndexPath = fileURLToPath(new URL('../../admin-ui/dist/index.html', import.meta.url));
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const baseConfig: Omit<Config, 'adminToken'> = {
  databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' },
  listen: { host: '127.0.0.1', port: 0 }, allowedHosts: ['127.0.0.1'], tokenBudget: 6000,
};

function listen(app: ReturnType<typeof createHttpApp>): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function authHeader(password: string): string {
  return `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
}

describe.skipIf(!url)('admin routes', () => {
  let deps: HttpDeps;
  let server: Server | null = null;

  beforeEach(async () => {
    const pool = await getTestPool();
    await truncateAll(pool);
    await seedAll(pool);
    const { registry, hooks } = createMetrics();
    deps = { pool, embedder, tokenBudget: 6000, logger: createLogger('silent'), metrics: hooks, registry };
  });
  afterEach(() => { server?.close(); server = null; });
  afterAll(closeTestPool);

  it('is absent (404, not 401) when SDD_ADMIN_TOKEN is unset', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: null });
    const listening = await listen(app);
    server = listening.server;
    const res = await fetch(`${listening.origin}/admin/api/overview`);
    expect(res.status).toBe(404);
  });

  it('requires Basic Auth and serves the overview once authenticated', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const unauth = await fetch(`${listening.origin}/admin/api/overview`);
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('www-authenticate')).toBe('Basic realm="sdd-admin"');
    await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision });
    const res = await fetch(`${listening.origin}/admin/api/overview`, { headers: { Authorization: authHeader('s3cret') } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.features).toEqual([{ status: 'active', current_phase: 'specify', framework: 'mini', track: 'default', count: 1 }]);
  });

  it('scopes apps/features/flow by app slug and 404s an unknown feature', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const headers = { Authorization: authHeader('s3cret') };
    const started = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision });

    const apps = (await (await fetch(`${listening.origin}/admin/api/apps`, { headers })).json()) as any;
    expect(apps.apps).toHaveLength(1);
    expect(apps.apps[0].slug).toBe('checkout');

    const features = (await (await fetch(`${listening.origin}/admin/api/apps/checkout/features`, { headers })).json()) as any;
    expect(features.features.map((f: { feature_id: string }) => f.feature_id)).toEqual([started.feature_id]);

    const detail = (await (await fetch(`${listening.origin}/admin/api/features/${started.feature_id}`, { headers })).json()) as any;
    expect(detail.feature.slug).toBe(started.feature.slug);
    expect(detail.transitions).toEqual([]);

    const missingFeature = await fetch(`${listening.origin}/admin/api/features/f_nope`, { headers });
    expect(missingFeature.status).toBe(404);

    const missingApp = await fetch(`${listening.origin}/admin/api/apps/nope/features`, { headers });
    expect(missingApp.status).toBe(404);

    const flow = (await (await fetch(`${listening.origin}/admin/api/flow`, { headers })).json()) as any;
    expect(flow.flow).toEqual([]);

    const proposals = (await (await fetch(`${listening.origin}/admin/api/proposals`, { headers })).json()) as any;
    expect(proposals.proposals).toEqual([]);
  });

  it('rejects an invalid query param with 400, not 503', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const headers = { Authorization: authHeader('s3cret') };
    const res = await fetch(`${listening.origin}/admin/api/proposals?status=bogus`, { headers });
    expect(res.status).toBe(400);
  });

  it.skipIf(!existsSync(adminUiIndexPath))('serves the built admin-ui index.html under auth, and 401s without it', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const unauth = await fetch(`${listening.origin}/admin/`);
    expect(unauth.status).toBe(401);
    const res = await fetch(`${listening.origin}/admin/`, { headers: { Authorization: authHeader('s3cret') } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('lists routed work with app/date filters, summarises by intent, and serves one event with its commits', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const headers = { Authorization: authHeader('s3cret') };
    const trivial = await routeTask(deps, { task_description: 'Fix the date picker', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'YAL-1' });
    await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'fix: date picker', files_changed: ['src/dates.ts'], routing_id: trivial.routing_id });
    const started = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision });

    const all = (await (await fetch(`${listening.origin}/admin/api/routing`, { headers })).json()) as any;
    expect(all.events.map((e: { id: string }) => e.id).sort()).toEqual([trivial.routing_id, started.routing_id].sort());
    const t = all.events.find((e: { id: string }) => e.id === trivial.routing_id);
    expect(t).toMatchObject({ app_slug: 'checkout', intent: 'trivial', lite: true, external_ref: 'YAL-1', commit_count: 1, feature_id: null });
    const f = all.events.find((e: { id: string }) => e.id === started.routing_id);
    expect(f).toMatchObject({ feature_id: started.feature_id, feature_status: 'active', feature_phase: 'specify', commit_count: 0 });
    expect(all.summary).toEqual(expect.arrayContaining([{ intent: 'trivial', count: 1 }, { intent: 'feature', count: 1 }]));

    const scoped = (await (await fetch(`${listening.origin}/admin/api/routing?app=checkout&from=2000-01-01&to=2099-12-31`, { headers })).json()) as any;
    expect(scoped.events).toHaveLength(2);
    const none = (await (await fetch(`${listening.origin}/admin/api/routing?from=2099-01-01`, { headers })).json()) as any;
    expect(none.events).toEqual([]);
    expect(none.summary).toEqual([]);

    const detail = (await (await fetch(`${listening.origin}/admin/api/routing/${trivial.routing_id}`, { headers })).json()) as any;
    expect(detail.event.id).toBe(trivial.routing_id);
    expect(detail.commits).toEqual([expect.objectContaining({ sha: 'abc1234', files_changed: ['src/dates.ts'] })]);

    expect((await fetch(`${listening.origin}/admin/api/routing/r_nope`, { headers })).status).toBe(404);
    expect((await fetch(`${listening.origin}/admin/api/routing?app=nope`, { headers })).status).toBe(404);
  });

  it('rejects an inverted or malformed date range with 400', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const headers = { Authorization: authHeader('s3cret') };
    const inverted = await fetch(`${listening.origin}/admin/api/routing?from=2026-02-02&to=2026-01-01`, { headers });
    expect(inverted.status).toBe(400);
    expect(((await inverted.json()) as any).error).toContain('from must be on or before to');
    expect((await fetch(`${listening.origin}/admin/api/routing?from=yesterday`, { headers })).status).toBe(400);
  });
});
