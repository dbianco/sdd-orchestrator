import type { Queryable } from '../db/pool.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { exactIdSearch, mergeAndRank, vectorSearch, type RetrievalFilter, type RetrievedChunk } from '../store/retrieval.js';

export const RETRIEVAL_CANDIDATES = 12;
export const DEFAULT_MIN_SIMILARITY = 0.35;
export const RETRIEVAL_LIMIT = 8;

export interface RetrieveDeps { q: Queryable; embedder: EmbeddingProvider | null }
export interface RetrieveInput { query: string; ids: string[]; filter: RetrievalFilter; minSimilarity: number; limit?: number }
export interface RetrieveResult { chunks: RetrievedChunk[]; degraded: boolean }

export async function retrieve(deps: RetrieveDeps, input: RetrieveInput): Promise<RetrieveResult> {
  const exact = await exactIdSearch(deps.q, input.ids, input.filter);
  let vector: RetrievedChunk[] = [];
  let degraded = false;
  if (deps.embedder && input.query.trim().length > 0) {
    try {
      const [embedding] = await deps.embedder.embed([input.query], 'query');
      vector = await vectorSearch(deps.q, embedding!, input.filter, { candidates: RETRIEVAL_CANDIDATES, minSimilarity: input.minSimilarity });
    } catch {
      degraded = true;
    }
  } else {
    degraded = true;
  }
  return { chunks: mergeAndRank(exact, vector, input.limit ?? RETRIEVAL_LIMIT), degraded };
}
