import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp } from '../../../src/store/apps.js';
import { insertItemVersion, deprecateItem, type NewKnowledgeItem } from '../../../src/store/knowledge.js';
import { insertChunks } from '../../../src/store/chunks.js';
import { vectorSearch, exactIdSearch, type RetrievalFilter } from '../../../src/store/retrieval.js';
import { fakeEmbed } from '../../../src/embedding/fake.js';
import { withTransaction } from '../../../src/db/pool.js';

const url = process.env.SDD_TEST_DATABASE_URL;

function item(over: Partial<NewKnowledgeItem>): NewKnowledgeItem {
  return {
    stable_id: 'x', kind: 'app_memory', tier: 'retrieved', framework: null, app_id: null, memory_type: 'adr', human_id: null, stack_tags: [], phase_tags: [],
    title: 'T', body: 'B', front_matter: {}, pack_name: 'proposals', pack_version: null, source_path: null, source_hash: null, source_url: null, license: null, ...over,
  };
}

async function seed(poolQ: Parameters<typeof insertItemVersion>[0], over: Partial<NewKnowledgeItem>, text: string) {
  const row = await insertItemVersion(poolQ, item(over), 'cli');
  await insertChunks(poolQ, row.id, [{ ordinal: 0, heading_path: over.title ?? 'T', text, embedding: fakeEmbed(`${over.title ?? 'T'} > ${text}`), embedding_model: 'fake-1024', token_count: 3, tokenizer: 'cl100k_base' }], 'cli');
  return row;
}

