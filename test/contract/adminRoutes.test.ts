import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll, embedder } from '../helpers/seed.js';
import { startFeature } from '../../src/services/startFeature.js';
import { routeTask } from '../../src/services/routeTask.js';
import { recordCommit } from '../../src/services/recordCommit.js';
import { advancePhase } from '../../src/services/advancePhase.js';
import { createHttpApp, type HttpDeps } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import type { Config } from '../../src/config.js';
import type { Decision } from '../../src/domain/types.js';
import { insertProposal } from '../../src/store/proposals.js';
import { createToken } from '../../src/store/tokens.js';
import { seedDemo } from '../../src/cli/commands/demo.js';

const url = process.env.SDD_TEST_DATABASE_URL;
// admin-ui/dist is gitignored and only exists after `npm --prefix admin-ui run build`,
// so the static-serving test skips itself rather than failing a fresh checkout.
const adminUiIndexPath = fileURLToPath(new URL('../../admin-ui/dist/index.html', import.meta.url));
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const baseConfig: Omit<Config, 'adminToken'> = {
  databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' },
  listen: { host: '127.0.0.1', port: 0 }, allowedHosts: ['127.0.0.1'], tokenBudget: 6000, authMode: 'off',
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

  it('logs in personal approver tokens when auth is on, even without SDD_ADMIN_TOKEN', async () => {
    const approver = (await createToken(deps.pool, { actor: 'dana', name: 't', scopes: ['approver'], app_ids: null, expires_at: null }, 'test')).secret;
    const host = (await createToken(deps.pool, { actor: 'bob', name: 't', scopes: ['host'], app_ids: null, expires_at: null }, 'test')).secret;
    const listening = await listen(createHttpApp(deps, { ...baseConfig, adminToken: null, authMode: 'warn' }));
    server = listening.server;
    const me = await fetch(`${listening.origin}/admin/api/me`, { headers: { Authorization: authHeader(approver) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ actor: 'dana', canApprove: true });
    expect((await fetch(`${listening.origin}/admin/api/me`, { headers: { Authorization: authHeader(host) } })).status).toBe(401);
  });

  it('lists, shows, approves and rejects approval requests for approvers only', async () => {
    const approver = (await createToken(deps.pool, { actor: 'erin', name: 't', scopes: ['approver'], app_ids: null, expires_at: null }, 'test')).secret;
    const listening = await listen(createHttpApp(deps, { ...baseConfig, adminToken: 's3cret', authMode: 'warn' }));
    server = listening.server;
    const warnDeps = { ...deps, authMode: 'warn' as const };
    const pending = async (task: string) => {
      const fid = (await startFeature(warnDeps, { app: 'checkout', actor: 'dana', task_description: task, decision })).feature_id;
      return (await advancePhase(warnDeps, { feature_id: fid, actor: 'dana', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nx\n\n## What Changes\ny\n' } })).approval_id!;
    };
    const a = await pending('one');
    const b = await pending('two');
    const as = (secret: string) => ({ Authorization: authHeader(secret) });
    const json = { 'Content-Type': 'application/json' };

    const list = (await (await fetch(`${listening.origin}/admin/api/approvals`, { headers: as(approver) })).json()) as any;
    expect(list.approvals.map((x: { id: string }) => x.id)).toEqual([a, b]);
    const detail = (await (await fetch(`${listening.origin}/admin/api/approvals/${a}`, { headers: as(approver) })).json()) as any;
    expect(detail.artifacts).toEqual([expect.objectContaining({ name: 'proposal.md' })]);
    expect(detail.requirements).toBeNull();
    expect((await fetch(`${listening.origin}/admin/api/approvals/ap_nope`, { headers: as(approver) })).status).toBe(404);

    const readOnly = await fetch(`${listening.origin}/admin/api/approvals/${a}/approve`, { method: 'POST', headers: { ...as('s3cret'), ...json }, body: '{}' });
    expect(readOnly.status).toBe(403);
    const form = await fetch(`${listening.origin}/admin/api/approvals/${a}/approve`, { method: 'POST', headers: { ...as(approver), 'Content-Type': 'text/plain' }, body: 'x' });
    expect(form.status).toBe(415);
    const noReason = await fetch(`${listening.origin}/admin/api/approvals/${b}/reject`, { method: 'POST', headers: { ...as(approver), ...json }, body: '{}' });
    expect(noReason.status).toBe(400);

    const approved = await fetch(`${listening.origin}/admin/api/approvals/${a}/approve`, { method: 'POST', headers: { ...as(approver), ...json }, body: JSON.stringify({ comment: 'ok' }) });
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as any).approval).toMatchObject({ status: 'approved', decided_by: 'erin' });
    const again = await fetch(`${listening.origin}/admin/api/approvals/${a}/approve`, { method: 'POST', headers: { ...as(approver), ...json }, body: '{}' });
    expect(again.status).toBe(409);
    const rejected = await fetch(`${listening.origin}/admin/api/approvals/${b}/reject`, { method: 'POST', headers: { ...as(approver), ...json }, body: JSON.stringify({ reason: 'unclear' }) });
    expect(((await rejected.json()) as any).approval).toMatchObject({ status: 'rejected' });
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
    expect(detail.requirements).toEqual([]);

    const rtm = (await (await fetch(`${listening.origin}/admin/api/apps/checkout/rtm`, { headers })).json()) as any;
    expect(rtm).toEqual({ app: 'checkout', rows: [] });
    expect((await fetch(`${listening.origin}/admin/api/apps/nope/rtm`, { headers })).status).toBe(404);

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
    expect(detail.event).toMatchObject({ id: trivial.routing_id, app_slug: 'checkout', commit_count: 1, feature_id: null });
    expect(detail.commits).toEqual([expect.objectContaining({ sha: 'abc1234', files_changed: ['src/dates.ts'] })]);

    const featureDetail = (await (await fetch(`${listening.origin}/admin/api/routing/${started.routing_id}`, { headers })).json()) as any;
    expect(featureDetail.event).toMatchObject({
      id: started.routing_id, app_slug: 'checkout', feature_id: started.feature_id, feature_slug: started.feature.slug, feature_status: 'active', feature_phase: 'specify', commit_count: 0,
    });

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

  it('serves value metrics, a per-person week and gate hints', async () => {
    await seedDemo(deps.pool, 'demo', 'test');
    const listening = await listen(createHttpApp(deps, { ...baseConfig, adminToken: 's3cret', authMode: 'warn' }));
    server = listening.server;
    const get = async (path: string) => (await fetch(`${listening.origin}/admin/api/${path}`, { headers: { Authorization: authHeader('s3cret') } })).json() as Promise<Record<string, any>>;

    const m = await get('metrics?app=demo');
    expect(m.first_pass_rate).toBeGreaterThan(0);
    expect(m.first_pass_rate).toBeLessThan(1);
    expect(m.caught.failed_transitions).toBeGreaterThanOrEqual(4);
    expect(m.approvals).toMatchObject({ pending: 1, decided: 4 });
    expect(m.approvals.median_hours).toBeCloseTo(3, 0);

    const w = await get('week?app=demo&actor=dana&days=30');
    expect(w.actor).toBe('dana');
    expect(w.actors).toEqual(expect.arrayContaining(['dana', 'erin']));
    expect(w.shipped.map((s: { slug: string }) => s.slug)).toEqual(['refund-policy-page']);
    expect(w.caught).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'requirement_coverage', count: 1 })]));
    const none = await get('week?app=demo&actor=nobody');
    expect(none).toMatchObject({ transitions: { passed: 0, failed: 0 }, shipped: [], caught: [] });

    const cycle = await get('cycle?app=demo&days=60');
    expect(cycle).toMatchObject({ features: 5, archived: 1 });
    expect(cycle.spec_share).toBeGreaterThan(0);
    expect(cycle.by_track.map((t: { track: string }) => t.track)).toEqual(expect.arrayContaining(['default', 'hotfix']));
    expect(cycle.rework.failed_attempts).toBeGreaterThanOrEqual(5);
    expect(cycle.phase_median_hours.implement).toBeGreaterThan(0);
    expect((await fetch(`${listening.origin}/admin/api/cycle?days=0`, { headers: { Authorization: authHeader('s3cret') } })).status).toBe(400);

    const drift = (await get('drift?app=demo')).drift as { slug: string; level: string; unspecced_commits: number; other_feature_commits: number; files: { file: string; commits: { sha: string; feature_slug: string | null }[] }[] }[];
    expect(drift.map((d) => d.slug)).toEqual(['refund-policy-page']); // only archived specs; the others are still in flight
    expect(drift[0]).toMatchObject({ level: 'likely', unspecced_commits: 1, other_feature_commits: 1 });
    const byFile = Object.fromEntries(drift[0]!.files.map((f) => [f.file, f.commits]));
    expect(byFile['src/legal/refunds.tsx']).toEqual([expect.objectContaining({ sha: 'd4e5f6a7b8c9', feature_slug: null })]);
    expect(byFile['src/legal/index.ts']).toEqual([expect.objectContaining({ sha: 'e5f6a7b8c9d0', feature_slug: 'add-csv-export' })]);
    // lockfile churn is never drift
    const refund = (await deps.pool.query<{ id: string; app_id: string }>(`SELECT id, app_id FROM features WHERE slug = 'refund-policy-page'`)).rows[0]!;
    const trivialRouting = (await deps.pool.query<{ id: string }>(`SELECT id FROM routing_events WHERE identity_key = 'demo:trivial-refund-typo'`)).rows[0]!.id;
    await deps.pool.query(`INSERT INTO commits (id, app_id, sha, message, files_changed, committed_at, feature_id, routing_id, created_by) VALUES ('cm_l1', $1, 'aaaa111', 'deps', ARRAY['package-lock.json'], now() - interval '20 days', $2, NULL, 't'), ('cm_l2', $1, 'bbbb222', 'bump', ARRAY['package-lock.json'], now(), NULL, $3, 't')`, [refund.app_id, refund.id, trivialRouting]);
    expect(((await get('drift?app=demo')).drift[0].files as { file: string }[]).map((f) => f.file)).not.toContain('package-lock.json');
    expect((await get('drift')).drift.length).toBe(1);

    const sizing = await get('rightsizing?app=demo');
    expect(sizing).toMatchObject({ archived_full_track: 1, tiny: 1, share: 1, thresholds: { max_files: 3, max_requirements: 2 } });
    expect(sizing.entries).toEqual([expect.objectContaining({ slug: 'refund-policy-page', files: 2, requirements: 2 })]);

    const hints = await get('gate-hints');
    expect(hints.hints.requirement_coverage.fix).toMatch(/implements/);
    expect((await fetch(`${listening.origin}/admin/api/week?days=0`, { headers: { Authorization: authHeader('s3cret') } })).status).toBe(400);
  });

  it('approves and rejects memory proposals for approvers only, once each', async () => {
    const approver = (await createToken(deps.pool, { actor: 'erin', name: 't', scopes: ['approver'], app_ids: null, expires_at: null }, 'test')).secret;
    const listening = await listen(createHttpApp(deps, { ...baseConfig, adminToken: 's3cret', authMode: 'warn' }));
    server = listening.server;
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'CSV export', decision })).feature_id;
    const appId = (await deps.pool.query<{ id: string }>(`SELECT id FROM apps WHERE slug = 'checkout'`)).rows[0]!.id;
    const payload = { kind: 'app_memory', memory_type: 'decision', title: 'Use streaming for exports', body: 'Exports stream rows to keep memory flat.', stack_tags: [], links: [] };
    const p1 = (await insertProposal(deps.pool, { app_id: appId, feature_id: fid, payload, supersedes: null }, 'agent')).id;
    const p2 = (await insertProposal(deps.pool, { app_id: appId, feature_id: fid, payload: { ...payload, title: 'Other' }, supersedes: null }, 'agent')).id;
    const as = (secret: string) => ({ Authorization: authHeader(secret), 'Content-Type': 'application/json' });
    const post = (id: string, action: string, secret: string, body: unknown = {}) => fetch(`${listening.origin}/admin/api/proposals/${id}/${action}`, { method: 'POST', headers: as(secret), body: JSON.stringify(body) });

    expect((await post(p1, 'approve', 's3cret')).status).toBe(403);
    expect((await post('p_nope', 'approve', approver)).status).toBe(404);
    expect((await post(p2, 'reject', approver)).status).toBe(400);
    const approved = await post(p1, 'approve', approver);
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as any)).toMatchObject({ proposal: { status: 'approved', reviewed_by: 'erin' }, item: { title: 'Use streaming for exports' } });
    expect((await post(p1, 'approve', approver)).status).toBe(409);
    const rejected = await post(p2, 'reject', approver, { reason: 'duplicate' });
    expect(((await rejected.json()) as any).proposal).toMatchObject({ status: 'rejected', review_reason: 'duplicate' });
  });

  it('notifies once, after commit, when an approval is requested', async () => {
    const events: { feature: string; to_phase: string; requested_by: string }[] = [];
    const notifyDeps = { ...deps, authMode: 'warn' as const, notifier: { approvalRequested: (e: { feature: string; to_phase: string; requested_by: string }) => { events.push(e); } } };
    const fid = (await startFeature(notifyDeps, { app: 'checkout', actor: 'dana', task_description: 'Notify me', decision })).feature_id;
    await advancePhase(notifyDeps, { feature_id: fid, actor: 'dana', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nx\n\n## What Changes\ny\n' } });
    expect(events).toEqual([expect.objectContaining({ to_phase: 'implement', requested_by: 'dana' })]);
  });
});

