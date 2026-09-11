import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { DomainError } from '../errors.js';
import { getEmbeddingConfig } from '../store/embeddingConfig.js';
import { FakeEmbeddingProvider } from './fake.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import type { EmbeddingProvider } from './provider.js';
import { VoyageEmbeddingProvider } from './voyage.js';

export function createEmbeddingProvider(cfg: Config['embedding'], fetchImpl: typeof fetch = fetch): EmbeddingProvider {
  switch (cfg.provider) {
    case 'fake': return new FakeEmbeddingProvider();
    case 'ollama': return new OllamaEmbeddingProvider(cfg.model, cfg.ollamaUrl, fetchImpl);
    case 'voyage': return new VoyageEmbeddingProvider(cfg.model, cfg.voyageApiKey ?? '', fetchImpl);
  }
}

export async function assertEmbeddingConfigMatches(q: Queryable, provider: EmbeddingProvider): Promise<void> {
  const stored = await getEmbeddingConfig(q);
  if (!stored) return;
  if (stored.provider !== provider.provider || stored.model !== provider.model) {
    throw new DomainError(
      'EMBEDDING_MODEL_MISMATCH',
      `configured embedding ${provider.provider}/${provider.model} differs from the indexed ${stored.provider}/${stored.model}; run "sdd-admin reindex"`,
      { configured: { provider: provider.provider, model: provider.model }, indexed: { provider: stored.provider, model: stored.model } },
    );
  }
}

export type { EmbeddingProvider } from './provider.js';
