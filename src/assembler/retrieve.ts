import type { Queryable } from '../db/pool.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { failedReason, type DegradedReason } from './degraded.js';
import type { Phase } from '../domain/types.js';
import { exactIdSearch, mergeAndRank, vectorSearch, type RetrievalFilter, type RetrievedChunk } from '../store/retrieval.js';

export const RETRIEVAL_CANDIDATES = 12;
export const DEFAULT_MIN_SIMILARITY = 0.35;
export const RETRIEVAL_LIMIT = 8;

// Position 4 of a context pack: app memory, retrieved standards and the pinned framework's non-template items.
export function knowledgeFilter(f: { scope: RetrievalFilter['scope']; framework: string; frameworkPackVersion: string; phase: Phase; excludeItemIds?: string[] }): RetrievalFilter {
  return {
    scope: f.scope, framework: f.framework, frameworkPackVersion: f.frameworkPackVersion, phase: f.phase,
    kinds: ['app_memory', 'standard', 'framework_pack'], tier: null, excludeItemIds: f.excludeItemIds ?? [],
  };
}

export interface RetrieveDeps { q: Queryable; embedder: EmbeddingProvider | null }
export interface RetrieveInput { query: string; ids: string[]; filter: RetrievalFilter; minSimilarity: number; limit?: number }
export interface RetrieveResult { chunks: RetrievedChunk[]; degraded: boolean; reason: DegradedReason | null }

export async function retrieve(deps: RetrieveDeps, input: RetrieveInput): Promise<RetrieveResult> {
  const exact = await exactIdSearch(deps.q, input.ids, input.filter);
  let vector: RetrievedChunk[] = [];
  let reason: DegradedReason | null = null;
  if (deps.embedder && input.query.trim().length > 0) {
    try {
      const [embedding] = await deps.embedder.embed([input.query], 'query');
      vector = await vectorSearch(deps.q, embedding!, input.filter, { candidates: RETRIEVAL_CANDIDATES, minSimilarity: input.minSimilarity });
    } catch (e) {
      reason = failedReason(deps.embedder, e);
    }
  } else {
    reason = deps.embedder ? { kind: 'no_query' } : { kind: 'not_configured' };
  }
  return { chunks: mergeAndRank(exact, vector, input.limit ?? RETRIEVAL_LIMIT), degraded: reason !== null, reason };
}
