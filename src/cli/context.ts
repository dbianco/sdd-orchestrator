import { loadConfig, type Config } from '../config.js';
import { createPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding/index.js';
import type pg from 'pg';

export interface CliContext { pool: pg.Pool; embedder: EmbeddingProvider | null; config: Config; close(): Promise<void> }

export async function openCli(opts: { needEmbedder: boolean }): Promise<CliContext> {
  const env = { ...process.env };
  if (!opts.needEmbedder && !env.VOYAGE_API_KEY && (env.SDD_EMBEDDING_PROVIDER ?? 'voyage') === 'voyage') env.SDD_EMBEDDING_PROVIDER = 'fake';
  const config = loadConfig(env);
  await runMigrations(config.databaseUrl);
  const pool = createPool(config.databaseUrl);
  const embedder = opts.needEmbedder ? createEmbeddingProvider(config.embedding) : null;
  return { pool, embedder, config, close: () => pool.end() };
}

export function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
