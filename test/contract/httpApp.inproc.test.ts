import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { embedder } from '../helpers/seed.js';
import { createHttpApp, runHttp, type HttpDeps } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import { buildDeps, main } from '../../src/index.js';
import type { Config } from '../../src/config.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const config: Config = {
  databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' }, listen: { host: '127.0.0.1', port: 0 },
  allowedHosts: ['127.0.0.1'], tokenBudget: 6000, adminToken: null, authMode: 'off',
};

describe.skipIf(!url)('HTTP app and entry point in-process', () => {
  let base: HttpDeps;
  let server: Server | null = null;
  const serve = async (deps: HttpDeps, cfg: Config = config) => {
    server = await runHttp(deps, cfg);
    const a = server.address();
    return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  };
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool);
    const { registry, hooks } = createMetrics();
    base = { pool, embedder, tokenBudget: 6000, logger: createLogger('silent'), metrics: hooks, registry };
  });
  afterEach(() => { server?.close(); server = null; });
  afterAll(closeTestPool);

  it('answers /healthz for every combination of database and embedding state', async () => {
    const origin = await serve(base);
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({ status: 'ok', database: 'ok', embedding: 'ok' });
    server!.close();
    const sick = { ...base, embedder: { ...embedder, provider: 'fake' as const, model: 'm', embed: embedder.embed.bind(embedder), healthy: async () => false } };
    const sickOrigin = await serve(sick);
    expect((await (await fetch(`${sickOrigin}/healthz`)).json() as { embedding: string }).embedding).toBe('unreachable');
    server!.close();
    const off = await serve({ ...base, embedder: null });
    expect((await (await fetch(`${off}/healthz`)).json() as { embedding: string }).embedding).toBe('disabled');
    server!.close();
    const down = await serve({ ...base, pool: { query: () => Promise.reject(new Error('db down')) } as never });
    const r = await fetch(`${down}/healthz`);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ status: 'degraded', database: 'unreachable' });
  });

  it('serves Prometheus metrics and rejects a malformed JSON body', async () => {
    const origin = await serve(base);
    expect(await (await fetch(`${origin}/metrics`)).text()).toContain('# HELP');
    const bad = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ nope' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: -32700 } });
  });

  it('serves MCP over streamable HTTP, including the allowed-host check', async () => {
    const port = 18_600 + Math.floor(Math.random() * 300);
    const cfg = { ...config, listen: { host: '127.0.0.1', port }, allowedHosts: [`127.0.0.1:${port}`] };
    const origin = await serve(base, cfg);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('start_feature');
    await client.close();
    const rebound = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: 'evil.example' }, body: '{}' });
    expect([400, 403]).toContain(rebound.status);
  });

  it('builds its dependencies from the environment and starts the HTTP server', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { SDD_DATABASE_URL: url, SDD_EMBEDDING_PROVIDER: 'fake', SDD_LISTEN: '127.0.0.1:0', SDD_LOG_LEVEL: 'silent', SDD_NOTIFY_WEBHOOK_URL: 'http://127.0.0.1:9/hook' });
    try {
      const deps = await buildDeps();
      expect(deps.embedder?.provider).toBe('fake');
      expect(deps.notifier).toBeDefined();
      await deps.pool.end();
      delete process.env.SDD_NOTIFY_WEBHOOK_URL;
      const plain = await buildDeps();
      expect(plain.notifier).toBeUndefined();
      await plain.pool.end();
      await main(['node', 'index.js']); // not --stdio: starts the HTTP server on a free port
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});
