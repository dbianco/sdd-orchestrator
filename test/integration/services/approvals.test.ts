import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { withRequirementGates } from '../../helpers/requirementGates.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { approveRequest, rejectRequest } from '../../../src/services/decideApproval.js';
import { getApproval } from '../../../src/store/approvals.js';
import { appendPolicy } from '../../../src/store/policies.js';
import { listRequirements } from '../../../src/store/requirements.js';
import { rtmRows } from '../../../src/store/rtm.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const proposal = '## Why\nExports are manual.\n\n## What Changes\n- **FR-001**: add a CSV button\n';

describe.skipIf(!url)('approval decisions', () => {
  let deps: ServiceDeps;
  let appId: string;
  let fid: string;
  let approvalId: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    await withRequirementGates(pool);
    deps = { pool, embedder, tokenBudget: 6000, authMode: 'warn' };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'Add CSV export', decision })).feature_id;
    approvalId = (await advancePhase(deps, { feature_id: fid, actor: 'dana', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal } })).approval_id!;
  });
  afterAll(closeTestPool);

  it('approves: moves the feature, records the approver, captures requirements and returns instructions', async () => {
    const r = await approveRequest(deps, { approval_id: approvalId, actor: 'erin', comment: 'looks right', apps: null });
    expect(r.approval).toMatchObject({ status: 'approved', decided_by: 'erin', comment: 'looks right' });
    expect(r.feature).toMatchObject({ current_phase: 'implement', pending_approval: null });
    expect(r.next_instructions).toContain('Phase: implement');
    const t = (await deps.pool.query(`SELECT result, human_approved, approved_by, approval_id, created_by FROM phase_transitions WHERE feature_id = $1 ORDER BY created_at`, [fid])).rows;
    expect(t).toEqual([
      { result: 'awaiting_approval', human_approved: false, approved_by: null, approval_id: null, created_by: 'dana' },
      { result: 'pass', human_approved: true, approved_by: 'erin', approval_id: approvalId, created_by: 'erin' },
    ]);
    expect((await listRequirements(deps.pool, fid)).map((x) => x.req_id)).toEqual(['FR-001']);
    expect((await rtmRows(deps.pool, appId))[0]).toMatchObject({ req_id: 'FR-001', spec_approved_by: 'erin' });
  });

  it('allows self-approval on an ordinary app', async () => {
    expect((await approveRequest(deps, { approval_id: approvalId, actor: 'dana', apps: null })).feature.current_phase).toBe('implement');
  });

  it('refuses self-approval on a compliance app or when the policy demands a distinct approver', async () => {
    await deps.pool.query(`UPDATE apps SET compliance = true WHERE id = $1`, [appId]);
    await expect(approveRequest(deps, { approval_id: approvalId, actor: 'dana', apps: null })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'approver must differ from requester' });
    await deps.pool.query(`UPDATE apps SET compliance = false WHERE id = $1`, [appId]);
    await appendPolicy(deps.pool, appId, { framework: null, path_rules: [], risk_paths: [], approval: { distinct_approver: true } }, 'four eyes', 'admin');
    await expect(approveRequest(deps, { approval_id: approvalId, actor: 'dana', apps: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an approver restricted to another app', async () => {
    await expect(approveRequest(deps, { approval_id: approvalId, actor: 'erin', apps: ['app_other'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects with a reason: fail transition with the rejection finding, feature stays', async () => {
    const r = await rejectRequest(deps, { approval_id: approvalId, actor: 'erin', reason: 'criteria contradict', apps: null });
    expect(r.approval).toMatchObject({ status: 'rejected', decided_by: 'erin', comment: 'criteria contradict' });
    expect(r.feature.current_phase).toBe('specify');
    const last = (await deps.pool.query(`SELECT result, findings FROM phase_transitions WHERE feature_id = $1 ORDER BY created_at DESC LIMIT 1`, [fid])).rows[0];
    expect(last.result).toBe('fail');
    expect(last.findings).toContainEqual({ check: 'human_approved', severity: 'blocker', location: null, message: 'rejected by erin: criteria contradict' });
  });

  it('refuses decisions on unknown, decided or stale requests', async () => {
    await expect(approveRequest(deps, { approval_id: 'ap_nope', actor: 'erin', apps: null })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
    await approveRequest(deps, { approval_id: approvalId, actor: 'erin', apps: null });
    await expect(rejectRequest(deps, { approval_id: approvalId, actor: 'erin', reason: 'x', apps: null })).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING', details: { status: 'approved' } });
    await deps.pool.query(`UPDATE approval_requests SET status = 'pending' WHERE id = $1`, [approvalId]);
    await expect(approveRequest(deps, { approval_id: approvalId, actor: 'erin', apps: null })).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect((await getApproval(deps.pool, approvalId))?.status).toBe('pending');
  });
});
