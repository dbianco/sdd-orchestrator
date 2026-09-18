import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll } from '../../helpers/seed.js';
import { createApp } from '../../../src/store/apps.js';
import { createFeature } from '../../../src/store/features.js';
import {
  identityKey, upsertRoutingEvent, findRoutingEventByIdentity, linkRoutingEventToFeature, listRoutingEvents, routingSummary, requireRoutingEvent,
} from '../../../src/store/routingEvents.js';
import type { Decision } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;
const trivial: Decision = { intent: 'trivial', framework: 'none', track: null, confidence: 'high', rule: '4-trivial', reasons: [], high_risk: false, policy_version: null, framework_pack_version: null };
const feature: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('routing events store', () => {
  let pool: pg.Pool;
  let appId: string;
  let billingId: string;

  beforeEach(async () => {
    pool = await getTestPool();
    await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    billingId = (await createApp(pool, { slug: 'billing', name: 'Billing' }, 'seed')).id;
  });
  afterAll(closeTestPool);

  const base = (over: Partial<Parameters<typeof upsertRoutingEvent>[1]> = {}) => ({
    app_id: appId, external_ref: null, trigger_ref: null, task_description: 'Fix the date picker', decision: trivial, lite: true, workspace: null, ...over,
  });

  // Inserts a feature row directly (no lifecycle, no context pack) so this file tests the store alone.
  const newFeature = (slug: string) => createFeature(pool, {
    app_id: appId, slug, intent: 'feature', framework: 'mini', framework_pack_version: '1.0.0', track: 'default', high_risk: false,
    policy_version: null, policy_override_reason: null, source_task: slug, external_ref: null, trigger_ref: null, decision: feature, workspace: null,
  }, 'd');

  it('dedups by ticket, case-insensitively, bumping route_count and keeping the ticket', async () => {
    const first = await upsertRoutingEvent(pool, base({ external_ref: 'yal-1' }), 'd', { countRoute: true });
    const second = await upsertRoutingEvent(pool, base({ external_ref: 'YAL-1', task_description: 'Fix the date picker (again)' }), 'd', { countRoute: true });
    expect(second.id).toBe(first.id);
    expect(second.route_count).toBe(2);
    expect(second.task_description).toBe('Fix the date picker (again)');
    expect(second.last_routed_at.getTime()).toBeGreaterThanOrEqual(first.last_routed_at.getTime());
    expect((await pool.query('SELECT count(*)::int AS n FROM routing_events')).rows[0].n).toBe(1);
  });

  it('dedups by normalized text when there is no ticket, and countRoute: false does not bump', async () => {
    const a = await upsertRoutingEvent(pool, base(), 'd', { countRoute: true });
    const b = await upsertRoutingEvent(pool, base({ task_description: '  fix THE date   picker ' }), 'd', { countRoute: false });
    expect(b.id).toBe(a.id);
    expect(b.route_count).toBe(1);
    const c = await upsertRoutingEvent(pool, base({ external_ref: 'YAL-2' }), 'd', { countRoute: true });
    expect(c.id).not.toBe(a.id);
  });

  it('keeps the same text in two apps as two events', async () => {
    const a = await upsertRoutingEvent(pool, base(), 'd', { countRoute: true });
    const b = await upsertRoutingEvent(pool, base({ app_id: billingId }), 'd', { countRoute: true });
    expect(b.id).not.toBe(a.id);
    expect(await findRoutingEventByIdentity(pool, billingId, identityKey(null, 'Fix the date picker'))).toMatchObject({ id: b.id });
  });

  it('starts events created without a routing call at route_count 0', async () => {
    const e = await upsertRoutingEvent(pool, base(), 'd', { countRoute: false });
    expect(e.route_count).toBe(0);
  });

  it('lists with app and overlap date filters, joined feature state and commit counts, plus a summary', async () => {
    const old = await upsertRoutingEvent(pool, base({ task_description: 'Old fix' }), 'd', { countRoute: true });
    await pool.query(`UPDATE routing_events SET first_routed_at = '2026-01-10T00:00:00Z', last_routed_at = '2026-01-12T00:00:00Z' WHERE id = $1`, [old.id]);
    const recent = await upsertRoutingEvent(pool, base({ task_description: 'Recent fix', external_ref: 'YAL-9' }), 'd', { countRoute: true });
    const other = await upsertRoutingEvent(pool, base({ app_id: billingId, task_description: 'Billing spike', decision: { ...trivial, intent: 'spike', rule: '3-spike' }, lite: false }), 'd', { countRoute: true });
    const csvEvent = await upsertRoutingEvent(pool, base({ task_description: 'Add CSV export', decision: feature, lite: false }), 'd', { countRoute: true });
    const csvFeature = await newFeature('add-csv-export');
    await linkRoutingEventToFeature(pool, csvEvent.id, csvFeature.id);
    const all = await listRoutingEvents(pool, { appId: null, from: null, to: null, limit: 10 });
    expect(all.map((e) => e.id)).toEqual(expect.arrayContaining([old.id, recent.id, other.id, csvEvent.id]));
    const csv = all.find((e) => e.id === csvEvent.id)!;
    expect(csv).toMatchObject({ feature_id: csvFeature.id, feature_slug: 'add-csv-export', feature_status: 'active', feature_phase: 'specify', commit_count: 0, app_slug: 'checkout' });
    const checkoutOnly = await listRoutingEvents(pool, { appId, from: null, to: null, limit: 10 });
    expect(checkoutOnly.every((e) => e.app_id === appId)).toBe(true);
    expect(checkoutOnly.map((e) => e.id)).not.toContain(other.id);
    const january = await listRoutingEvents(pool, { appId: null, from: new Date('2026-01-11T00:00:00Z'), to: new Date('2026-01-31T23:59:59.999Z'), limit: 10 });
    expect(january.map((e) => e.id)).toEqual([old.id]);
    const future = await listRoutingEvents(pool, { appId: null, from: new Date('2099-01-01T00:00:00Z'), to: null, limit: 10 });
    expect(future).toEqual([]);
    const summary = await routingSummary(pool, { appId: null, from: null, to: null });
    expect(summary).toEqual(expect.arrayContaining([{ intent: 'trivial', count: 2 }, { intent: 'spike', count: 1 }, { intent: 'feature', count: 1 }]));
  });

  it('links to a feature and requires known ids', async () => {
    const e = await upsertRoutingEvent(pool, base(), 'd', { countRoute: true });
    const f = await newFeature('something-else');
    const linked = await linkRoutingEventToFeature(pool, e.id, f.id);
    expect(linked.feature_id).toBe(f.id);
    await expect(requireRoutingEvent(pool, 'r_nope')).rejects.toMatchObject({ code: 'ROUTING_EVENT_NOT_FOUND' });
  });
});
