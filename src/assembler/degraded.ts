import type { EmbeddingProvider } from '../embedding/provider.js';

// Why retrieval fell back to exact-id matches. Each variant produces a message that names the cause and the fix.
export type DegradedReason =
  | { kind: 'not_configured' }
  | { kind: 'failed'; provider: string; model: string; message: string }
  | { kind: 'no_query' };

export function failedReason(embedder: EmbeddingProvider, e: unknown): DegradedReason {
  return { kind: 'failed', provider: embedder.provider, model: embedder.model, message: e instanceof Error ? e.message : String(e) };
}

const RANK: Record<DegradedReason['kind'], number> = { failed: 3, not_configured: 2, no_query: 1 };

/** The most actionable reason among several retrievals (a runtime failure beats configuration beats an empty query). */
export function worstReason(...reasons: (DegradedReason | null)[]): DegradedReason | null {
  return reasons.reduce<DegradedReason | null>((best, r) => (r && (!best || RANK[r.kind] > RANK[best.kind]) ? r : best), null);
}

export function describeDegraded(reason: DegradedReason | null, effect: string): string {
  switch (reason?.kind) {
    case 'not_configured':
      return `retrieval is off by configuration: no embedding provider is set up on the server (set SDD_EMBEDDING_PROVIDER to voyage or ollama and restart; "sdd-admin doctor" checks it). ${effect}`;
    case 'failed':
      return `retrieval degraded at runtime: embedding provider "${reason.provider}" (model ${reason.model}) failed: ${reason.message}. Check its credentials, URL and network (SDD_EMBEDDING_PROVIDER, VOYAGE_API_KEY or OLLAMA_URL); "sdd-admin doctor" tests it. ${effect}`;
    case 'no_query':
      return `retrieval skipped: there was no task or focus text to search for. ${effect}`;
    default:
      return `retrieval degraded: embedding provider unavailable ("sdd-admin doctor" shows why). ${effect}`;
  }
}
