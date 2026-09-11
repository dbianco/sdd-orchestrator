import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getFeatureStatus } from '../../../src/services/featureStatus.js';
import { listFeaturesService } from '../../../src/services/listFeatures.js';
import { searchMemory } from '../../../src/services/searchMemory.js';
import { proposeMemory } from '../../../src/services/proposeMemory.js';
import { createApp } from '../../../src/store/apps.js';
import { insertItemVersion } from '../../../src/store/knowledge.js';
import { insertChunks } from '../../../src/store/chunks.js';
import { fakeEmbed } from '../../../src/embedding/fake.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('read services and propose_memory', () => {
  let deps: ServiceDeps;
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); deps = { pool, embedder, tokenBudget: 6000 }; });
  afterAll(closeTestPool);

  it('reports status with transitions and latest packs', async () => {
    const s = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision, external_ref: 'YAL-1' });
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': 'TBD' }, human_approved: true });
    const st = await getFeatureStatus(deps, s.feature_id);
    expect(st).toMatchObject({ feature_id: s.feature_id, current_phase: 'specify', phase_alias: 'proposal', external_ref: 'YAL-1', allowed_targets: { forward: ['implement'], backward: [] } });
    expect(st.transitions).toHaveLength(1);
    expect(st.transitions[0]).toMatchObject({ from_phase: 'specify', to_phase: 'implement', result: 'fail', created_by: 'd' });
    expect(st.transitions[0]?.findings_count).toBeGreaterThan(0);
    expect(st.latest_pack_per_phase).toEqual({ specify: s.pack_id });
    await expect(getFeatureStatus(deps, 'f_nope')).rejects.toMatchObject({ code: 'FEATURE_NOT_FOUND' });
  });

  it('lists features by app, status and external_ref', async () => {
    const a = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'A', decision, external_ref: 'YAL-1' });
    const b = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'B', decision });
    await deps.pool.query(`UPDATE features SET status = 'archived' WHERE id = $1`, [b.feature_id]);
    expect((await listFeaturesService(deps, { app: 'checkout' })).features.map((f) => f.feature_id)).toEqual([a.feature_id]);
    expect((await listFeaturesService(deps, { app: 'checkout', status: ['archived'] })).features.map((f) => f.feature_id)).toEqual([b.feature_id]);
    expect((await listFeaturesService(deps, { app: 'checkout', status: ['active', 'archived'], external_ref: 'YAL-1' })).features).toHaveLength(1);
    expect((await listFeaturesService(deps, { app: 'checkout' })).features[0]).toMatchObject({ slug: 'yal-1-a', framework: 'mini', current_phase: 'specify', updated_at: expect.any(String) });
    await expect(listFeaturesService(deps, { app: 'nope' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });

  it('searches memory with scope semantics and exact ids', async () => {
    const billing = await createApp(deps.pool, { slug: 'billing', name: 'B' }, 'seed');
    const checkoutId = (await deps.pool.query(`SELECT id FROM apps WHERE slug = 'checkout'`)).rows[0].id;
    for (const [slug, appId, id, title] of [['checkout', checkoutId, 'checkout.adr.0001', 'ADR-1 csv export orders'], ['billing', billing.id, 'billing.adr.0001', 'billing csv export orders']] as const) {
      const row = await insertItemVersion(deps.pool, { stable_id: id, kind: 'app_memory', tier: 'retrieved', framework: null, app_id: appId, memory_type: 'adr', human_id: title.startsWith('ADR') ? 'ADR-1' : null, stack_tags: [], phase_tags: [], title, body: 'csv export orders', front_matter: {}, pack_name: 'proposals', pack_version: null, source_path: null, source_hash: null, source_url: null, license: null }, 'seed');
      await insertChunks(deps.pool, row.id, [{ ordinal: 0, heading_path: '', text: `${slug} csv export orders`, embedding: fakeEmbed(`${title}\n\n${slug} csv export orders`), embedding_model: 'fake-1024', token_count: 4, tokenizer: 'cl100k_base' }], 'seed');
    }
    const app = await searchMemory(deps, { query: 'csv export orders', app: 'checkout' });
    expect(app.chunks.map((c) => c.stable_id)).toContain('checkout.adr.0001');
    expect(app.chunks.map((c) => c.stable_id)).not.toContain('billing.adr.0001');
    expect(app.chunks.find((c) => c.stable_id === 'checkout.adr.0001')?.app).toBe('checkout');
    const company = await searchMemory(deps, { query: 'csv export orders', app: 'checkout', scope: 'company' });
    expect(company.chunks.map((c) => c.stable_id)).not.toContain('checkout.adr.0001');
    const listed = await searchMemory(deps, { query: 'csv export orders', app: 'checkout', scope: ['billing'], kinds: ['app_memory'] });
    expect(listed.chunks.map((c) => c.stable_id)).toEqual(['billing.adr.0001']);
    const exact = await searchMemory(deps, { query: 'what did ADR-1 decide', app: 'checkout' });
    expect(exact.chunks[0]).toMatchObject({ stable_id: 'checkout.adr.0001', match: 'exact_id' });
    const degraded = await searchMemory({ ...deps, embedder: null }, { query: 'ADR-1', app: 'checkout' });
    expect(degraded.degraded).toBe(true);
    expect(degraded.chunks.map((c) => c.stable_id)).toEqual(['checkout.adr.0001']);
  });

  it('stores proposals and refuses archived features', async () => {
    const s = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'A', decision });
    const p = await proposeMemory(deps, { feature_id: s.feature_id, actor: 'd', kind: 'app_memory', memory_type: 'adr', title: 'ADR-9 stream exports', body: 'Stream.', links: ['archive/x'], supersedes: 'checkout.adr.0001' });
    expect(p).toEqual({ proposal_id: expect.stringMatching(/^p_/), status: 'pending' });
    const row = (await deps.pool.query('SELECT * FROM proposals WHERE id = $1', [p.proposal_id])).rows[0];
    expect(row).toMatchObject({ supersedes: 'checkout.adr.0001', created_by: 'd', status: 'pending' });
    expect(row.payload).toMatchObject({ kind: 'app_memory', memory_type: 'adr', title: 'ADR-9 stream exports', links: ['archive/x'] });
    await expect(proposeMemory(deps, { feature_id: s.feature_id, actor: 'd', kind: 'app_memory', title: 't', body: 'b' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await deps.pool.query(`UPDATE features SET status = 'archived' WHERE id = $1`, [s.feature_id]);
    await expect(proposeMemory(deps, { feature_id: s.feature_id, actor: 'd', kind: 'standard', title: 't', body: 'b' })).rejects.toMatchObject({ code: 'FEATURE_ARCHIVED' });
  });
});
