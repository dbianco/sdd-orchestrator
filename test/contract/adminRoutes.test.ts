import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll, embedder } from '../helpers/seed.js';
import { startFeature } from '../../src/services/startFeature.js';
import { createHttpApp, type HttpDeps } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import type { Config } from '../../src/config.js';
import type { Decision } from '../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
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
});
