import pgvector from 'pgvector/pg';
import type { Queryable } from '../db/pool.js';
import type { KnowledgeKind, MemoryType, Phase, Tier } from '../domain/types.js';

export interface RetrievalFilter {
  scope: 'company' | { appIds: string[] };
  framework: string | null;
  frameworkPackVersion: string | null;
  phase: Phase | null;
  kinds: KnowledgeKind[];
  tier?: Tier | null;
  packNames?: string[] | null;
  excludeItemIds?: string[];
}

export interface RetrievedChunk {
  chunk_id: string; item_id: string; stable_id: string; version: number; app_id: string | null; kind: KnowledgeKind; memory_type: MemoryType | null;
  heading_path: string; text: string; token_count: number; score: number; match: 'vector' | 'exact_id';
}

const SELECT = `SELECT c.id AS chunk_id, c.item_id, i.stable_id, i.version, i.app_id, i.kind, i.memory_type, c.heading_path, c.text, c.token_count`;

function filterSql(f: RetrievalFilter, params: unknown[]): string {
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const clauses = [
    `i.status = 'active'`,
    `((i.kind <> 'framework_pack' AND i.superseded_by IS NULL) OR (i.kind = 'framework_pack' AND ` +
      (f.framework ? `i.pack_name = ${p(f.framework)} AND i.pack_version = ${p(f.frameworkPackVersion)}` : `i.superseded_by IS NULL`) + `))`,
    f.scope === 'company' ? `i.app_id IS NULL` : `(i.app_id IS NULL OR i.app_id = ANY(${p(f.scope.appIds)}))`,
    f.framework ? `(i.framework IS NULL OR i.framework = ${p(f.framework)})` : null,
    f.phase ? `(cardinality(i.phase_tags) = 0 OR ${p(f.phase)} = ANY(i.phase_tags))` : null,
    `i.kind = ANY(${p(f.kinds)})`,
    f.tier ? `i.tier = ${p(f.tier)}` : null,
    f.packNames ? `i.pack_name = ANY(${p(f.packNames)})` : null,
    f.excludeItemIds && f.excludeItemIds.length > 0 ? `NOT (i.id = ANY(${p(f.excludeItemIds)}))` : null,
  ];
  return clauses.filter((c): c is string => c !== null).join(' AND ');
}

export async function vectorSearch(
  q: Queryable, embedding: number[], filter: RetrievalFilter, opts: { candidates: number; minSimilarity: number },
): Promise<RetrievedChunk[]> {
  await q.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`).catch(() => undefined);
  const params: unknown[] = [pgvector.toSql(embedding)];
  const where = filterSql(filter, params);
  params.push(opts.candidates);
  const r = await q.query<RetrievedChunk & { score: number }>(
    `${SELECT}, 1 - (c.embedding <=> $1) AS score
     FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id
     WHERE ${where}
     ORDER BY c.embedding <=> $1
     LIMIT $${params.length}`,
    params,
  );
  return r.rows.filter((row) => row.score >= opts.minSimilarity).map((row) => ({ ...row, score: Number(row.score), match: 'vector' as const }));
}

export async function exactIdSearch(q: Queryable, ids: string[], filter: RetrievalFilter): Promise<RetrievedChunk[]> {
  if (ids.length === 0) return [];
  const params: unknown[] = [ids];
  const where = filterSql(filter, params);
  const r = await q.query<RetrievedChunk>(
    `${SELECT}
     FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id
     WHERE ${where} AND (
       i.human_id = ANY($1) OR i.stable_id = ANY($1)
       OR EXISTS (SELECT 1 FROM unnest($1::text[]) AS id WHERE i.title ILIKE '%' || id || '%' OR c.text ILIKE '%' || id || '%')
     )
     ORDER BY i.stable_id, c.ordinal`,
    params,
  );
  return r.rows.map((row) => ({ ...row, score: 1, match: 'exact_id' as const }));
}

export function mergeAndRank(exact: RetrievedChunk[], vector: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();
  for (const c of [...exact, ...vector]) {
    const cur = best.get(c.item_id);
    if (!cur || (cur.match === c.match && c.score > cur.score)) best.set(c.item_id, c);
  }
  return [...best.values()]
    .sort((a, b) => (a.match === b.match ? b.score - a.score : a.match === 'exact_id' ? -1 : 1))
    .slice(0, limit);
}
