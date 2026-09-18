import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { createApp } from '../../../src/store/apps.js';
import { routeTask } from '../../../src/services/routeTask.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { getRoutingEvent } from '../../../src/store/routingEvents.js';
import { recordCommit } from '../../../src/services/recordCommit.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const feature: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('routing events through the services', () => {
  let deps: ServiceDeps;
  let appId: string;

  beforeEach(async () => {
    const pool = await getTestPool();
    await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    await createApp(pool, { slug: 'billing', name: 'Billing' }, 'seed');
    deps = { pool, embedder, tokenBudget: 6000 };
  });
  afterAll(closeTestPool);

  it('route_task records one event per identity and returns a stable routing_id without creating features', async () => {
    const a = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, actor: 'd' });
    const b = await routeTask(deps, { task_description: 'rename a  label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, actor: 'd' });
    expect(a.routing_id).toMatch(/^r_/);
    expect(b.routing_id).toBe(a.routing_id);
    const row = await getRoutingEvent(deps.pool, a.routing_id);
    expect(row).toMatchObject({ app_id: appId, intent: 'trivial', framework: 'none', lite: true, route_count: 2, created_by: 'd', feature_id: null });
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
  });

  it('keeps the ticket on the event and tells the lite pack how to report commits', async () => {
    const r = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'yal-7' });
    expect(await getRoutingEvent(deps.pool, r.routing_id)).toMatchObject({ external_ref: 'yal-7', identity_key: 'ticket:YAL-7', created_by: 'host' });
    expect(r.lite_pack?.rendered.trimEnd().endsWith(`When you commit, call record_commit with routing_id "${r.routing_id}".`)).toBe(true);
  });

  it('start_feature links an explicit routing_id and reports it', async () => {
    const routed = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' });
    const started = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: routed.decision, routing_id: routed.routing_id });
    expect(started.routing_id).toBe(routed.routing_id);
    expect(await getRoutingEvent(deps.pool, routed.routing_id)).toMatchObject({ feature_id: started.feature_id, route_count: 1 });
    expect(started.next_instructions).toContain(`record_commit with feature_id "${started.feature_id}"`);
  });

  it('start_feature auto-links by identity when routing_id is omitted, and creates the event when none exists', async () => {
    const routed = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4 }, framework_preference: 'mini', external_ref: 'YAL-3' });
    const linked = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export (edited)', decision: routed.decision, external_ref: 'yal-3' });
    expect(linked.routing_id).toBe(routed.routing_id);
    const fresh = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Never routed', decision: feature });
    expect(await getRoutingEvent(deps.pool, fresh.routing_id)).toMatchObject({ feature_id: fresh.feature_id, route_count: 0, intent: 'feature', framework: 'mini' });
  });

  it('start_feature rejects a routing_id from another app or already linked to a feature', async () => {
    const other = await routeTask(deps, { task_description: 'Billing thing', app: 'billing', workspace: { estimated_files: 2 }, framework_preference: 'mini' });
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: feature, routing_id: other.routing_id }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'routing_id' } });
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: feature, routing_id: 'r_nope' }))
      .rejects.toMatchObject({ code: 'ROUTING_EVENT_NOT_FOUND' });
    const routed = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4 }, framework_preference: 'mini' });
    await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: routed.decision, routing_id: routed.routing_id });
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: routed.decision, routing_id: routed.routing_id }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(1);
  });

  it('record_commit anchors by routing_id, feature_id or external_ref, dedups by sha, and lower-cases the sha', async () => {
    const routed = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'YAL-5' });
    const byRouting = await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'ABC1234', message: 'fix: label', files_changed: ['src/a.tsx'], routing_id: routed.routing_id });
    expect(byRouting).toMatchObject({ routing_id: routed.routing_id, feature_id: null, deduplicated: false });
    expect(byRouting.commit_id).toMatch(/^cm_/);
    const byTicket = await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'fix: label (amend)', external_ref: 'yal-5' });
    expect(byTicket).toMatchObject({ commit_id: byRouting.commit_id, deduplicated: true });
    expect((await deps.pool.query('SELECT sha FROM commits')).rows).toEqual([{ sha: 'abc1234' }]);

    const fresh = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: feature });
    const byFeature = await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'feed123', message: 'feat: csv', feature_id: fresh.feature_id });
    expect(byFeature).toMatchObject({ feature_id: fresh.feature_id, routing_id: fresh.routing_id, deduplicated: false });
  });

  it('record_commit rejects missing, ambiguous, unknown and cross-app anchors', async () => {
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', routing_id: 'r_a', feature_id: 'f_b' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', external_ref: 'YAL-404' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('call route_task first') });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', routing_id: 'r_nope' })).rejects.toMatchObject({ code: 'ROUTING_EVENT_NOT_FOUND' });
    const other = await routeTask(deps, { task_description: 'Billing thing', app: 'billing', workspace: { intent: 'trivial', estimated_files: 1 } });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', routing_id: other.routing_id })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM commits')).rows[0].n).toBe(0);
  });
});
