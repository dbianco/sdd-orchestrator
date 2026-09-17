import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { insertProposal } from '../../../src/store/proposals.js';
import { featureCounts, gateCheckStats, flowCounts, proposalsSummary, knowledgeCounts } from '../../../src/store/analytics.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const goodProposal = '## Why\nExports are manual.\n\n## What Changes\nAdd a CSV button.\n';

describe.skipIf(!url)('analytics store', () => {
  let deps: ServiceDeps;
  let appId: string;

  beforeEach(async () => {
    const pool = await getTestPool();
    await truncateAll(pool);
    const seeded = await seedAll(pool);
    appId = seeded.appId;
    deps = { pool, embedder, tokenBudget: 6000 };
  });
  afterAll(closeTestPool);

  it('counts features by status/phase/framework/track, optionally scoped to an app', async () => {
    await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision });
    const counts = await featureCounts(deps.pool);
    expect(counts).toEqual([{ status: 'active', current_phase: 'specify', framework: 'mini', track: 'default', count: 1 }]);
    expect(await featureCounts(deps.pool, 'nope')).toEqual([]);
    expect(await featureCounts(deps.pool, appId)).toEqual(counts);
  });

  it('aggregates gate check blocker/warning counts, unnesting findings across transitions', async () => {
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nTBD\n' }, human_approved: true });
    const stats = await gateCheckStats(deps.pool);
    expect(stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'placeholder_scan', blocker_count: 1, warning_count: 0 }),
      expect.objectContaining({ check: 'required_sections', blocker_count: 1, warning_count: 0 }),
    ]));
  });

  it('counts distinct transitions per check, not individual findings', async () => {
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
    // Three placeholder markers on three separate lines => three placeholder_scan
    // blocker findings, all from the same check inside a single transition.
    const artifacts = { 'proposal.md': '## Why\nTBD\n\n## What Changes\nTODO\n\nNEEDS HUMAN INPUT\n' };
    const advanced = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts, human_approved: true });
    const placeholderFindings = advanced.findings.filter((f) => f.check === 'placeholder_scan' && f.severity === 'blocker');
    expect(placeholderFindings.length).toBeGreaterThanOrEqual(2);

    const stats = await gateCheckStats(deps.pool);
    const placeholder = stats.find((s) => s.check === 'placeholder_scan');
    expect(placeholder).toEqual({ check: 'placeholder_scan', blocker_count: 1, warning_count: 0 });
  });

  it('counts forward transitions by from/to/result, excluding backward moves', async () => {
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'rethink' });
    expect(await flowCounts(deps.pool)).toEqual([{ from_phase: 'specify', to_phase: 'implement', result: 'pass', count: 1 }]);
  });

  it('summarises proposals by status', async () => {
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
    await insertProposal(deps.pool, { app_id: appId, feature_id: fid, payload: { kind: 'adr' }, supersedes: null }, 'd');
    expect(await proposalsSummary(deps.pool)).toEqual([{ status: 'pending', count: 1 }]);
  });

  it('counts knowledge items by kind and memory_type', async () => {
    const counts = await knowledgeCounts(deps.pool);
    expect(counts.some((c) => c.kind === 'framework_pack')).toBe(true);
  });
});
