import { assertDimension, EMBEDDING_DIMENSION, type EmbeddingProvider, type InputType } from './provider.js';

const BATCH = 128;
const SUPPORTS_OUTPUT_DIMENSION = new Set(['voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3']);

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'voyage' as const;
  constructor(readonly model: string, private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async embed(texts: string[], inputType: InputType): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH);
      const body: Record<string, unknown> = { input, model: this.model, input_type: inputType };
      if (SUPPORTS_OUTPUT_DIMENSION.has(this.model)) body.output_dimension = EMBEDDING_DIMENSION;
      const res = await this.fetchImpl('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`voyage embeddings request failed with status ${res.status}`);
      const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      const sorted = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      assertDimension(sorted, 'voyage');
      out.push(...sorted);
    }
    return out;
  }

  async healthy(): Promise<boolean> {
    try { await this.embed(['ping'], 'query'); return true; } catch { return false; }
  }
}
