import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { recordCommit } from '../../../src/services/recordCommit.js';
import { insertCiEvidence } from '../../../src/store/ciEvidence.js';
import { upsertCommit } from '../../../src/store/commits.js';
import { appendPolicy } from '../../../src/store/policies.js';
import { createToken } from '../../../src/store/tokens.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const passing = { tests: { command: 'npm test', passed: 10, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 } };

describe.skipIf(!url)('CI evidence at the verify gate', () => {
  let off: ServiceDeps;
  let warn: ServiceDeps;
  let appId: string;
  let fid: string;
  let tokenId: string;

  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    off = { pool, embedder, tokenBudget: 6000, authMode: 'off' };
    warn = { ...off, authMode: 'warn' };
    tokenId = (await createToken(pool, { actor: 'ci', name: 'n', scopes: ['ci'], app_ids: null, expires_at: null }, 't')).row.id;
    fid = (await startFeature(off, { app: 'checkout', actor: 'dana', task_description: 'CSV export', decision })).feature_id;
    await advancePhase(off, { feature_id: fid, actor: 'dana', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nx\n\n## What Changes\ny\n' }, human_approved: true });
    await advancePhase(off, { feature_id: fid, actor: 'dana', expected_phase: 'implement', target_phase: 'verify' });
  });
  afterAll(closeTestPool);

  const postCi = async (sha: string, evidence: Record<string, unknown>) => {
    const row = await insertCiEvidence(warn.pool, { app_id: appId, feature_id: fid, commit_sha: sha, branch: null, run_url: null, evidence, token_id: tokenId }, 'ci');
    await upsertCommit(warn.pool, { app_id: appId, sha, branch: null, message: 'ci', files_changed: [], committed_at: null, routing_id: null, feature_id: fid, source: 'ci' }, 'ci');
    return row;
  };
  const verify = (deps: ServiceDeps, evidence: Record<string, unknown> = passing) =>
    advancePhase(deps, { feature_id: fid, actor: 'dana', expected_phase: 'verify', target_phase: 'integrate', evidence });
  const compliance = () => warn.pool.query('UPDATE apps SET compliance = true WHERE id = $1', [appId]);

  it('blocks a compliance app without CI evidence, whatever the host reports', async () => {
    await compliance();
    const r = await verify(warn);
    expect(r.result).toBe('fail');
    expect(r.findings.map((f) => f.message)).toContain('CI evidence required: none recorded since the feature entered verify');
  });

  it('passes a compliance app on CI evidence for the latest commit and records its sources', async () => {
    await compliance();
    const ci = await postCi('abc1234', passing);
    const r = await verify(warn, { implements: [] });
    expect(r.result).toBe('pass');
    const t = (await warn.pool.query(`SELECT evidence_sources, ci_evidence_id FROM phase_transitions WHERE feature_id = $1 AND from_phase = 'verify'`, [fid])).rows[0];
    expect(t).toEqual({ ci_evidence_id: ci.id, evidence_sources: { tests: 'ci', lint: 'ci', security: 'ci', implements: 'host' } });
  });

  it('blocks when a newer commit landed after the CI run', async () => {
    await compliance();
    await postCi('abc1234', passing);
    await recordCommit(warn, { app: 'checkout', actor: 'dana', sha: 'fff9999', message: 'later', feature_id: fid, committed_at: new Date(Date.now() + 60_000).toISOString() });
    const r = await verify(warn);
    expect(r.findings.map((f) => f.message)).toContain('CI evidence is for abc1234 but the latest commit of the feature is fff9999');
  });

  it('prefers CI results over host results on an ordinary app', async () => {
    await postCi('abc1234', { tests: { command: 'npm test', passed: 8, failed: 2 } });
    const r = await verify(warn);
    expect(r.result).toBe('fail');
    expect(r.findings).toContainEqual(expect.objectContaining({ check: 'verify_evidence', message: '2 tests failed' }));
  });

  it('lets a policy opt a high-risk feature out of CI evidence, and ignores CI rows when auth is off', async () => {
    await warn.pool.query('UPDATE features SET high_risk = true WHERE id = $1', [fid]);
    await appendPolicy(warn.pool, appId, { framework: null, path_rules: [], risk_paths: [], evidence: 'host' }, 'no pipeline yet', 'admin');
    expect((await verify(warn)).result).toBe('awaiting_approval');
    await postCi('abc1234', { tests: { command: 'npm test', passed: 8, failed: 2 } });
    expect((await verify(off, passing)).findings.filter((f) => f.severity === 'blocker').map((f) => f.check)).toEqual(['human_approved']);
  });
});
