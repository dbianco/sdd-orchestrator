import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getContext } from '../../../src/services/getContext.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const goodProposal = '## Why\nExports are manual.\n\n## What Changes\nAdd a CSV button.\n';
const evidence = { tests: { command: 'npm test', passed: 3, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/a.ts'] };

describe.skipIf(!url)('advancePhase', () => {
  let deps: ServiceDeps;
  let fid: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    deps = { pool, embedder, tokenBudget: 6000 };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
  });
  afterAll(closeTestPool);

  it('fails the gate as a normal result and leaves the phase unchanged', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nTBD\n' }, human_approved: true });
    expect(r.result).toBe('fail');
    expect(r.findings.map((f) => f.check).sort()).toEqual(['placeholder_scan', 'required_sections']);
    expect(r.feature.current_phase).toBe('specify');
    expect(r.next_instructions).toBeNull();
    const t = (await deps.pool.query('SELECT * FROM phase_transitions WHERE feature_id = $1', [fid])).rows;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ result: 'fail', direction: 'forward', human_approved: true });
    expect(t[0].pack_id).toMatch(/^cp_/);
    const a = (await deps.pool.query('SELECT name, content FROM feature_artifacts WHERE transition_id = $1', [t[0].id])).rows;
    expect(a).toEqual([{ name: 'proposal.md', content: '## Why\nTBD\n' }]);
  });

  it('mandates human approval out of specify', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal } });
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([expect.objectContaining({ check: 'human_approved' })]);
  });

  it('passes and returns next instructions for the new phase', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    expect(r.result).toBe('pass');
    expect(r.feature).toMatchObject({ current_phase: 'implement', phase_alias: 'apply' });
    expect(r.next_instructions).toContain('Phase: implement (apply)');
    expect(r.next_instructions).toContain(`Feature: ${fid}`);
  });

  it('enforces STALE_STATE, PHASE_ORDER_VIOLATION with targets, and archived', async () => {
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' })).rejects.toMatchObject({ code: 'STALE_STATE' });
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'verify' })).rejects.toMatchObject({ code: 'PHASE_ORDER_VIOLATION', details: { forward: ['implement'], backward: [] } });
    await expect(advancePhase(deps, { feature_id: 'f_nope', actor: 'd', expected_phase: 'specify', target_phase: 'implement' })).rejects.toMatchObject({ code: 'FEATURE_NOT_FOUND' });
  });

  it('runs the full loop to archived and refuses further moves', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    expect((await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' })).result).toBe('pass');
    const v = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(v.result).toBe('pass');
    const a = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' });
    expect(a.result).toBe('pass');
    expect(a.feature.status).toBe('archived');
    expect(a.next_instructions).toContain('archived');
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' })).rejects.toMatchObject({ code: 'FEATURE_ARCHIVED' });
    const ctx = await getContext(deps, { feature_id: fid, actor: 'd' });
    expect(ctx.feature.status).toBe('archived');
    expect(ctx.context_pack).toContain('Phase: integrate');
  });

  it('requires evidence out of verify and mandates approval there for high risk', async () => {
    const risky = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Fix auth', decision: { ...decision, high_risk: true } });
    const id = risky.feature_id;
    await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'implement', target_phase: 'verify' });
    const noEvidence = await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', human_approved: true });
    expect(noEvidence.findings[0]).toMatchObject({ check: 'verify_evidence', severity: 'blocker' });
    const noApproval = await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(noApproval.findings).toEqual([expect.objectContaining({ check: 'human_approved' })]);
    expect((await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence, human_approved: true })).result).toBe('pass');
  });

  it('handles backward moves, failed cycles, blocking and the unblock', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' });
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'implement' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('reason') });
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'specify', cycle_failed: true, reason: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('cycle_failed') });
    for (let i = 1; i <= 3; i++) {
      const back = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'implement', cycle_failed: true, reason: `red ${i}` });
      expect(back.feature.failed_cycles).toBe(i);
      expect(back.feature.current_phase).toBe('implement');
      if (i < 3) { expect(back.feature.status).toBe('active'); await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' }); }
      else expect(back.feature).toMatchObject({ status: 'blocked', blocked_reason: 'red 3' });
    }
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' })).rejects.toMatchObject({ code: 'FEATURE_BLOCKED' });
    const unblock = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'rethink' });
    expect(unblock.feature).toMatchObject({ status: 'active', failed_cycles: 0, current_phase: 'specify', blocked_reason: null });
    const t = (await deps.pool.query('SELECT direction, reason FROM phase_transitions WHERE feature_id = $1 AND direction = $2 ORDER BY created_at', [fid, 'backward'])).rows;
    expect(t.map((x) => x.reason)).toEqual(['red 1', 'red 2', 'red 3', 'rethink']);
  });

  it('repins to the current framework version on a backward move', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await deps.pool.query(`INSERT INTO frameworks (id, name, pack_version, tracks, gate_library_version, status, created_by) SELECT 'fw_new', name, '1.1.0', tracks, gate_library_version, 'active', 'seed' FROM frameworks WHERE name = 'mini'`);
    const noRepin = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'x' });
    expect(noRepin.feature.framework_pack_version).toBe('1.0.0');
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    const repinned = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'x', repin: true });
    expect(repinned.feature.framework_pack_version).toBe('1.1.0');
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', repin: true, artifacts: { 'proposal.md': goodProposal }, human_approved: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('repin') });
  });

  it('serialises concurrent transitions: one passes, the other gets STALE_STATE', async () => {
    const input = { feature_id: fid, actor: 'd', expected_phase: 'specify' as const, target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true };
    const results = await Promise.allSettled([advancePhase(deps, input), advancePhase(deps, input)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toMatchObject({ code: 'STALE_STATE' });
  });

  it('getContext persists a pack for the requested phase with focus and scope', async () => {
    const c = await getContext(deps, { feature_id: fid, actor: 'prompt', phase: 'specify', focus: 'ADR-1', scope: 'company' });
    expect(c.pack_id).toMatch(/^cp_/);
    const row = (await deps.pool.query('SELECT * FROM context_packs WHERE id = $1', [c.pack_id])).rows[0];
    expect(row).toMatchObject({ created_by: 'prompt', focus: 'ADR-1', scope: 'company', phase: 'specify' });
    await expect(getContext(deps, { feature_id: fid, actor: 'd', phase: 'plan' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
