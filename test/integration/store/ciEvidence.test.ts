import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { recordCommit } from '../../../src/services/recordCommit.js';
import { insertCiEvidence, latestCiEvidenceSinceVerify, latestFeatureCommitSha } from '../../../src/store/ciEvidence.js';
import { createToken } from '../../../src/store/tokens.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('ci evidence store', () => {
  let deps: ServiceDeps;
  let appId: string;
  let fid: string;
  let tokenId: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    deps = { pool, embedder, tokenBudget: 6000 };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'CSV', decision })).feature_id;
    tokenId = (await createToken(pool, { actor: 'ci', name: 'n', scopes: ['ci'], app_ids: null, expires_at: null }, 't')).row.id;
  });
  afterAll(closeTestPool);

  const report = (sha: string) => insertCiEvidence(deps.pool, { app_id: appId, feature_id: fid, commit_sha: sha, branch: null, run_url: null, evidence: {}, token_id: tokenId }, 'ci');

  it('returns only evidence posted since the feature last entered verify', async () => {
    await report('aaaaaaa');
    expect((await latestCiEvidenceSinceVerify(deps.pool, fid))?.commit_sha).toBe('aaaaaaa');
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nx\n\n## What Changes\ny\n' }, human_approved: true });
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' });
    expect(await latestCiEvidenceSinceVerify(deps.pool, fid)).toBeNull();
    await report('bbbbbbb');
    expect((await latestCiEvidenceSinceVerify(deps.pool, fid))?.commit_sha).toBe('bbbbbbb');
  });

  it('finds the latest commit of a feature by commit date', async () => {
    await recordCommit(deps, { app: 'checkout', actor: 'd', sha: '1111111', message: 'a', feature_id: fid, committed_at: '2026-09-25T10:00:00Z' });
    await recordCommit(deps, { app: 'checkout', actor: 'd', sha: '2222222', message: 'b', feature_id: fid, committed_at: '2026-09-25T09:00:00Z' });
    expect(await latestFeatureCommitSha(deps.pool, fid)).toBe('1111111');
  });
});
