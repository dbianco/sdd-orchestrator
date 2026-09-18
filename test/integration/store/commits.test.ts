import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll } from '../../helpers/seed.js';
import { upsertRoutingEvent } from '../../../src/store/routingEvents.js';
import { upsertCommit, listCommitsForRouting } from '../../../src/store/commits.js';
import type { Decision } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;
const trivial: Decision = { intent: 'trivial', framework: 'none', track: null, confidence: 'high', rule: '4-trivial', reasons: [], high_risk: false, policy_version: null, framework_pack_version: null };

describe.skipIf(!url)('commits store', () => {
  let pool: pg.Pool;
  let appId: string;
  let routingId: string;

  beforeEach(async () => {
    pool = await getTestPool();
    await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    routingId = (await upsertRoutingEvent(pool, { app_id: appId, external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix', decision: trivial, lite: true, workspace: null }, 'd', { countRoute: true })).id;
  });
  afterAll(closeTestPool);

  it('inserts, then dedups by sha keeping anchors and refreshing message/files', async () => {
    const first = await upsertCommit(pool, { app_id: appId, sha: 'abc1234', branch: 'main', message: 'fix: date picker', files_changed: ['src/a.css'], committed_at: new Date('2026-09-18T10:00:00Z'), routing_id: routingId, feature_id: null }, 'd');
    expect(first.deduplicated).toBe(false);
    expect(first.row).toMatchObject({ sha: 'abc1234', routing_id: routingId, source: 'host' });
    const again = await upsertCommit(pool, { app_id: appId, sha: 'abc1234', branch: null, message: 'fix: date picker (amended)', files_changed: ['src/a.css', 'src/b.css'], committed_at: null, routing_id: null, feature_id: null }, 'd');
    expect(again.deduplicated).toBe(true);
    expect(again.row).toMatchObject({ id: first.row.id, branch: 'main', message: 'fix: date picker (amended)', files_changed: ['src/a.css', 'src/b.css'], routing_id: routingId });
    expect(again.row.committed_at?.toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(await listCommitsForRouting(pool, { id: routingId, feature_id: null })).toHaveLength(1);
  });

  it('rejects a commit with no anchor at the database boundary', async () => {
    await expect(upsertCommit(pool, { app_id: appId, sha: 'deadbee', branch: null, message: 'x', files_changed: [], committed_at: null, routing_id: null, feature_id: null }, 'd')).rejects.toThrow();
  });
});
