import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { loadPack } from '../../../src/ingest/load.js';
import { ingestPack } from '../../../src/ingest/ingest.js';
import { reindexAll } from '../../../src/ingest/reindex.js';
import { approveProposal } from '../../../src/services/approveProposal.js';
import { FakeEmbeddingProvider } from '../../../src/embedding/fake.js';
import { createApp } from '../../../src/store/apps.js';
import { createFeature } from '../../../src/store/features.js';
import { currentItem, itemVersion, insertItemVersion, deprecateItem } from '../../../src/store/knowledge.js';
import { currentFramework } from '../../../src/store/frameworks.js';
import { getEmbeddingConfig, setEmbeddingConfig } from '../../../src/store/embeddingConfig.js';
import { insertProposal } from '../../../src/store/proposals.js';
import { exactIdSearch } from '../../../src/store/retrieval.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const embedder = new FakeEmbeddingProvider();

describe.skipIf(!url)('ingestPack', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('ingests a framework pack: items, chunks, framework row, embedding config', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-framework`);
    const report = await ingestPack({ pool, embedder }, pack, 'cli');
    expect(report.created.sort()).toEqual(['mini.guide.proposals', 'mini.template.apply', 'mini.template.proposal']);
    expect(report.skipped).toEqual([]);
    const fw = await currentFramework(pool, 'mini');
    expect(fw?.pack_version).toBe('1.0.0');
    expect(fw?.gate_library_version).toBe('1');
    const item = await currentItem(pool, 'mini.template.proposal');
    expect(item).toMatchObject({ kind: 'framework_pack', framework: 'mini', pack_name: 'mini', pack_version: '1.0.0', phase_tags: ['specify'], license: 'MIT', source_url: 'https://example.com/mini' });
    const chunks = await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.stable_id = $1', ['mini.guide.proposals']);
    expect(chunks.rows[0].n).toBe(2);
    expect(await getEmbeddingConfig(pool)).toMatchObject({ provider: 'fake', model: 'fake-1024', dimension: 1024 });
  });

  it('skips unchanged files, versions changed ones, warns on removed ones', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-company`);
    await ingestPack({ pool, embedder }, pack, 'cli');
    const again = await ingestPack({ pool, embedder }, pack, 'cli');
    expect(again.skipped).toEqual(['mini-company.constitution']);
    const changed = structuredClone(pack);
    changed.items[0]!.body += '\n- New rule (reason)';
    changed.items[0]!.sourceHash = 'changed';
    const r2 = await ingestPack({ pool, embedder }, changed, 'cli');
    expect(r2.created).toEqual(['mini-company.constitution']);
    expect((await currentItem(pool, 'mini-company.constitution'))?.version).toBe(2);
    expect((await itemVersion(pool, 'mini-company.constitution', 1))?.superseded_by).not.toBeNull();
    const removed = structuredClone(pack);
    removed.items = [];
    const r3 = await ingestPack({ pool, embedder }, removed, 'cli');
    expect(r3.warnings).toContain('mini-company.constitution is active in the database but no longer in the pack; deprecate it explicitly if intended');
    expect((await currentItem(pool, 'mini-company.constitution'))?.version).toBe(2);
  });

  it('re-versions framework items when the pack version changes even if unchanged', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-framework`);
    await ingestPack({ pool, embedder }, pack, 'cli');
    const bumped = structuredClone(pack);
    bumped.manifest.version = '1.1.0';
    const r = await ingestPack({ pool, embedder }, bumped, 'cli');
    expect(r.created).toHaveLength(3);
    expect((await currentItem(pool, 'mini.template.proposal'))?.pack_version).toBe('1.1.0');
    expect((await currentFramework(pool, 'mini'))?.pack_version).toBe('1.1.0');
  });

  it('refuses an invalid pack and writes nothing', async () => {
    const pool = await getTestPool();
    const pack = structuredClone(await loadPack(`${fixtures}mini-framework`));
    pack.manifest.tracks!.default!.gates[0]!.checks.push({ name: 'nope' });
    await expect(ingestPack({ pool, embedder }, pack, 'cli')).rejects.toThrow(/unknown check "nope"/);
    expect((await pool.query('SELECT count(*)::int AS n FROM knowledge_items')).rows[0].n).toBe(0);
  });

  it('honours supersedes in front matter and app-scoped items', async () => {
    const pool = await getTestPool();
    await createApp(pool, { slug: 'checkout', name: 'C' }, 'cli');
    const pack = structuredClone(await loadPack(`${fixtures}mini-company`));
    pack.manifest.name = 'checkout-steering';
    pack.items[0]!.frontMatter.id = 'checkout.steering';
    pack.items[0]!.frontMatter.app = 'checkout';
    await ingestPack({ pool, embedder }, pack, 'cli');
    const next = structuredClone(pack);
    next.items[0]!.frontMatter.id = 'checkout.steering-v2';
    next.items[0]!.frontMatter.supersedes = 'checkout.steering';
    next.items[0]!.sourceHash = 'h2';
    await ingestPack({ pool, embedder }, next, 'cli');
    const old = await currentItem(pool, 'checkout.steering');
    expect(old).toBeNull();
    expect((await itemVersion(pool, 'checkout.steering', 1))?.superseded_by).toBe((await currentItem(pool, 'checkout.steering-v2'))?.id);
    expect((await currentItem(pool, 'checkout.steering-v2'))?.app_id).not.toBeNull();
  });

  it('warns when a second pack reuses another pack\'s stable_id', async () => {
    const pool = await getTestPool();
    const packA = structuredClone(await loadPack(`${fixtures}mini-company`));
    packA.manifest.name = 'pack-a';
    await ingestPack({ pool, embedder }, packA, 'cli');
    const packB = structuredClone(packA);
    packB.manifest.name = 'pack-b';
    packB.items[0]!.sourceHash = 'different-hash-for-pack-b';
    const r = await ingestPack({ pool, embedder }, packB, 'cli');
    expect(r.warnings).toContain(`${packA.items[0]!.frontMatter.id} is currently owned by pack "pack-a"; ingesting moves it to "pack-b"`);
  });

  it('does not resurrect an item that was explicitly deprecated when the pack is re-ingested unchanged', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-framework`);
    await ingestPack({ pool, embedder }, pack, 'cli');
    await deprecateItem(pool, 'mini.guide.proposals', null, 'obsolete', 'admin');
    expect(await currentItem(pool, 'mini.guide.proposals')).toBeNull();
    const r = await ingestPack({ pool, embedder }, pack, 'cli');
    expect(await currentItem(pool, 'mini.guide.proposals')).toBeNull();
    expect(r.skipped).toContain('mini.guide.proposals');
    expect(r.warnings).toContain('mini.guide.proposals is deprecated in the database; leaving it deprecated (remove it from the pack, or re-activate explicitly)');
  });

  it('refuses ingestion on embedding mismatch', async () => {
    const pool = await getTestPool();
    await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024 }, 'cli');
    await expect(ingestPack({ pool, embedder }, await loadPack(`${fixtures}mini-company`), 'cli')).rejects.toMatchObject({ code: 'EMBEDDING_MODEL_MISMATCH' });
  });
});

