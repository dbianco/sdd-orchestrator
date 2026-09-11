import { extractExactIds } from '../assembler/exactIds.js';
import { resolveScope } from '../assembler/layers.js';
import { DEFAULT_MIN_SIMILARITY, retrieve } from '../assembler/retrieve.js';
import type { KnowledgeKind, MemoryType, Scope } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { requireApp } from '../store/apps.js';
import type { ServiceDeps } from './deps.js';

export interface SearchMemoryInput { query: string; app: string; scope?: Scope; kinds?: KnowledgeKind[]; limit?: number }
export interface SearchChunk {
  item_id: string; stable_id: string; version: number; app: string | null; kind: KnowledgeKind; memory_type: MemoryType | null;
  heading_path: string; text: string; score: number; match: 'vector' | 'exact_id';
}

export async function searchMemory(deps: ServiceDeps, input: SearchMemoryInput): Promise<{ chunks: SearchChunk[]; degraded: boolean; warnings: string[] }> {
  const q = deps.pool;
  const app = await requireApp(q, input.app);
  if (deps.embedder) await assertEmbeddingConfigMatches(q, deps.embedder);
  const scope = await resolveScope(q, input.scope ?? 'app', app);
  const { chunks, degraded } = await retrieve({ q, embedder: deps.embedder }, {
    query: input.query, ids: extractExactIds(input.query), minSimilarity: app.min_similarity ?? DEFAULT_MIN_SIMILARITY, limit: input.limit ?? 8,
    filter: { scope, framework: null, frameworkPackVersion: null, phase: null, kinds: input.kinds ?? ['framework_pack', 'standard', 'stack_guide', 'app_memory'] },
  });
  const appIds = [...new Set(chunks.map((c) => c.app_id).filter((x): x is string => x !== null))];
  const slugs = appIds.length > 0 ? new Map((await q.query<{ id: string; slug: string }>('SELECT id, slug FROM apps WHERE id = ANY($1)', [appIds])).rows.map((r) => [r.id, r.slug])) : new Map<string, string>();
  return {
    chunks: chunks.map((c) => ({ item_id: c.item_id, stable_id: c.stable_id, version: c.version, app: c.app_id ? slugs.get(c.app_id) ?? null : null, kind: c.kind, memory_type: c.memory_type, heading_path: c.heading_path, text: c.text, score: c.score, match: c.match })),
    degraded,
    warnings: degraded ? ['retrieval degraded: embedding provider unavailable, exact-id matches only'] : [],
  };
}
