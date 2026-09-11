import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp, updateApp, addStopCondition } from '../../../src/store/apps.js';
import { upsertFramework } from '../../../src/store/frameworks.js';
import { insertItemVersion, type NewKnowledgeItem } from '../../../src/store/knowledge.js';
import { insertChunks } from '../../../src/store/chunks.js';
import { createFeature } from '../../../src/store/features.js';
import { FakeEmbeddingProvider, fakeEmbed } from '../../../src/embedding/fake.js';
import { assembleContextPack } from '../../../src/assembler/assemble.js';
import { buildLitePack } from '../../../src/assembler/lite.js';
import { attachedLayers } from '../../../src/assembler/layers.js';
import { countTokens } from '../../../src/tokens.js';
import type { TrackDecl } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;

const track: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped', tasks: 'skipped', implement: { alias: 'apply', template: 'openspec.template.apply' }, verify: { template: 'openspec.template.verify' },
    integrate: { alias: 'archive', template: 'openspec.template.archive' }, learn: 'skipped',
  },
  gates: [{ transition: 'specify->implement', artifacts: ['proposal.md'], checks: [{ name: 'placeholder_scan' }] }],
};

function item(over: Partial<NewKnowledgeItem>): NewKnowledgeItem {
  return { stable_id: 'x', kind: 'standard', tier: 'retrieved', framework: null, app_id: null, memory_type: null, human_id: null, stack_tags: [], phase_tags: [],
    title: 'T', body: 'B', front_matter: {}, pack_name: 'company', pack_version: '1.0.0', source_path: null, source_hash: null, source_url: null, license: null, ...over };
}

async function seed(pool: pg.Pool, over: Partial<NewKnowledgeItem>, chunkText = over.body ?? 'B') {
  const row = await insertItemVersion(pool, item(over), 'cli');
  await insertChunks(pool, row.id, [{ ordinal: 0, heading_path: over.title ?? 'T', text: chunkText, embedding: fakeEmbed(`${over.title} > ${chunkText}`), embedding_model: 'fake-1024', token_count: countTokens(chunkText), tokenizer: 'cl100k_base' }], 'cli');
  return row;
}

