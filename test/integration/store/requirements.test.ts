import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { insertTransition } from '../../../src/store/transitions.js';
import { listRequirements, replaceRequirements } from '../../../src/store/requirements.js';
import type { Decision } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('requirements store', () => {
  let pool: pg.Pool;
  let featureId: string;
  let transitionId: string;

  beforeEach(async () => {
    pool = await getTestPool();
    await truncateAll(pool);
    await seedAll(pool);
    featureId = (await startFeature({ pool, embedder, tokenBudget: 6000 }, { app: 'checkout', actor: 'd', task_description: 'CSV export', decision })).feature_id;
    transitionId = (await insertTransition(pool, { feature_id: featureId, from_phase: 'specify', to_phase: 'implement', direction: 'forward', result: 'pass', findings: [], evidence: null, pack_id: null, artifact_hashes: {}, human_approved: true, reason: null }, 'd')).id;
  });
  afterAll(closeTestPool);

  it('replaces the captured set and lists it by line', async () => {
    await replaceRequirements(pool, featureId, transitionId, [{ id: 'FR-002', artifact: 'spec.md', line: 9 }, { id: 'FR-001', artifact: 'spec.md', line: 4 }], 'd');
    expect((await listRequirements(pool, featureId)).map((r) => [r.req_id, r.line])).toEqual([['FR-001', 4], ['FR-002', 9]]);
    await replaceRequirements(pool, featureId, transitionId, [{ id: 'FR-003', artifact: 'spec.md', line: 2 }], 'd');
    const rows = await listRequirements(pool, featureId);
    expect(rows.map((r) => r.req_id)).toEqual(['FR-003']);
    expect(rows[0]).toMatchObject({ artifact: 'spec.md', transition_id: transitionId, created_by: 'd' });
  });
});
