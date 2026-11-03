#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createEmbeddingProvider } from './embedding/index.js';
import { createLogger } from './logging.js';
import { createMetrics } from './metrics.js';
import { createNotifier } from './notify.js';
import { runStdio } from './mcp/stdio.js';
import type { HttpDeps } from './mcp/http.js';

export async function buildDeps(): Promise<HttpDeps> {
  const config = loadConfig(process.env);
  const logger = createLogger();
  await runMigrations(config.databaseUrl, (m) => logger.debug(m));
  const pool = createPool(config.databaseUrl);
  const embedder = createEmbeddingProvider(config.embedding);
  const { registry, hooks } = createMetrics();
  return { pool, embedder, tokenBudget: config.tokenBudget, logger, metrics: hooks, registry, authMode: config.authMode, notifier: createNotifier({ webhookUrl: config.notifyWebhookUrl ?? null, publicUrl: config.publicUrl ?? null, logger }) };
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const deps = await buildDeps();
  if (argv.includes('--stdio')) { await runStdio(deps); return; }
  const { runHttp } = await import('./mcp/http.js');
  await runHttp(deps, loadConfig(process.env));
}

// Start only when executed (node dist/index.js, or through the sdd-orchestrator bin symlink), not when imported by tests.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
}