async function fixture(pool: pg.Pool) {
  let app = await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'cli');
  app = await addStopCondition(pool, 'checkout', 'Never change tax rounding', 'cli');
  await upsertFramework(pool, { name: 'openspec', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
  await seed(pool, { stable_id: 'company.constitution', tier: 'always_on', title: 'Constitution', body: '- No PII in logs (GDPR)' });
  await seed(pool, { stable_id: 'checkout.steering', tier: 'always_on', app_id: app.id, pack_name: 'checkout-steering', title: 'Steering', body: '- Exports go through reporting (ADR-7)' });
  await seed(pool, { stable_id: 'openspec.template.proposal', kind: 'framework_pack', framework: 'openspec', pack_name: 'openspec', phase_tags: ['specify'], title: 'Proposal template', body: '## Why\n## What Changes\n## Impact' });
  await seed(pool, { stable_id: 'openspec.guide.proposals', kind: 'framework_pack', framework: 'openspec', pack_name: 'openspec', phase_tags: ['specify'], title: 'Writing proposals', body: 'csv export orders proposal guidance' });
  await seed(pool, { stable_id: 'checkout.adr.0007', kind: 'app_memory', memory_type: 'adr', app_id: app.id, human_id: 'ADR-7', pack_name: 'proposals', pack_version: null, title: 'ADR-7 Exports go through the reporting service', body: 'csv export orders decision' });
  await seed(pool, { stable_id: 'quality.tdd', pack_name: 'quality-layer', title: 'Test-driven development', body: 'csv export orders tests first' });
  await seed(pool, { stable_id: 'react.hooks', kind: 'stack_guide', pack_name: 'stack-guides/react', stack_tags: ['react'], title: 'Hooks', body: 'csv export orders hooks guidance' });
  await seed(pool, { stable_id: 'go.errors', kind: 'stack_guide', pack_name: 'stack-guides/go', stack_tags: ['go'], title: 'Errors', body: 'csv export orders go errors' });
  const feature = await createFeature(pool, {
    app_id: app.id, slug: 'csv-export', intent: 'feature', framework: 'openspec', framework_pack_version: '1.0.0', track: 'default', high_risk: false,
    policy_version: null, policy_override_reason: null, source_task: 'Add CSV export to the orders page', external_ref: null, trigger_ref: null,
    decision: { intent: 'feature', framework: 'openspec', track: 'default', confidence: 'high', rule: '10-brownfield-small-medium', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' },
    workspace: { stack: ['react'] },
  }, 'daniel');
  return { app, feature };
}

describe.skipIf(!url)('assembleContextPack', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('renders the six positions in order and persists the pack', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    const t = pack.rendered;
    expect(t.indexOf('Feature: ' + feature.id)).toBeGreaterThan(-1);
    expect(t.indexOf('Phase: specify (proposal)')).toBeLessThan(t.indexOf('## 2.'));
    expect(t.indexOf('[company.constitution v1]')).toBeLessThan(t.indexOf('[checkout.steering v1]'));
    expect(t.indexOf('## 3.')).toBeLessThan(t.indexOf('## Why'));
    expect(t).toContain('<retrieved id="checkout.adr.0007"');
    expect(t).toContain('<retrieved id="openspec.guide.proposals"');
    expect(t).toContain('<retrieved id="quality.tdd"');
    expect(t).not.toContain('<retrieved id="openspec.template.proposal"');   // template is position 3, not 4
    expect(t).toContain('<retrieved id="react.hooks"');
    expect(t).not.toContain('go.errors');
    expect(t).toContain('- Never change tax rounding');
    expect(t).toContain('Next gate: specify -> implement');
    expect(t).toContain('Artifacts: proposal.md');
    expect(pack.items).toEqual(expect.arrayContaining([{ stable_id: 'company.constitution', version: 1 }, { stable_id: 'openspec.template.proposal', version: 1 }, { stable_id: 'checkout.adr.0007', version: 1 }]));
    expect(pack.token_count).toBe(countTokens(t));
    expect(pack.degraded).toBe(false);
    expect(pack.over_budget).toBe(false);
    expect(pack.created_by).toBe('daniel');
    expect(warnings).toEqual([]);
  });

  it('ranks exact-id hits from focus, trigger_ref and external_ref first', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: 'kubernetes ingress ADR-7', scope: 'app', createdBy: 'daniel' });
    const pos4 = pack.rendered.slice(pack.rendered.indexOf('## 4.'), pack.rendered.indexOf('## 5.'));
    expect(pos4.indexOf('checkout.adr.0007')).toBeLessThan(pos4.indexOf('quality.tdd') === -1 ? Infinity : pos4.indexOf('quality.tdd'));
    expect(pos4).toContain('match="exact_id"');
  });

  it('trims stack guides first then retrieved knowledge, never the fixed positions', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    await updateApp(pool, 'checkout', { token_budget: 400 }, 'cli');
    const tightApp = { ...app, token_budget: 400 };
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app: tightApp, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    expect(pack.budget).toBe(400);
    expect(pack.rendered).not.toContain('react.hooks');
    expect(pack.rendered).toContain('[company.constitution v1]');
    expect(pack.rendered).toContain('## Why');
    expect(warnings.some((w) => /trimmed/.test(w))).toBe(true);
  });

  it('marks over_budget when fixed positions exceed the budget', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app: { ...app, token_budget: 50 }, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    expect(pack.over_budget).toBe(true);
    expect(warnings.some((w) => /over budget/.test(w))).toBe(true);
  });

  it('degrades without an embedder and still returns exact-id hits', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: null, defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: 'ADR-7', scope: 'app', createdBy: 'daniel' });
    expect(pack.degraded).toBe(true);
    expect(pack.rendered).toContain('checkout.adr.0007');
    expect(pack.rendered).not.toContain('quality.tdd');
    expect(warnings.some((w) => /degraded/.test(w))).toBe(true);
  });

  it('honours scope company and slug lists', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const billing = await createApp(pool, { slug: 'billing', name: 'B' }, 'cli');
    await seed(pool, { stable_id: 'billing.adr.0001', kind: 'app_memory', memory_type: 'adr', app_id: billing.id, pack_name: 'proposals', pack_version: null, title: 'billing csv export orders', body: 'csv export orders billing' });
    const company = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: 'company', createdBy: 'daniel' });
    expect(company.pack.rendered).not.toContain('checkout.adr.0007');
    expect(company.pack.rendered).toContain('[checkout.steering v1]');   // always-on is independent of scope
    const listed = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: ['billing'], createdBy: 'daniel' });
    expect(listed.pack.rendered).toContain('billing.adr.0001');
    await expect(assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: ['nope'], createdBy: 'daniel' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });

  it('falls back to app.default_stack when workspace.stack is an empty array', async () => {
    const pool = await getTestPool();
    const { app, feature: base } = await fixture(pool);
    const feature = { ...base, workspace: { stack: [] } };
    const { pack } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    expect(pack.rendered).toContain('react.hooks');
  });

  it('warns when the phase template falls back from the pinned framework-pack version to the current version', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'cli');
    const fallbackTrack: TrackDecl = { ...track, phases: { ...track.phases, specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.fallback' } } };
    await upsertFramework(pool, { name: 'openspec', pack_version: '1.0.0', tracks: { default: fallbackTrack }, gate_library_version: '1' }, 'cli');
    // Only a newer pack_version of the template exists; nothing under the feature's pinned 1.0.0 version.
    await seed(pool, { stable_id: 'openspec.template.fallback', kind: 'framework_pack', framework: 'openspec', pack_name: 'openspec', pack_version: '2.0.0', phase_tags: ['specify'], title: 'Fallback template', body: '## Why fallback' });
    const feature = await createFeature(pool, {
      app_id: app.id, slug: 'fallback-test', intent: 'feature', framework: 'openspec', framework_pack_version: '1.0.0', track: 'default', high_risk: false,
      policy_version: null, policy_override_reason: null, source_task: 'test template fallback', external_ref: null, trigger_ref: null,
      decision: { intent: 'feature', framework: 'openspec', track: 'default', confidence: 'high', rule: '10-brownfield-small-medium', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' },
      workspace: null,
    }, 'daniel');
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    expect(warnings.some((w) => /openspec\.template\.fallback.*using current version instead/.test(w))).toBe(true);
    expect(pack.rendered).toContain('## Why fallback');
  });

  it('does not re-retrieve or duplicate an always-on item into position 4', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    await seed(pool, { stable_id: 'checkout.always.adr9', tier: 'always_on', app_id: app.id, human_id: 'ADR-9', pack_name: 'checkout-steering', title: 'Always-on ADR-9', body: 'Always-on decision text referencing ADR-9' });
    const { pack } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: 'ADR-9', scope: 'app', createdBy: 'daniel' });
    expect(pack.rendered.split('checkout.always.adr9').length - 1).toBe(1);
    const stableIds = pack.items.map((i) => i.stable_id);
    expect(new Set(stableIds).size).toBe(stableIds.length);
  });
});