describe.skipIf(!url)('reindexAll and approveProposal', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('re-embeds every chunk and rewrites the config', async () => {
    const pool = await getTestPool();
    await ingestPack({ pool, embedder }, await loadPack(`${fixtures}mini-framework`), 'cli');
    await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024 }, 'cli');
    const r = await reindexAll({ pool, embedder }, 'cli');
    expect(r.chunks).toBeGreaterThan(0);
    const cfg = await getEmbeddingConfig(pool);
    expect(cfg).toMatchObject({ provider: 'fake', model: 'fake-1024' });
    expect(cfg?.reindexed_at).not.toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM knowledge_chunks WHERE embedding_model <> 'fake-1024'`)).rows[0].n).toBe(0);
  });

  it('turns an approved proposal into a retrievable item and retires the superseded one', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'C' }, 'cli');
    const feature = await createFeature(pool, { app_id: app.id, slug: 's', intent: 'feature', framework: 'mini', framework_pack_version: '1.0.0', track: 'default', high_risk: false, policy_version: null, policy_override_reason: null, source_task: 't', external_ref: null, trigger_ref: null, decision: { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'x', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' }, workspace: null }, 'd');
    const old = await insertItemVersion(pool, { stable_id: 'checkout.decision.0001', kind: 'app_memory', tier: 'retrieved', framework: null, app_id: app.id, memory_type: 'decision', human_id: null, stack_tags: [], phase_tags: [], title: 'Old rule', body: 'old', front_matter: {}, pack_name: 'proposals', pack_version: null, source_path: null, source_hash: null, source_url: null, license: null }, 'cli');
    const p = await insertProposal(pool, { app_id: app.id, feature_id: feature.id, payload: { kind: 'app_memory', memory_type: 'decision', title: 'ADR-9 CSV exports stream rather than buffer', body: '## Decision\nStream.\n## Rationale\nMemory.', stack_tags: ['node'], links: ['openspec/changes/archive/x/'] }, supersedes: 'checkout.decision.0001' }, 'daniel');
    const item = await approveProposal({ pool, embedder }, p.id, 'admin');
    expect(item).toMatchObject({ stable_id: 'checkout.decision.0002', human_id: 'ADR-9', pack_name: 'proposals', pack_version: null, phase_tags: [], app_id: app.id, created_by: 'admin' });
    expect((await pool.query('SELECT status FROM proposals WHERE id = $1', [p.id])).rows[0].status).toBe('approved');
    expect((await pool.query('SELECT superseded_by FROM knowledge_items WHERE id = $1', [old.id])).rows[0].superseded_by).toBe(item.id);
    const hits = await exactIdSearch(pool, ['ADR-9'], { scope: { appIds: [app.id] }, framework: null, frameworkPackVersion: null, phase: null, kinds: ['app_memory'] });
    expect(hits[0]?.stable_id).toBe('checkout.decision.0002');
  });
});
