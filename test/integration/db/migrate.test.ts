import { describe, it, expect, afterAll } from 'vitest';
import { getTestPool, closeTestPool } from '../../helpers/db.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('migrations', () => {
  afterAll(closeTestPool);

  it('creates every table and the extensions', async () => {
    const pool = await getTestPool();
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const t of ['apps', 'app_policies', 'frameworks', 'embedding_config', 'features', 'context_packs',
      'phase_transitions', 'feature_artifacts', 'knowledge_items', 'knowledge_chunks', 'proposals']) {
      expect(names).toContain(t);
    }
    const ext = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension`);
    expect(ext.rows.map((r) => r.extname)).toEqual(expect.arrayContaining(['vector', 'pg_trgm']));
  });

  it('is idempotent', async () => {
    const { runMigrations } = await import('../../../src/db/migrate.js');
    await expect(runMigrations(url!)).resolves.toBeUndefined();
  });

  it('has a 1024-dimension embedding column with an hnsw index', async () => {
    const pool = await getTestPool();
    const col = await pool.query(`SELECT format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'knowledge_chunks' AND a.attname = 'embedding'`);
    expect(col.rows[0].t).toBe('vector(1024)');
    const idx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'knowledge_chunks' AND indexdef ILIKE '%hnsw%'`);
    expect(idx.rows.length).toBe(1);
  });
});
