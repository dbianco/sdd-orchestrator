import type pg from 'pg';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../src/ingest/load.js';
import { ingestPack } from '../../src/ingest/ingest.js';
import { FakeEmbeddingProvider } from '../../src/embedding/fake.js';
import { createApp } from '../../src/store/apps.js';

const root = fileURLToPath(new URL('../../packs/', import.meta.url));
export const packsEmbedder = new FakeEmbeddingProvider();

async function packDirs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if (!(await stat(full)).isDirectory()) continue;
    try { await stat(join(full, 'pack.yaml')); out.push(full); } catch { out.push(...(await packDirs(full))); }
  }
  return out.sort();
}

export async function seedPacks(pool: pg.Pool): Promise<void> {
  await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'seed');
  for (const dir of await packDirs(root)) await ingestPack({ pool, embedder: packsEmbedder }, await loadPack(dir), 'seed');
}