describe.skipIf(!url)('retrieval', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('filters by scope, framework, phase, kind, pinned pack version and superseded state', async () => {
    const pool = await getTestPool();
    const checkout = await createApp(pool, { slug: 'checkout', name: 'C' }, 'cli');
    const billing = await createApp(pool, { slug: 'billing', name: 'B' }, 'cli');
    const q = 'csv export streaming orders';
    await seed(pool, { stable_id: 'checkout.adr.0001', app_id: checkout.id, title: 'ADR-1 streaming exports', human_id: 'ADR-1' }, 'csv export streaming orders');
    await seed(pool, { stable_id: 'billing.adr.0001', app_id: billing.id, title: 'billing csv' }, 'csv export streaming orders invoices');
    await seed(pool, { stable_id: 'company.rule', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'exports' }, 'csv export streaming orders rule');
    await seed(pool, { stable_id: 'company.rule.old', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'exports old' }, 'csv export streaming orders rule');
    await seed(pool, { stable_id: 'company.rule.old', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'exports old v2' }, 'unrelated text about kubernetes');
    await seed(pool, { stable_id: 'openspec.guide', kind: 'framework_pack', memory_type: null, framework: 'openspec', pack_name: 'openspec', pack_version: '1.0.0', title: 'openspec csv' }, 'csv export streaming orders openspec');
    await seed(pool, { stable_id: 'openspec.guide', kind: 'framework_pack', memory_type: null, framework: 'openspec', pack_name: 'openspec', pack_version: '1.1.0', title: 'openspec csv v2' }, 'csv export streaming orders openspec v2');
    await seed(pool, { stable_id: 'speckit.guide', kind: 'framework_pack', memory_type: null, framework: 'spec-kit', pack_name: 'spec-kit', pack_version: '1.0.0', title: 'speckit csv' }, 'csv export streaming orders speckit');
    await seed(pool, { stable_id: 'company.plan-only', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', phase_tags: ['plan'], title: 'plan only' }, 'csv export streaming orders plan');

    const base: RetrievalFilter = { scope: { appIds: [checkout.id] }, framework: 'openspec', frameworkPackVersion: '1.0.0', phase: 'specify', kinds: ['app_memory', 'standard', 'framework_pack'] };
    const hits = await withTransaction(pool, (c) => vectorSearch(c, fakeEmbed(q), base, { candidates: 12, minSimilarity: 0.1 }));
    const ids = hits.map((h) => `${h.stable_id}@${h.version}`);
    expect(ids).toContain('checkout.adr.0001@1');
    expect(ids).toContain('company.rule@1');
    expect(ids).toContain('openspec.guide@1');          // pinned version, not 1.1.0
    expect(ids).not.toContain('openspec.guide@2');
    expect(ids).not.toContain('billing.adr.0001@1');    // other app
    expect(ids).not.toContain('company.rule.old@1');    // superseded
    expect(ids).not.toContain('speckit.guide@1');       // other framework
    expect(ids).not.toContain('company.plan-only@1');   // phase tag mismatch

    const company = await vectorSearch(pool, fakeEmbed(q), { ...base, scope: 'company' }, { candidates: 12, minSimilarity: 0.1 });
    expect(company.map((h) => h.stable_id)).not.toContain('checkout.adr.0001');

    const both = await vectorSearch(pool, fakeEmbed(q), { ...base, scope: { appIds: [checkout.id, billing.id] } }, { candidates: 12, minSimilarity: 0.1 });
    expect(both.map((h) => h.stable_id)).toContain('billing.adr.0001');

    const exact = await exactIdSearch(pool, ['ADR-1'], base);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ stable_id: 'checkout.adr.0001', match: 'exact_id', score: 1 });

    const strict = await vectorSearch(pool, fakeEmbed('zzz qqq'), base, { candidates: 12, minSimilarity: 0.9 });
    expect(strict).toEqual([]);
  });

  it('keeps a pinned framework_pack version visible after deprecation, while other kinds still respect status = active', async () => {
    const pool = await getTestPool();
    const q = 'csv export streaming orders';
    await seed(pool, { stable_id: 'openspec.pinned', kind: 'framework_pack', memory_type: null, framework: 'openspec', pack_name: 'openspec', pack_version: '1.0.0', title: 'openspec pinned' }, 'csv export streaming orders openspec pinned');
    await seed(pool, { stable_id: 'company.deprecated-rule', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'deprecated rule' }, 'csv export streaming orders deprecated');

    // Deprecating does not set superseded_by (no successor); status flips to 'deprecated'.
    await deprecateItem(pool, 'openspec.pinned', null, 'framework version deprecated, pinned features continue', 'cli');
    await deprecateItem(pool, 'company.deprecated-rule', null, 'rule deprecated', 'cli');

    // A feature pinned to the exact deprecated framework_pack version must still see it.
    const pinnedFilter: RetrievalFilter = { scope: 'company', framework: 'openspec', frameworkPackVersion: '1.0.0', phase: null, kinds: ['framework_pack'] };
    const pinnedHits = await vectorSearch(pool, fakeEmbed(q), pinnedFilter, { candidates: 12, minSimilarity: 0.1 });
    expect(pinnedHits.map((h) => h.stable_id)).toContain('openspec.pinned');

    // A non-framework_pack item that is deprecated must still be excluded by the normal active/non-superseded rule.
    const standardFilter: RetrievalFilter = { scope: 'company', framework: null, frameworkPackVersion: null, phase: null, kinds: ['standard'] };
    const standardHits = await vectorSearch(pool, fakeEmbed(q), standardFilter, { candidates: 12, minSimilarity: 0.1 });
    expect(standardHits.map((h) => h.stable_id)).not.toContain('company.deprecated-rule');
  });

  it('exactIdSearch matches ids on word boundaries, not as substrings', async () => {
    const pool = await getTestPool();
    await seed(pool, { stable_id: 'adr.1', title: 'ADR-1 streaming exports' }, 'streaming export design');
    await seed(pool, { stable_id: 'adr.10', title: 'ADR-10 unrelated topic' }, 'unrelated topic body');
    await seed(pool, { stable_id: 'adr.other', title: 'some other decision' }, 'this text merely mentions ADR-100 in passing');

    const base: RetrievalFilter = { scope: 'company', framework: null, frameworkPackVersion: null, phase: null, kinds: ['app_memory'] };
    const hits = await exactIdSearch(pool, ['ADR-1'], base);
    expect(hits.map((h) => h.stable_id)).toEqual(['adr.1']);
  });

  it('vectorSearch throws a clear error for a wrong-dimension query embedding rather than hitting the database', async () => {
    const pool = await getTestPool();
    const base: RetrievalFilter = { scope: 'company', framework: null, frameworkPackVersion: null, phase: null, kinds: ['app_memory'] };
    await expect(vectorSearch(pool, [0.1, 0.2, 0.3], base, { candidates: 12, minSimilarity: 0.1 })).rejects.toThrow(/dimension 3, expected 1024/);
  });
});
