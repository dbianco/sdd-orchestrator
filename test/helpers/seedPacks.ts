import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { loadPack, packDirs } from '../../src/ingest/load.js';
import { ingestPack } from '../../src/ingest/ingest.js';
import { FakeEmbeddingProvider } from '../../src/embedding/fake.js';
import { createApp } from '../../src/store/apps.js';

const root = fileURLToPath(new URL('../../packs/', import.meta.url));
export const packsEmbedder = new FakeEmbeddingProvider();

export async function seedPacks(pool: pg.Pool): Promise<void> {
  await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'seed');
  for (const dir of await packDirs(root)) await ingestPack({ pool, embedder: packsEmbedder }, await loadPack(dir), 'seed');
}
