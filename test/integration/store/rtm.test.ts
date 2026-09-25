import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { withRequirementGates } from '../../helpers/requirementGates.js';
import { rtmCsv, rtmRows } from '../../../src/store/rtm.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const proposal = '## Why\nExports are manual.\n\n## What Changes\n- **FR-001**: export\n- **FR-002**: stream, "fast"\n';
const evidence = { tests: { command: 'npm test', passed: 7, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/a.ts', 'src/b.ts'], implements: ['FR-001'] };

describe.skipIf(!url)('traceability matrix', () => {
  let deps: ServiceDeps;
  let appId: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    await withRequirementGates(pool, 'warning');
    deps = { pool, embedder, tokenBudget: 6000 };
  });
  afterAll(closeTestPool);

  it('lists one row per requirement with coverage, evidence and approvers', async () => {
    const f = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'CSV export', decision, external_ref: 'YAL-9' })).feature_id;
    await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'no requirements yet', decision });
    const step = (from: string, to: string, extra = {}) => advancePhase(deps, { feature_id: f, actor: 'dana', expected_phase: from as 'specify', target_phase: to, ...extra });
    await step('specify', 'implement', { artifacts: { 'proposal.md': proposal }, human_approved: true });
    expect((await rtmRows(deps.pool, appId)).map((r) => [r.req_id, r.covered])).toEqual([['FR-001', null], ['FR-002', null]]);
    await step('implement', 'verify');
    await step('verify', 'integrate', { evidence });
    await step('integrate', 'archived');
    const rows = await rtmRows(deps.pool, appId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ feature_id: f, external_ref: 'YAL-9', req_id: 'FR-001', covered: true, files_changed: ['src/a.ts', 'src/b.ts'], tests_passed: 7, tests_failed: 0, evidence_source: 'host', spec_approved_by: 'dana', verify_approved_by: null });
    expect(rows[0]!.archived_at).toMatch(/^\d{4}-/);
    expect(rows[1]).toMatchObject({ req_id: 'FR-002', covered: false });
    const csv = rtmCsv(rows).split('\n');
    expect(csv[0]).toBe('feature_id,slug,external_ref,req_id,covered,files_changed,tests_passed,tests_failed,evidence_source,spec_approved_by,verify_approved_by,archived_at');
    expect(csv[1]).toContain(',YAL-9,FR-001,true,src/a.ts;src/b.ts,7,0,host,dana,,');
  });
});
