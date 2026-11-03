import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { approveProposal } from '../../../src/services/approveProposal.js';
import { insertProposal, reviewProposal } from '../../../src/store/proposals.js';
import { seedDemo } from '../../../src/cli/commands/demo.js';
import { featurePrComment } from '../../../src/reports/prComment.js';
import { rightSizingReport } from '../../../src/lifecycle/rightSizing.js';
import { driftReport } from '../../../src/store/drift.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('proposal approval and report branches', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  async function proposal(payload: Record<string, unknown>) {
    const pool = await getTestPool();
    await seedAll(pool);
    const fid = (await startFeature({ pool, embedder, tokenBudget: 6000 }, { app: 'checkout', actor: 'd', task_description: 'x', decision })).feature_id;
    const appId = (await pool.query<{ id: string }>(`SELECT id FROM apps WHERE slug = 'checkout'`)).rows[0]!.id;
    return { pool, id: (await insertProposal(pool, { app_id: appId, feature_id: fid, payload, supersedes: null }, 'agent')).id };
  }

  it('approves a standard proposal with links under the standard sequence', async () => {
    const { pool, id } = await proposal({ kind: 'standard', title: 'Always stream', body: 'Stream large exports.', links: ['https://x/adr'], stack_tags: [] });
    const item = await approveProposal({ pool, embedder }, id, 'erin');
    expect(item.stable_id).toBe('checkout.standard.0001');
    expect(item.body).toContain('## Links\n- https://x/adr');
    expect(item.memory_type).toBeNull();
  });

  it('rejects a missing, an already reviewed and an invalid proposal', async () => {
    const pool = await getTestPool();
    await expect(approveProposal({ pool, embedder }, 'p_nope', 'erin')).rejects.toThrow('no proposal with id "p_nope"');
    const done = await proposal({ kind: 'standard', title: 'T', body: 'B' });
    await reviewProposal(done.pool, done.id, 'rejected', 'erin', 'no');
    await expect(approveProposal({ pool: done.pool, embedder }, done.id, 'erin')).rejects.toThrow('is already rejected');
  });

  it('requires a memory type for app memory', async () => {
    const { pool, id } = await proposal({ kind: 'app_memory', title: 'T', body: 'B' });
    await expect(approveProposal({ pool, embedder }, id, 'erin')).rejects.toThrow('app_memory proposals require memory_type');
  });

  it('writes the pull-request comment for features in every state', async () => {
    const pool = await getTestPool();
    await seedDemo(pool, 'demo', 'test');
    const comment = async (slug: string) => featurePrComment(pool, (await pool.query<{ id: string }>(`SELECT id FROM features WHERE slug = $1`, [slug])).rows[0]!.id);
    const blocked = await comment('webhook-retries'); // blocked, no ticket, no requirements, blockers with hints
    expect(blocked).toContain('(Three failed gate attempts');
    expect(blocked).toContain('_No requirements captured yet._');
    expect(blocked).toContain('`task_ordering` (tasks.md:8)');
    expect(blocked).not.toContain('**Ticket:**');
    const timeout = await comment('fix-checkout-timeout'); // hotfix track, ticket, covered requirement, pending coverage handled
    expect(timeout).toContain('openspec:hotfix');
    expect(timeout).toContain('**Ticket:** DEMO-102');
    const pending = await comment('saved-cards'); // spec not yet verified: coverage is pending
    expect(pending).toContain('⏳ pending');
    expect(pending).toContain('Waiting for approval');
    const done = await comment('refund-policy-page');
    expect(done).toContain('✅ covered');
    expect(done).toContain('18 passed, 0 failed');
    await pool.query(`UPDATE phase_transitions SET evidence = '{"implements":["FR-001"],"tests":{"passed":2}}' WHERE from_phase = 'verify' AND result = 'pass' AND feature_id = (SELECT id FROM features WHERE slug = 'refund-policy-page')`);
    expect(await comment('refund-policy-page')).toContain('❌ uncovered');
    await pool.query(`UPDATE phase_transitions SET findings = '[{"check":"mystery","severity":"blocker","location":null,"message":"x | y"}]' WHERE result = 'fail' AND feature_id = (SELECT id FROM features WHERE slug = 'add-csv-export')`);
    expect(await comment('add-csv-export')).toMatch(/`mystery`: x \\\| y\n/); // no location, no hint, pipes escaped
  });

  it('reports right-sizing and drift for the whole installation and for an app', async () => {
    const pool = await getTestPool();
    await seedDemo(pool, 'demo', 'test');
    const appId = (await pool.query<{ id: string }>(`SELECT id FROM apps WHERE slug = 'demo'`)).rows[0]!.id;
    expect((await rightSizingReport(pool, null, 1)).entries).toHaveLength(1);
    expect(await rightSizingReport(pool, appId)).toMatchObject({ tiny: 1 });
    expect((await rightSizingReport(pool, '__none__')).share).toBeNull();
    expect((await driftReport(pool, appId, 1))).toHaveLength(1);
    expect(await driftReport(pool, '__none__')).toEqual([]);
    // two archived specs with the same drift level are ordered by how much changed
    await pool.query(`UPDATE features SET status = 'archived' WHERE slug = 'add-csv-export'`);
    await pool.query(`INSERT INTO phase_transitions (id, feature_id, from_phase, to_phase, direction, result, findings, created_by, created_at) SELECT 't_arch', id, 'integrate', 'archived', 'forward', 'pass', '[]', 'x', now() - interval '3 days' FROM features WHERE slug = 'add-csv-export'`);
    await pool.query(`INSERT INTO commits (id, app_id, sha, message, files_changed, committed_at, feature_id, created_by)
      SELECT 'cm_x1', $1, 'cccc333', 'refactor export', ARRAY['src/orders/export.ts'], now(), id, 't' FROM features WHERE slug = 'refund-policy-page'`, [appId]);
    const both = await driftReport(pool, appId);
    expect(both.map((d) => d.level)).toEqual(['likely', 'review']);
    expect(both[1]!.slug).toBe('add-csv-export');
  });
});
