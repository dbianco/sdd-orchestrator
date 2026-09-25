import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { insertTransition } from '../../../src/store/transitions.js';
import { createApproval, decideApproval, getApproval, listApprovals, pendingApproval, supersedePending } from '../../../src/store/approvals.js';
import type { Decision } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('approvals store', () => {
  let pool: pg.Pool;
  let featureId: string;
  let appId: string;
  const awaiting = () => insertTransition(pool, { feature_id: featureId, from_phase: 'specify', to_phase: 'implement', direction: 'forward', result: 'awaiting_approval', findings: [], evidence: null, pack_id: null, artifact_hashes: {}, human_approved: false, reason: null }, 'dana');

  beforeEach(async () => {
    pool = await getTestPool(); await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    featureId = (await startFeature({ pool, embedder, tokenBudget: 6000 }, { app: 'checkout', actor: 'dana', task_description: 'CSV', decision })).feature_id;
  });
  afterAll(closeTestPool);

  it('accepts awaiting_approval transitions and allows one pending request per feature', async () => {
    const t = await awaiting();
    const a = await createApproval(pool, { feature_id: featureId, transition_id: t.id, from_phase: 'specify', to_phase: 'implement' }, 'dana');
    expect(a).toMatchObject({ status: 'pending', requested_by: 'dana', created_by: 'dana' });
    expect(a.id).toMatch(/^ap_/);
    await expect(createApproval(pool, { feature_id: featureId, transition_id: t.id, from_phase: 'specify', to_phase: 'implement' }, 'dana')).rejects.toThrow(/approval_requests_one_pending/);
    expect(await supersedePending(pool, featureId, 'dana')).toBe(1);
    expect((await getApproval(pool, a.id))?.status).toBe('superseded');
    const b = await createApproval(pool, { feature_id: featureId, transition_id: (await awaiting()).id, from_phase: 'specify', to_phase: 'implement' }, 'dana');
    expect((await pendingApproval(pool, featureId))?.id).toBe(b.id);
  });

  it('records decisions and lists with app and feature context', async () => {
    const a = await createApproval(pool, { feature_id: featureId, transition_id: (await awaiting()).id, from_phase: 'specify', to_phase: 'implement' }, 'dana');
    expect(await listApprovals(pool, { status: 'pending' })).toEqual([expect.objectContaining({ id: a.id, app: 'checkout', framework: 'mini' })]);
    expect(await listApprovals(pool, { appIds: ['app_other'] })).toEqual([]);
    const d = await decideApproval(pool, a.id, { status: 'approved', decided_by: 'erin', comment: 'fine' });
    expect(d).toMatchObject({ status: 'approved', decided_by: 'erin', comment: 'fine' });
    expect(d.decided_at).not.toBeNull();
    expect(await pendingApproval(pool, featureId)).toBeNull();
    expect(await listApprovals(pool, { appId })).toHaveLength(1);
  });
});
