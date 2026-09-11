import type { Queryable } from '../db/pool.js';
import type { EmbeddingConfigRow } from './rows.js';

export async function getEmbeddingConfig(q: Queryable): Promise<EmbeddingConfigRow | null> {
  const r = await q.query<EmbeddingConfigRow>(`SELECT * FROM embedding_config WHERE id = 'singleton'`);
  return r.rows[0] ?? null;
}

export async function setEmbeddingConfig(
  q: Queryable,
  cfg: { provider: string; model: string; dimension: number; reindexed?: boolean },
  actor: string,
): Promise<EmbeddingConfigRow> {
  const r = await q.query<EmbeddingConfigRow>(
    `INSERT INTO embedding_config (id, provider, model, dimension, reindexed_at, created_by)
     VALUES ('singleton', $1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END, $5)
     ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model, dimension = EXCLUDED.dimension,
       reindexed_at = CASE WHEN $4 THEN now() ELSE embedding_config.reindexed_at END, updated_at = now()
     RETURNING *`,
    [cfg.provider, cfg.model, cfg.dimension, cfg.reindexed ?? false, actor],
  );
  return r.rows[0]!;
}
