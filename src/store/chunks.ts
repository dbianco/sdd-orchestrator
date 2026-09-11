import pgvector from 'pgvector/pg';
import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';

export interface NewChunk {
  ordinal: number; heading_path: string; text: string; embedding: number[]; embedding_model: string; token_count: number; tokenizer: string;
}

export async function insertChunks(q: Queryable, itemId: string, chunks: NewChunk[], actor: string): Promise<void> {
  for (const c of chunks) {
    await q.query(
      `INSERT INTO knowledge_chunks (id, item_id, ordinal, heading_path, text, embedding, embedding_model, token_count, tokenizer, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newId('c'), itemId, c.ordinal, c.heading_path, c.text, pgvector.toSql(c.embedding), c.embedding_model, c.token_count, c.tokenizer, actor],
    );
  }
}

export async function listChunkTexts(q: Queryable): Promise<{ id: string; item_id: string; heading_path: string; text: string; title: string }[]> {
  const r = await q.query<{ id: string; item_id: string; heading_path: string; text: string; title: string }>(
    `SELECT c.id, c.item_id, c.heading_path, c.text, i.title FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id ORDER BY c.item_id, c.ordinal`,
  );
  return r.rows;
}

export async function updateChunkEmbedding(q: Queryable, chunkId: string, embedding: number[], model: string): Promise<void> {
  await q.query('UPDATE knowledge_chunks SET embedding = $2, embedding_model = $3, updated_at = now() WHERE id = $1', [chunkId, pgvector.toSql(embedding), model]);
}
