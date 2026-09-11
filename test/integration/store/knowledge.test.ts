import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp } from '../../../src/store/apps.js';
import { insertItemVersion, currentItem, itemVersion, deprecateItem, listAlwaysOn, listStackGuidePacks, nextProposalSequence, type NewKnowledgeItem } from '../../../src/store/knowledge.js';
import { insertChunks, listChunkTexts } from '../../../src/store/chunks.js';

const url = process.env.SDD_TEST_DATABASE_URL;

export function item(over: Partial<NewKnowledgeItem>): NewKnowledgeItem {
  return {
    stable_id: 'company.constitution', kind: 'standard', tier: 'always_on', framework: null, app_id: null, memory_type: null,
    human_id: null, stack_tags: [], phase_tags: [], title: 'Constitution', body: '- Rule (reason)', front_matter: {},
    pack_name: 'company', pack_version: '1.0.0', source_path: 'constitution.md', source_hash: 'h1', source_url: null, license: 'MIT', ...over,
  };
}

describe.skipIf(!url)('knowledge items', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('versions items and supersedes the previous current version', async () => {
    const pool = await getTestPool();
    const v1 = await insertItemVersion(pool, item({}), 'cli');
    expect(v1.version).toBe(1);
    const v2 = await insertItemVersion(pool, item({ body: 'changed', source_hash: 'h2' }), 'cli');
    expect(v2.version).toBe(2);
    expect((await itemVersion(pool, 'company.constitution', 1))?.superseded_by).toBe(v2.id);
    expect((await currentItem(pool, 'company.constitution'))?.id).toBe(v2.id);
  });

  it('deprecates an item out of current but keeps it resolvable', async () => {
    const pool = await getTestPool();
    const v1 = await insertItemVersion(pool, item({}), 'cli');
    const d = await deprecateItem(pool, 'company.constitution', null, 'obsolete', 'cli');
    expect(d.id).toBe(v1.id);
    expect(d.status).toBe('deprecated');
    expect(await currentItem(pool, 'company.constitution')).toBeNull();
    expect((await itemVersion(pool, 'company.constitution', 1))?.deprecation_reason).toBe('obsolete');
  });

  it('lists always-on standards company first then app', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    await insertItemVersion(pool, item({ stable_id: 'checkout.steering', app_id: app.id, pack_name: 'checkout-steering' }), 'cli');
    await insertItemVersion(pool, item({}), 'cli');
    const rows = await listAlwaysOn(pool, app.id);
    expect(rows.map((r) => r.stable_id)).toEqual(['company.constitution', 'checkout.steering']);
    expect((await listAlwaysOn(pool, null)).map((r) => r.stable_id)).toEqual(['company.constitution']);
  });

  it('lists stack guide packs with their union of tags', async () => {
    const pool = await getTestPool();
    await insertItemVersion(pool, item({ stable_id: 'react.hooks', kind: 'stack_guide', tier: 'retrieved', pack_name: 'stack-guides/react', stack_tags: ['react'] }), 'cli');
    await insertItemVersion(pool, item({ stable_id: 'react.state', kind: 'stack_guide', tier: 'retrieved', pack_name: 'stack-guides/react', stack_tags: ['react', 'typescript'] }), 'cli');
    expect(await listStackGuidePacks(pool)).toEqual([{ pack_name: 'stack-guides/react', pack_version: '1.0.0', stack_tags: ['react', 'typescript'] }]);
  });

  it('computes the next proposal sequence per app and memory type', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    expect(await nextProposalSequence(pool, 'checkout', 'adr')).toBe(1);
    await insertItemVersion(pool, item({ stable_id: 'checkout.adr.0007', kind: 'app_memory', tier: 'retrieved', memory_type: 'adr', app_id: app.id, pack_name: 'proposals', pack_version: null }), 'cli');
    expect(await nextProposalSequence(pool, 'checkout', 'adr')).toBe(8);
  });
});

describe.skipIf(!url)('chunks', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('inserts and lists chunk texts with the item title', async () => {
    const pool = await getTestPool();
    const it1 = await insertItemVersion(pool, item({}), 'cli');
    const vec = new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    await insertChunks(pool, it1.id, [{ ordinal: 0, heading_path: 'Constitution', text: 'body', embedding: vec, embedding_model: 'fake-1024', token_count: 1, tokenizer: 'cl100k_base' }], 'cli');
    const rows = await listChunkTexts(pool);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_id: it1.id, title: 'Constitution', text: 'body' });
  });
});
