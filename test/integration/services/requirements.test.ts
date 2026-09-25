import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getFeatureStatus } from '../../../src/services/featureStatus.js';
import { getFrameworkVersion, upsertFramework } from '../../../src/store/frameworks.js';
import { listRequirements } from '../../../src/store/requirements.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision, TrackDecl } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const proposal = (ids: string[]) => `## Why\nExports are manual.\n\n## What Changes\n${ids.map((i) => `- **${i}**: something`).join('\n')}\n`;
const evidence = (impl: string[]) => ({ tests: { command: 'npm test', passed: 3, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, implements: impl });

describe.skipIf(!url)('requirement capture and coverage', () => {
  let deps: ServiceDeps;
  let fid: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    const fw = (await getFrameworkVersion(pool, 'mini', '1.0.0'))!;
    const track = structuredClone(fw.tracks.default) as TrackDecl;
    track.gates.find((g) => g.transition === 'specify->implement')!.checks.push({ name: 'requirement_ids', params: { artifact: 'proposal.md', id_regex: String.raw`\*\*(?<id>FR-\d{3})\*\*` } });
    track.gates.find((g) => g.transition === 'verify->integrate')!.checks.push({ name: 'requirement_coverage' });
    await upsertFramework(pool, { name: 'mini', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '2' }, 'seed');
    deps = { pool, embedder, tokenBudget: 6000 };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
  });
  afterAll(closeTestPool);

  const toVerify = async (ids: string[]) => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal(ids) }, human_approved: true });
    expect(r.result).toBe('pass');
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' });
  };

  it('captures ids on pass, not on fail, and replaces them after a new pass', async () => {
    const failed = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal(['FR-001']) } });
    expect(failed.result).toBe('fail');
    expect(await listRequirements(deps.pool, fid)).toEqual([]);
    await toVerify(['FR-002', 'FR-001']);
    expect((await listRequirements(deps.pool, fid)).map((r) => [r.req_id, r.line])).toEqual([['FR-002', 5], ['FR-001', 6]]);
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'specify', reason: 'rework the spec' });
    await toVerify(['FR-003']);
    expect((await listRequirements(deps.pool, fid)).map((r) => r.req_id)).toEqual(['FR-003']);
  });

  it('blocks verify when evidence.implements misses a captured requirement', async () => {
    await toVerify(['FR-001', 'FR-002']);
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence: evidence(['FR-001']) });
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([expect.objectContaining({ check: 'requirement_coverage', severity: 'blocker', location: 'FR-002' })]);
  });

  it('dry_run does not capture requirements', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal(['FR-001']) }, human_approved: true, dry_run: true });
    expect(await listRequirements(deps.pool, fid)).toEqual([]);
  });

  it('reports coverage in get_feature_status once verify has passed', async () => {
    await toVerify(['FR-001', 'FR-002']);
    expect((await getFeatureStatus(deps, fid)).requirements).toEqual([{ id: 'FR-001', covered: null }, { id: 'FR-002', covered: null }]);
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence: evidence(['fr-001', 'FR-002']) });
    expect(r.result).toBe('pass');
    expect((await getFeatureStatus(deps, fid)).requirements).toEqual([{ id: 'FR-001', covered: true }, { id: 'FR-002', covered: true }]);
  });
});
