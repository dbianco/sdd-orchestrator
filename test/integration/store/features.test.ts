import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp } from '../../../src/store/apps.js';
import { createFeature, getFeature, requireFeature, updateFeature, listFeatures, type NewFeature } from '../../../src/store/features.js';
import { insertPack, latestPack, latestPackPerPhase } from '../../../src/store/packs.js';
import { insertTransition, insertArtifacts, listTransitions, ARTIFACT_CONTENT_CAP } from '../../../src/store/transitions.js';
import { insertProposal, listProposals, reviewProposal } from '../../../src/store/proposals.js';
import { DomainError } from '../../../src/errors.js';

const url = process.env.SDD_TEST_DATABASE_URL;

export function newFeature(appId: string, over: Partial<NewFeature> = {}): NewFeature {
  return {
    app_id: appId, slug: 'csv-export', intent: 'feature', framework: 'openspec', framework_pack_version: '1.0.0', track: 'default',
    high_risk: false, policy_version: null, policy_override_reason: null, source_task: 'Add CSV export', external_ref: null, trigger_ref: null,
    decision: { intent: 'feature', framework: 'openspec', track: 'default', confidence: 'high', rule: '10-brownfield-small-medium', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' },
    workspace: null, ...over,
  };
}

describe.skipIf(!url)('features', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('creates in specify and disambiguates slug collisions', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f1 = await createFeature(pool, newFeature(app.id), 'daniel');
    const f2 = await createFeature(pool, newFeature(app.id), 'daniel');
    const f3 = await createFeature(pool, newFeature(app.id), 'daniel');
    expect(f1.id).toMatch(/^f_/);
    expect([f1.slug, f2.slug, f3.slug]).toEqual(['csv-export', 'csv-export-2', 'csv-export-3']);
    expect(f1.current_phase).toBe('specify');
    expect(f1.status).toBe('active');
    expect((await getFeature(pool, f1.id))?.decision.rule).toBe('10-brownfield-small-medium');
    await expect(requireFeature(pool, 'f_missing')).rejects.toMatchObject({ code: 'FEATURE_NOT_FOUND' } satisfies Partial<DomainError>);
  });

  it('does not treat LIKE wildcard characters in a slug base as wildcards', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    // Without escaping (or starts_with), '_' in the LIKE pattern used for collision detection
    // matches any single character, so this differently-spelled slug could be mistaken for a
    // "check_out-N" collision.
    await createFeature(pool, newFeature(app.id, { slug: 'checkXout-2' }), 'daniel');
    const f = await createFeature(pool, newFeature(app.id, { slug: 'check_out' }), 'daniel');
    expect(f.slug).toBe('check_out');
  });

  it('forUpdate only holds a real row lock when used on a transaction client', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f = await createFeature(pool, newFeature(app.id), 'daniel');

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      await clientA.query('BEGIN');
      await getFeature(clientA, f.id, { forUpdate: true });

      // B cannot take the same lock while A holds it and hasn't committed/rolled back.
      await clientB.query('BEGIN');
      await expect(
        clientB.query(`SELECT * FROM features WHERE id = $1 FOR UPDATE NOWAIT`, [f.id]),
      ).rejects.toThrow(/could not obtain lock/i);
      await clientB.query('ROLLBACK');

      // Once A releases the lock, B can acquire it.
      await clientA.query('COMMIT');
      await clientB.query('BEGIN');
      await expect(
        clientB.query(`SELECT * FROM features WHERE id = $1 FOR UPDATE NOWAIT`, [f.id]),
      ).resolves.toBeDefined();
      await clientB.query('COMMIT');
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('updates state and lists by status and external ref', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f1 = await createFeature(pool, newFeature(app.id, { external_ref: 'YAL-1' }), 'daniel');
    const f2 = await createFeature(pool, newFeature(app.id, { slug: 'other' }), 'daniel');
    await updateFeature(pool, f2.id, { status: 'archived', current_phase: 'integrate' });
    await updateFeature(pool, f1.id, { status: 'blocked', blocked_reason: 'x', failed_cycles: 3 });
    expect((await listFeatures(pool, app.id, ['active', 'blocked'], null, 50)).map((f) => f.id)).toEqual([f1.id]);
    expect((await listFeatures(pool, app.id, ['archived'], null, 50)).map((f) => f.id)).toEqual([f2.id]);
    expect((await listFeatures(pool, app.id, ['active', 'blocked', 'archived'], 'YAL-1', 50)).map((f) => f.id)).toEqual([f1.id]);
  });

  it('records packs, transitions and artifacts', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f = await createFeature(pool, newFeature(app.id), 'daniel');
    const p1 = await insertPack(pool, { feature_id: f.id, phase: 'specify', scope: 'app', focus: null, items: [{ stable_id: 'a', version: 1 }], rendered: 'text', token_count: 1, budget: 6000, degraded: false, over_budget: false }, 'daniel');
    const p2 = await insertPack(pool, { feature_id: f.id, phase: 'specify', scope: 'app', focus: 'x', items: [], rendered: 'text2', token_count: 1, budget: 6000, degraded: true, over_budget: false }, 'prompt');
    expect((await latestPack(pool, f.id, 'specify'))?.id).toBe(p2.id);
    expect(await latestPackPerPhase(pool, f.id)).toEqual({ specify: p2.id });
    const t = await insertTransition(pool, { feature_id: f.id, from_phase: 'specify', to_phase: 'implement', direction: 'forward', result: 'fail', findings: [{ check: 'placeholder_scan', severity: 'blocker', location: 'a.md:1', message: 'marker TBD' }], evidence: null, pack_id: p1.id, artifact_hashes: { 'a.md': 'sha' }, human_approved: true, reason: null }, 'daniel');
    const big = 'x'.repeat(ARTIFACT_CONTENT_CAP + 1);
    const arts = await insertArtifacts(pool, t.id, { 'a.md': 'TBD', 'big.md': big }, 'daniel');
    expect(arts.find((a) => a.name === 'a.md')).toMatchObject({ byte_length: 3, content: 'TBD' });
    expect(arts.find((a) => a.name === 'big.md')).toMatchObject({ byte_length: ARTIFACT_CONTENT_CAP + 1, content: null });
    expect(arts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await listTransitions(pool, f.id)).map((x) => x.result)).toEqual(['fail']);
  });

  it('stores and reviews proposals', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f = await createFeature(pool, newFeature(app.id), 'daniel');
    const p = await insertProposal(pool, { app_id: app.id, feature_id: f.id, payload: { title: 'ADR-9 x', body: 'b', kind: 'app_memory', memory_type: 'adr' }, supersedes: null }, 'daniel');
    expect(p.status).toBe('pending');
    expect((await listProposals(pool, 'pending')).map((x) => x.id)).toEqual([p.id]);
    const r = await reviewProposal(pool, p.id, 'rejected', 'admin', 'dup');
    expect(r).toMatchObject({ status: 'rejected', reviewed_by: 'admin', review_reason: 'dup' });
    expect(await listProposals(pool, 'pending')).toEqual([]);
  });
});