describe.skipIf(!url)('attachedLayers and lite pack', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('attaches the quality layer and matching stack guides', async () => {
    const pool = await getTestPool();
    await fixture(pool);
    const { layers } = await attachedLayers(pool, ['react']);
    expect(layers).toEqual([
      { pack_name: 'quality-layer', pack_version: '1.0.0', kind: 'standard' },
      { pack_name: 'stack-guides/react', pack_version: '1.0.0', kind: 'stack_guide' },
    ]);
    const { layers: none, warnings } = await attachedLayers(pool, ['python']);
    expect(none.map((l) => l.pack_name)).toEqual(['quality-layer']);
    expect(warnings).toEqual([]);
  });

  it('builds a lite pack with always-on, stack guides and stop conditions only', async () => {
    const pool = await getTestPool();
    const { app } = await fixture(pool);
    const lite = await buildLitePack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { app, taskDescription: 'csv export orders hooks', stack: ['react'] });
    expect(lite.rendered).toContain('[company.constitution v1]');
    expect(lite.rendered).toContain('react.hooks');
    expect(lite.rendered).toContain('- Never change tax rounding');
    expect(lite.rendered).not.toContain('Next gate');
    expect(lite.rendered).not.toContain('checkout.adr.0007');
    expect(lite.token_count).toBe(countTokens(lite.rendered));
    expect((await pool.query('SELECT count(*)::int AS n FROM context_packs')).rows[0].n).toBe(0);
  });

  it('reports degraded when there is no embedder even if no stack pack matches (so retrieve() never runs)', async () => {
    const pool = await getTestPool();
    const { app } = await fixture(pool);
    const lite = await buildLitePack({ q: pool, embedder: null, defaultBudget: 6000 }, { app, taskDescription: 'csv export orders', stack: ['nonexistent-stack'] });
    expect(lite.degraded).toBe(true);
  });
});
