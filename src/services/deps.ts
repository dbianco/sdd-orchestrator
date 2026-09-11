import type pg from 'pg';
import type { EmbeddingProvider } from '../embedding/provider.js';

export interface MetricsHooks {
  routed(rule: string): void;
  gate(check: string, result: 'pass' | 'fail'): void;
  degradedPack(): void;
  overBudgetPack(): void;
  failedCycle(): void;
}

export interface ServiceDeps {
  pool: pg.Pool;
  embedder: EmbeddingProvider | null;
  tokenBudget: number;
  metrics?: MetricsHooks;
}
