import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { loadPack, type LoadedPack } from '../../src/ingest/load.js';
import { ingestPack } from '../../src/ingest/ingest.js';
import { FakeEmbeddingProvider } from '../../src/embedding/fake.js';
import { createApp, updateApp, addStopCondition } from '../../src/store/apps.js';

const fixtures = fileURLToPath(new URL('../fixtures/packs/', import.meta.url));
export const embedder = new FakeEmbeddingProvider();

function syntheticPack(name: string, kind: 'standard' | 'stack_guide', items: { id: string; title: string; body: string; stack_tags?: string[] }[]): LoadedPack {
  return {
    dir: name,
    manifest: { name, kind, framework: null, version: '1.0.0', source_url: null, license: 'MIT', app: null },
    items: items.map((i) => ({
      frontMatter: { id: i.id, tier: 'retrieved', phases: [], stack_tags: i.stack_tags ?? [], title: i.title },
      body: i.body, sourcePath: `${i.id}.md`, sourceHash: `hash-${i.id}`,
    })),
  };
}

export async function seedAll(pool: pg.Pool): Promise<{ appId: string }> {
  const app = await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'seed');
  await updateApp(pool, 'checkout', { token_budget: 6000 }, 'seed');
  await addStopCondition(pool, 'checkout', 'Never change tax rounding', 'seed');
  const deps = { pool, embedder };
  await ingestPack(deps, await loadPack(`${fixtures}mini-framework`), 'seed');
  await ingestPack(deps, await loadPack(`${fixtures}mini-company`), 'seed');
  await ingestPack(deps, syntheticPack('quality-layer', 'standard', [{ id: 'quality.tdd', title: 'Test-driven development', body: 'Write the failing test first. Exports and orders included.' }]), 'seed');
  await ingestPack(deps, syntheticPack('stack-guides/react', 'stack_guide', [{ id: 'react.hooks', title: 'Hooks', body: 'Keep effects small. csv export orders hooks.', stack_tags: ['react'] }]), 'seed');
  return { appId: app.id };
}
