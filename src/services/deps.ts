import type pg from 'pg';
import type { AuthMode } from '../auth/context.js';
import type { EmbeddingProvider } from '../embedding/provider.js';

export interface MetricsHooks {
  routed(rule: string): void;
  gate(check: string, result: 'pass' | 'fail'): void;
  degradedPack(): void;
  overBudgetPack(): void;
  failedCycle(): void;
  authRejected(reason: 'missing' | 'invalid' | 'would_reject'): void;
  approval(event: 'requested' | 'approved' | 'rejected', waitSeconds?: number): void;
}

export interface ServiceDeps {
  pool: pg.Pool;
  embedder: EmbeddingProvider | null;
  tokenBudget: number;
  metrics?: MetricsHooks;
  // Unset means 'off' (v1 behaviour); the server sets it from SDD_AUTH_MODE.
  authMode?: AuthMode;
}
