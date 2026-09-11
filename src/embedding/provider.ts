export type InputType = 'document' | 'query';
export const EMBEDDING_DIMENSION = 1024;

// Context assembly embeds the query while holding a pooled database connection and an open
// transaction, so an outbound embedding request that never answers holds a connection forever
// (docs/operations.md). Every remote provider bounds its request with this timeout; retrieval
// treats the resulting failure as "degraded" and releases the connection.
export const EMBEDDING_REQUEST_TIMEOUT_MS = 30_000;

export interface EmbeddingProvider {
  readonly provider: 'voyage' | 'ollama' | 'fake';
  readonly model: string;
  embed(texts: string[], inputType: InputType): Promise<number[][]>;
  healthy(): Promise<boolean>;
}

// AbortSignal.timeout rejects fetch with a TimeoutError DOMException whose message names no
// provider; restate it so an operator reading a degraded-retrieval log knows which endpoint stalled.
export function rethrowAsTimeout(e: unknown, label: string, timeoutMs: number): never {
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    throw new Error(`${label} request timed out after ${timeoutMs}ms`);
  }
  throw e;
}

export function assertDimension(vectors: number[][], provider: string): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSION) throw new Error(`${provider} returned an embedding of dimension ${v.length}, expected ${EMBEDDING_DIMENSION}`);
  }
}

export function assertCount(vectors: number[][], expected: number, provider: string): void {
  if (vectors.length !== expected) throw new Error(`${provider} returned ${vectors.length} embeddings, expected ${expected}`);
}
