export type InputType = 'document' | 'query';
export const EMBEDDING_DIMENSION = 1024;

export interface EmbeddingProvider {
  readonly provider: 'voyage' | 'ollama' | 'fake';
  readonly model: string;
  embed(texts: string[], inputType: InputType): Promise<number[][]>;
  healthy(): Promise<boolean>;
}

export function assertDimension(vectors: number[][], provider: string): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSION) throw new Error(`${provider} returned an embedding of dimension ${v.length}, expected ${EMBEDDING_DIMENSION}`);
  }
}
