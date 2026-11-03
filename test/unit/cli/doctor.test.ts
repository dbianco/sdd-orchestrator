import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { MIGRATIONS_DIR } from '../../../src/db/migrate.js';

const state = vi.hoisted(() => ({
  query: vi.fn<(sql: string) => Promise<{ rows: unknown[] }>>(),
  embed: vi.fn<() => Promise<number[][]>>(),
}));
vi.mock('../../../src/db/pool.js', () => ({ createPool: () => ({ query: state.query, end: async () => undefined }) }));
vi.mock('../../../src/embedding/index.js', () => ({ createEmbeddingProvider: () => ({ embed: state.embed }) }));

import { collectDiagnostics, renderDiagnostics } from '../../../src/cli/commands/doctor.js';

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
const env = { SDD_DATABASE_URL: 'postgres://x', SDD_EMBEDDING_PROVIDER: 'ollama', OLLAMA_URL: 'http://o:1' };
const by = (checks: { name: string }[], name: string) => checks.find((c) => c.name === name) as unknown as { status: string; detail: string; fix?: string };

interface Scenario { select?: () => Promise<unknown>; vector?: unknown[]; migrations?: () => Promise<{ rows: unknown[] }>; indexed?: unknown[]; counts?: { apps: number; frameworks: number; items: number } }
function script(s: Scenario = {}) {
  state.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT 1')) { await s.select?.(); return { rows: [] }; }
    if (sql.includes('pg_extension')) return { rows: s.vector ?? [{ extversion: '0.8.0' }] };
    if (sql.includes('pgmigrations')) return s.migrations ? s.migrations() : { rows: files.map((name) => ({ name })) };
    if (sql.includes('embedding_config')) return { rows: s.indexed ?? [] };
    return { rows: [s.counts ?? { apps: 1, frameworks: 2, items: 9 }] };
  });
}

describe('doctor diagnostics with a scripted database', () => {
  beforeEach(() => { state.embed.mockResolvedValue([[0.1, 0.2]]); });
  afterEach(() => { vi.useRealTimers(); state.query.mockReset(); state.embed.mockReset(); });

  it('reports a clean setup', async () => {
    script();
    const checks = await collectDiagnostics({ ...env, SDD_AUTH_MODE: 'enforce', SDD_ADMIN_TOKEN: 't', SDD_NOTIFY_WEBHOOK_URL: 'https://hooks.example/x' });
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
    expect(by(checks, 'Embedding provider').detail).toMatch(/answered in \d+ ms \(dimension 2\)/);
    expect(by(checks, 'Authentication').detail).toContain('enforce');
    expect(by(checks, 'Notifications').detail).toBe('approval webhook configured');
    expect(renderDiagnostics(checks)).not.toContain('→');
  });

  it('fails early when the database does not answer, whatever the error looks like', async () => {
    script({ select: () => Promise.reject('connection refused') });
    const checks = await collectDiagnostics(env);
    expect(by(checks, 'Database')).toMatchObject({ status: 'fail', detail: 'cannot connect: connection refused' });
    expect(checks).toHaveLength(2);
  });

  it('times out a database that never answers', async () => {
    vi.useFakeTimers();
    script({ select: () => new Promise(() => undefined) });
    const pending = collectDiagnostics(env);
    await vi.advanceTimersByTimeAsync(8100);
    expect(by(await pending, 'Database').detail).toContain('did not answer within 8s');
  });

  it('checks the pgvector extension and its version', async () => {
    script({ vector: [] });
    expect(by(await collectDiagnostics(env), 'pgvector')).toMatchObject({ status: 'fail', detail: expect.stringContaining('not installed') });
    script({ vector: [{ extversion: '0.6.2' }] });
    expect(by(await collectDiagnostics(env), 'pgvector')).toMatchObject({ status: 'warn', fix: expect.stringContaining('0.8') });
    script({ vector: [{ extversion: '1.0.0' }] });
    expect(by(await collectDiagnostics(env), 'pgvector').status).toBe('ok');
  });

  it('flags pending migrations, and stops when the migration table does not exist', async () => {
    script({ migrations: async () => ({ rows: [] }) });
    expect(by(await collectDiagnostics(env), 'Migrations')).toMatchObject({ status: 'warn', detail: `${files.length} pending` });
    script({ migrations: () => Promise.reject(new Error('relation "pgmigrations" does not exist')) });
    const checks = await collectDiagnostics(env);
    expect(by(checks, 'Migrations').detail).toContain('does not exist yet');
    expect(checks.map((c) => c.name)).not.toContain('Apps');
  });

  it('explains how to fix each kind of embedding failure', async () => {
    script();
    state.embed.mockRejectedValue(new Error('401 unauthorized'));
    const voyage = by(await collectDiagnostics({ ...env, SDD_EMBEDDING_PROVIDER: 'voyage', VOYAGE_API_KEY: 'k' }), 'Embedding provider');
    expect(voyage).toMatchObject({ status: 'fail', detail: expect.stringContaining('voyage/voyage-3.5 failed: 401 unauthorized'), fix: expect.stringContaining('VOYAGE_API_KEY') });
    state.embed.mockRejectedValue('plain failure');
    expect(by(await collectDiagnostics(env), 'Embedding provider').fix).toContain('OLLAMA_URL (http://o:1)');
    state.embed.mockResolvedValue([]);
    expect(by(await collectDiagnostics(env), 'Embedding provider').detail).toContain('dimension ?');
  });

  it('warns about placeholder embeddings, an empty installation and open authentication', async () => {
    script({ counts: { apps: 0, frameworks: 0, items: 0 } });
    const checks = await collectDiagnostics({ SDD_DATABASE_URL: 'postgres://x', SDD_EMBEDDING_PROVIDER: 'fake', SDD_AUTH_MODE: 'off' });
    expect(by(checks, 'Embedding provider').status).toBe('warn');
    expect(by(checks, 'Framework packs').status).toBe('warn');
    expect(by(checks, 'Apps').status).toBe('warn');
    expect(by(checks, 'Authentication')).toMatchObject({ status: 'warn', detail: expect.stringContaining('off') });
    expect(by(checks, 'Admin UI')).toMatchObject({ status: 'warn', detail: 'disabled', fix: expect.stringContaining('SDD_ADMIN_TOKEN') });
    expect(renderDiagnostics(checks)).toContain('\n    → ');
  });

  it('reports an index built with another model, and an up-to-date one', async () => {
    script({ indexed: [{ provider: 'ollama', model: 'mxbai-embed-large', dimension: 1024 }] });
    expect(by(await collectDiagnostics(env), 'Index matches provider')).toMatchObject({ status: 'ok', detail: 'ollama/mxbai-embed-large' });
    script({ indexed: [{ provider: 'voyage', model: 'voyage-3', dimension: 1024 }] });
    expect(by(await collectDiagnostics(env), 'Index matches provider').status).toBe('fail');
  });
});
