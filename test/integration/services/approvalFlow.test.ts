import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase, HUMAN_APPROVED_IGNORED } from '../../../src/services/advancePhase.js';
import { getApproval, pendingApproval } from '../../../src/store/approvals.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const proposal = '## Why\nExports are manual.\n\n## What Changes\nAdd a CSV button.\n';
const toImplement = { expected_phase: 'specify' as const, target_phase: 'implement', artifacts: { 'proposal.md': proposal } };

describe.skipIf(!url)('server-side approval requests', () => {
  let deps: ServiceDeps;
  let fid: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    deps = { pool, embedder, tokenBudget: 6000, authMode: 'warn' };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'Add CSV export', decision })).feature_id;
  });
  afterAll(closeTestPool);

  it('stops a passing move that needs approval at awaiting_approval', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'dana', ...toImplement });
    expect(r.result).toBe('awaiting_approval');
    expect(r.approval_id).toMatch(/^ap_/);
    expect(r.feature.current_phase).toBe('specify');
    expect(r.feature.pending_approval).toMatchObject({ approval_id: r.approval_id, from: 'specify', to: 'implement', requested_by: 'dana' });
    expect(r.next_instructions).toContain(`sdd-admin approvals approve ${r.approval_id}`);
    const t = (await deps.pool.query('SELECT result, human_approved FROM phase_transitions WHERE feature_id = $1', [fid])).rows;
    expect(t).toEqual([{ result: 'awaiting_approval', human_approved: false }]);
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM feature_artifacts')).rows[0].n).toBe(1);
  });

  it('fails without a request when a blocker remains, and ignores human_approved with a warning', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'dana', ...toImplement, artifacts: { 'proposal.md': '## Why\nTBD\n' }, human_approved: true });
    expect(r.result).toBe('fail');
    expect(r.findings.map((f) => f.check)).not.toContain('human_approved');
    expect(r.warnings).toContain(HUMAN_APPROVED_IGNORED);
    expect(await pendingApproval(deps.pool, fid)).toBeNull();
  });

  it('reports awaiting_approval on dry_run without writing anything', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'dana', ...toImplement, dry_run: true });
    expect(r.result).toBe('awaiting_approval');
    expect(r.approval_id).toBeUndefined();
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM approval_requests')).rows[0].n).toBe(0);
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM phase_transitions')).rows[0].n).toBe(0);
  });

  it('supersedes the pending request when the move is requested again or a backward move happens', async () => {
    const first = await advancePhase(deps, { feature_id: fid, actor: 'dana', ...toImplement });
    const second = await advancePhase(deps, { feature_id: fid, actor: 'dana', ...toImplement });
    expect((await getApproval(deps.pool, first.approval_id!))?.status).toBe('superseded');
    expect((await pendingApproval(deps.pool, fid))?.id).toBe(second.approval_id);
    // No earlier phase exists from specify, so exercise the backward path from implement via off-mode setup.
    const offDeps = { ...deps, authMode: 'off' as const };
    const other = (await startFeature(offDeps, { app: 'checkout', actor: 'dana', task_description: 'Another', decision })).feature_id;
    await advancePhase(offDeps, { feature_id: other, actor: 'dana', ...toImplement, human_approved: true });
    await advancePhase(offDeps, { feature_id: other, actor: 'dana', expected_phase: 'implement', target_phase: 'verify' });
    const highRisk = await deps.pool.query('UPDATE features SET high_risk = true WHERE id = $1', [other]);
    expect(highRisk.rowCount).toBe(1);
    const evidence = { tests: { command: 'npm test', passed: 1, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 } };
    const awaiting = await advancePhase(deps, { feature_id: other, actor: 'dana', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(awaiting.result).toBe('awaiting_approval');
    const back = await advancePhase(deps, { feature_id: other, actor: 'dana', expected_phase: 'verify', target_phase: 'implement', reason: 'fix a bug' });
    expect(back.warnings).toContain('the pending approval request was superseded by this backward move');
    expect((await getApproval(deps.pool, awaiting.approval_id!))?.status).toBe('superseded');
    expect(back.feature.pending_approval).toBeNull();
  });

  it('passes moves that need no approval as before', async () => {
    const offDeps = { ...deps, authMode: 'off' as const };
    await advancePhase(offDeps, { feature_id: fid, actor: 'dana', ...toImplement, human_approved: true });
    const r = await advancePhase(deps, { feature_id: fid, actor: 'dana', expected_phase: 'implement', target_phase: 'verify' });
    expect(r.result).toBe('pass');
  });
});

describe.skipIf(!url)('analytics ignore awaiting_approval rows', () => {
  afterAll(closeTestPool);
  it('counts a move once in flow and gate statistics', async () => {
    const { flowCounts, gateCheckStats } = await import('../../../src/store/analytics.js');
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    const deps: ServiceDeps = { pool, embedder, tokenBudget: 6000, authMode: 'warn' };
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'x', decision })).feature_id;
    await advancePhase(deps, { feature_id: fid, actor: 'dana', ...toImplement });
    expect(await flowCounts(pool)).toEqual([]);
    expect(await gateCheckStats(pool)).toEqual([]);
  });
});
