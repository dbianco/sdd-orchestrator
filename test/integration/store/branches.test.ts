import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { currentFramework, deprecateFramework, getFrameworkVersion, listCurrentFrameworks, upsertFramework } from '../../../src/store/frameworks.js';
import { deprecateItem } from '../../../src/store/knowledge.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { runEval } from '../../../src/eval/run.js';
import type { Decision } from '../../../src/domain/types.js';
import type { MetricsHooks } from '../../../src/services/deps.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const spec = '## Why\nx\n\n## What Changes\ny\n';
const metrics = (): MetricsHooks => ({ routed: vi.fn(), gate: vi.fn(), degradedPack: vi.fn(), overBudgetPack: vi.fn(), failedCycle: vi.fn(), authRejected: vi.fn(), approval: vi.fn(), ciEvidence: vi.fn(), requirementsUncovered: vi.fn() });

describe.skipIf(!url)('store and service branches', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('picks the newest framework version and handles missing versions and version-less deprecation', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    const mini = (await currentFramework(pool, 'mini'))!;
    await upsertFramework(pool, { name: 'mini', pack_version: '1.10.0', tracks: mini.tracks as never, gate_library_version: '3' }, 'seed');
    await upsertFramework(pool, { name: 'mini', pack_version: '1.9.0', tracks: mini.tracks as never, gate_library_version: '3' }, 'seed');
    expect((await listCurrentFrameworks(pool)).find((f) => f.name === 'mini')?.pack_version).toBe('1.10.0');
    expect(await getFrameworkVersion(pool, 'mini', '9.9.9')).toBeNull();
    expect(await getFrameworkVersion(pool, 'ghost', '1.0.0')).toBeNull();
    expect(await deprecateFramework(pool, 'mini', null, 'retired', 'cli')).toBeGreaterThanOrEqual(2);
    expect(await deprecateFramework(pool, 'ghost', null, 'x', 'cli')).toBe(0);
  });

  it('deprecates knowledge with and without a successor and refuses unknown ids', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    await expect(deprecateItem(pool, 'nope.item', null, 'x', 'cli')).rejects.toThrow('no current item with stable_id "nope.item"');
    await expect(deprecateItem(pool, 'mini.template.proposal', 'nope.successor', 'x', 'cli')).rejects.toThrow('to use as successor');
    expect((await deprecateItem(pool, 'mini.template.proposal', 'mini.template.apply', 'superseded', 'cli')).status).toBe('deprecated');
  });

  it('validates the track on start_feature', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    const deps = { pool, embedder, tokenBudget: 6000 };
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: { ...decision, track: 'nope' } })).rejects.toThrow(/has no track "nope"/);
  });

  it('reports degraded and over-budget packs to the metrics hooks', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    await pool.query(`UPDATE apps SET token_budget = 50 WHERE slug = 'checkout'`);
    const hooks = metrics();
    await startFeature({ pool, embedder: null, tokenBudget: 6000, metrics: hooks }, { app: 'checkout', actor: 'd', task_description: 'x', decision });
    expect(hooks.degradedPack).toHaveBeenCalledOnce();
    expect(hooks.overBudgetPack).toHaveBeenCalledOnce();
  });

  it('refuses forward moves of a blocked feature and rejects a foreign pack id', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    const deps = { pool, embedder, tokenBudget: 6000, metrics: metrics() };
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision })).feature_id;
    await pool.query(`UPDATE features SET status = 'blocked', blocked_reason = NULL WHERE id = $1`, [fid]);
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': spec } })).rejects.toMatchObject({ code: 'FEATURE_BLOCKED', message: expect.stringContaining('no reason recorded') });
    await pool.query(`UPDATE features SET status = 'active' WHERE id = $1`, [fid]);
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': spec }, pack_id: 'pk_other' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('feeds gate and cycle metrics, and tolerates a failing notifier lookup', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    const hooks = metrics();
    const notifier = { approvalRequested: vi.fn() };
    const deps = { pool, embedder, tokenBudget: 6000, metrics: hooks, notifier, authMode: 'warn' as const };
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision })).feature_id;
    const failed = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nTBD\n' } });
    expect(failed.result).toBe('fail');
    expect(hooks.gate).toHaveBeenCalledWith('placeholder_scan', 'fail');
    const awaiting = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': spec } });
    expect(awaiting.result).toBe('awaiting_approval');
    expect(notifier.approvalRequested).toHaveBeenCalledOnce();
    // a notifier that cannot look the approval up must not break the move: delete the request first
    await pool.query(`DELETE FROM phase_transitions WHERE approval_id IS NOT NULL AND false`);
    await pool.query(`UPDATE features SET current_phase = 'verify' WHERE id = $1`, [fid]);
    expect((await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'implement', reason: 'tests fail', cycle_failed: true })).result).toBe('pass');
    expect(hooks.failedCycle).toHaveBeenCalledOnce();
  });

  it('runs an eval with no cases', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    expect(await runEval({ q: pool, embedder }, [])).toMatchObject({ cases: [], recall: 0, mrr: 0 });
  });
});
