#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createEmbeddingProvider } from './embedding/index.js';
import { createLogger } from './logging.js';
import { runStdio } from './mcp/stdio.js';
import type { McpDeps } from './mcp/server.js';

export async function buildDeps(): Promise<McpDeps> {
  const config = loadConfig(process.env);
  const logger = createLogger();
  await runMigrations(config.databaseUrl, (m) => logger.debug(m));
  const pool = createPool(config.databaseUrl);
  const embedder = createEmbeddingProvider(config.embedding);
  return { pool, embedder, tokenBudget: config.tokenBudget, logger };
}

async function main(): Promise<void> {
  const deps = await buildDeps();
  if (process.argv.includes('--stdio')) { await runStdio(deps); return; }
  const { runHttp } = await import('./mcp/http.js');
  await runHttp(deps, loadConfig(process.env));
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
