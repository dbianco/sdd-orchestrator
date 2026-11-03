import { readdir } from 'node:fs/promises';
import { Command } from 'commander';
import { loadConfig } from '../../config.js';
import { createPool } from '../../db/pool.js';
import { MIGRATIONS_DIR } from '../../db/migrate.js';
import { createEmbeddingProvider } from '../../embedding/index.js';
import { getEmbeddingConfig } from '../../store/embeddingConfig.js';

export interface Check { name: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} did not answer within ${ms / 1000}s`)), ms).unref())]);

/** Read-only health report for every dependency the server needs; never changes data. */
export async function collectDiagnostics(env: NodeJS.ProcessEnv): Promise<Check[]> {
  const checks: Check[] = [];
  let config;
  try {
    config = loadConfig(env);
    checks.push({ name: 'Configuration', status: 'ok', detail: `embedding ${config.embedding.provider}/${config.embedding.model}, auth mode ${config.authMode}` });
  } catch (e) {
    return [{ name: 'Configuration', status: 'fail', detail: msg(e), fix: 'Set the variable(s) named above; .env.example lists every setting.' }];
  }

  const pool = createPool(config.databaseUrl);
  try {
    try {
      await withTimeout(pool.query('SELECT 1'), 8000, 'the database');
      checks.push({ name: 'Database', status: 'ok', detail: 'reachable' });
    } catch (e) {
      checks.push({ name: 'Database', status: 'fail', detail: `cannot connect: ${msg(e)}`, fix: 'Check SDD_DATABASE_URL, that Postgres is running, and that this host can reach it.' });
      return checks;
    }

    const vec = (await pool.query<{ extversion: string }>(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`)).rows[0];
    if (!vec) checks.push({ name: 'pgvector', status: 'fail', detail: 'the vector extension is not installed', fix: 'Use a pgvector image (pgvector/pgvector:pg16) or run CREATE EXTENSION vector; the migrations need it.' });
    else {
      const [major = 0, minor = 0] = vec.extversion.split('.').map(Number);
      checks.push(major === 0 && minor < 8
        ? { name: 'pgvector', status: 'warn', detail: `version ${vec.extversion}`, fix: 'Retrieval queries use hnsw.iterative_scan, which needs pgvector 0.8 or newer; upgrade it or retrieval will fail at runtime.' }
        : { name: 'pgvector', status: 'ok', detail: `version ${vec.extversion}` });
    }

    try {
      const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM pgmigrations')).rows.map((r) => r.name));
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
      const pending = files.filter((f) => !applied.has(f));
      checks.push(pending.length === 0 ? { name: 'Migrations', status: 'ok', detail: `${files.length} applied` }
        : { name: 'Migrations', status: 'warn', detail: `${pending.length} pending`, fix: 'Start the server or run any sdd-admin command; both apply migrations.' });
    } catch {
      checks.push({ name: 'Migrations', status: 'warn', detail: 'the migration table does not exist yet', fix: 'Start the server or run any sdd-admin command to create the schema.' });
      return checks;
    }

    const e = config.embedding;
    if (e.provider === 'fake') {
      checks.push({ name: 'Embedding provider', status: 'warn', detail: 'placeholder (fake) embeddings', fix: 'Search and retrieved knowledge are not meaningful. Set SDD_EMBEDDING_PROVIDER=voyage (with VOYAGE_API_KEY) or ollama, then run "sdd-admin reindex".' });
    } else {
      const started = Date.now();
      try {
        const [vector] = await withTimeout(createEmbeddingProvider(e).embed(['sdd-admin doctor ping'], 'query'), 15000, `${e.provider}`);
        checks.push({ name: 'Embedding provider', status: 'ok', detail: `${e.provider}/${e.model} answered in ${Date.now() - started} ms (dimension ${vector?.length ?? '?'})` });
      } catch (err) {
        checks.push({
          name: 'Embedding provider', status: 'fail', detail: `${e.provider}/${e.model} failed: ${msg(err)}`,
          fix: e.provider === 'voyage' ? 'Check VOYAGE_API_KEY and outbound access to api.voyageai.com.' : `Check OLLAMA_URL (${e.ollamaUrl}) and that the model "${e.model}" is pulled.`,
        });
      }
    }

    const indexed = await getEmbeddingConfig(pool);
    if (indexed && (indexed.provider !== e.provider || indexed.model !== e.model)) {
      checks.push({ name: 'Index matches provider', status: 'fail', detail: `indexed with ${indexed.provider}/${indexed.model}, configured ${e.provider}/${e.model}`, fix: 'Run "sdd-admin reindex" so stored vectors match the configured model.' });
    } else checks.push({ name: 'Index matches provider', status: 'ok', detail: indexed ? `${indexed.provider}/${indexed.model}` : 'nothing indexed yet' });

    const counts = (await pool.query<{ apps: number; frameworks: number; items: number }>(
      `SELECT (SELECT count(*) FROM apps)::int AS apps, (SELECT count(*) FROM frameworks WHERE status = 'active')::int AS frameworks, (SELECT count(*) FROM knowledge_items WHERE status = 'active')::int AS items`)).rows[0]!;
    checks.push(counts.frameworks === 0 ? { name: 'Framework packs', status: 'warn', detail: 'none ingested', fix: 'Run "sdd-admin init" (or "sdd-admin ingest-all packs") so route_task has frameworks to choose from.' }
      : { name: 'Framework packs', status: 'ok', detail: `${counts.frameworks} framework(s), ${counts.items} knowledge item(s)` });
    checks.push(counts.apps === 0 ? { name: 'Apps', status: 'warn', detail: 'none registered', fix: 'Run "sdd-admin app register <slug> --name <name>".' } : { name: 'Apps', status: 'ok', detail: `${counts.apps} registered` });

    checks.push(config.authMode === 'enforce' ? { name: 'Authentication', status: 'ok', detail: 'enforce: every call needs a token' }
      : config.authMode === 'warn' ? { name: 'Authentication', status: 'warn', detail: 'warn: calls without a token are accepted', fix: 'Set SDD_AUTH_MODE=enforce once every host sends a token.' }
      : { name: 'Authentication', status: 'warn', detail: 'off: no identity is recorded', fix: 'Use SDD_AUTH_MODE=warn or enforce on a shared server.' });
    checks.push({ name: 'Admin UI', status: config.adminToken || config.authMode !== 'off' ? 'ok' : 'warn', detail: config.adminToken || config.authMode !== 'off' ? 'enabled' : 'disabled', ...(config.adminToken || config.authMode !== 'off' ? {} : { fix: 'Set SDD_ADMIN_TOKEN or SDD_AUTH_MODE to enable /admin.' }) });
    checks.push({ name: 'Notifications', status: 'ok', detail: config.notifyWebhookUrl ? 'approval webhook configured' : 'no webhook (optional: SDD_NOTIFY_WEBHOOK_URL)' });
  } finally {
    await pool.end();
  }
  return checks;
}

const ICON = { ok: '✓', warn: '!', fail: '✗' } as const;

export function renderDiagnostics(checks: Check[]): string {
  return `${checks.map((c) => `${ICON[c.status]} ${c.name}: ${c.detail}${c.fix && c.status !== 'ok' ? `\n    → ${c.fix}` : ''}`).join('\n')}\n`;
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check the database, pgvector, migrations, embedding provider, packs and auth settings, and say how to fix what is wrong')
    .option('--json', 'machine-readable output', false)
    .action(async (o: { json: boolean }) => {
      const checks = await collectDiagnostics(process.env);
      process.stdout.write(o.json ? `${JSON.stringify({ checks })}\n` : renderDiagnostics(checks));
      if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
    });
}
