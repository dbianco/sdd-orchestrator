import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { collectDiagnostics, renderDiagnostics } from '../../../src/cli/commands/doctor.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const by = (checks: { name: string; status: string; detail: string; fix?: string }[], name: string) => checks.find((c) => c.name === name)!;

describe('collectDiagnostics', () => {
  it('names SDD_DATABASE_URL when it is missing, without touching anything', async () => {
    const checks = await collectDiagnostics({});
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: 'Configuration', status: 'fail' });
    expect(checks[0]!.detail).toMatch(/^SDD_DATABASE_URL is not set/);
  });

  it('reports an unreachable database with the fix', async () => {
    const checks = await collectDiagnostics({ SDD_DATABASE_URL: 'postgres://sdd:sdd@127.0.0.1:1/none', SDD_EMBEDDING_PROVIDER: 'fake' });
    expect(by(checks, 'Database')).toMatchObject({ status: 'fail', fix: expect.stringContaining('SDD_DATABASE_URL') });
  });

  describe.skipIf(!url)('against a database', () => {
    beforeEach(async () => truncateAll(await getTestPool()));
    afterAll(closeTestPool);

    it('flags placeholder embeddings, missing packs and apps, and a warn auth mode', async () => {
      const checks = await collectDiagnostics({ SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'fake' });
      expect(by(checks, 'Database').status).toBe('ok');
      expect(by(checks, 'pgvector').status).toBe('ok');
      expect(by(checks, 'Migrations').status).toBe('ok');
      expect(by(checks, 'Embedding provider')).toMatchObject({ status: 'warn', detail: expect.stringContaining('fake') });
      expect(by(checks, 'Framework packs').status).toBe('warn');
      expect(by(checks, 'Apps').status).toBe('warn');
      expect(by(checks, 'Authentication').status).toBe('warn');
      const text = renderDiagnostics(checks);
      expect(text).toMatch(/! Embedding provider: .*\n {4}→ /);
    });

    it('names the provider and its settings when the embedding endpoint is unreachable (issue #11)', async () => {
      const checks = await collectDiagnostics({ SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'ollama', OLLAMA_URL: 'http://127.0.0.1:9' });
      const c = by(checks, 'Embedding provider');
      expect(c.status).toBe('fail');
      expect(c.detail).toMatch(/^ollama\/mxbai-embed-large failed:/);
      expect(c.fix).toMatch(/OLLAMA_URL \(http:\/\/127\.0\.0\.1:9\)/);
    });

    it('fails when the index was built with a different model', async () => {
      const pool = await getTestPool();
      await pool.query(`INSERT INTO embedding_config (id, provider, model, dimension, created_by) VALUES ('singleton', 'voyage', 'voyage-3', 1024, 'test')`);
      const checks = await collectDiagnostics({ SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'fake' });
      expect(by(checks, 'Index matches provider')).toMatchObject({ status: 'fail', fix: expect.stringContaining('sdd-admin reindex') });
    });
  });
});
