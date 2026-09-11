import { withTransaction } from '../db/pool.js';
import { EMBEDDING_DIMENSION } from '../embedding/provider.js';
import { listChunkTexts, updateChunkEmbedding } from '../store/chunks.js';
import { setEmbeddingConfig } from '../store/embeddingConfig.js';
import { embedText } from './chunk.js';
import type { IngestDeps } from './ingest.js';

const BATCH = 64;

export async function reindexAll(deps: IngestDeps, actor: string): Promise<{ chunks: number }> {
  const rows = await listChunkTexts(deps.pool);
  const vectors: number[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => embedText(r.title, r));
    vectors.push(...(await deps.embedder.embed(batch, 'document')));
  }
  await withTransaction(deps.pool, async (tx) => {
    for (let i = 0; i < rows.length; i++) await updateChunkEmbedding(tx, rows[i]!.id, vectors[i]!, deps.embedder.model);
    await setEmbeddingConfig(tx, { provider: deps.embedder.provider, model: deps.embedder.model, dimension: EMBEDDING_DIMENSION, reindexed: true }, actor);
  });
  return { chunks: rows.length };
}
