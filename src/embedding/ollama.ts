import { assertCount, assertDimension, EMBEDDING_REQUEST_TIMEOUT_MS, rethrowAsTimeout, type EmbeddingProvider, type InputType } from './provider.js';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'ollama' as const;
  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = EMBEDDING_REQUEST_TIMEOUT_MS,
  ) {}

  async embed(texts: string[], _inputType: InputType): Promise<number[][]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      rethrowAsTimeout(e, 'ollama embed', this.timeoutMs);
    }
    if (!res.ok) throw new Error(`ollama embed request failed with status ${res.status}`);
    const json = (await res.json()) as { embeddings: number[][] };
    assertDimension(json.embeddings, 'ollama');
    assertCount(json.embeddings, texts.length, 'ollama');
    return json.embeddings;
  }

  async healthy(): Promise<boolean> {
    try { await this.embed(['ping'], 'query'); return true; } catch { return false; }
  }
}
