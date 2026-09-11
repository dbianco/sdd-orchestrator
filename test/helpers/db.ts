import pg from 'pg';
import { createPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

let pool: pg.Pool | null = null;
let migrated = false;

export async function getTestPool(): Promise<pg.Pool> {
  const url = process.env.SDD_TEST_DATABASE_URL;
  if (!url) throw new Error('SDD_TEST_DATABASE_URL is not set');
  if (!migrated) { await runMigrations(url); migrated = true; }
  if (!pool) pool = createPool(url);
  return pool;
}

export async function truncateAll(p: pg.Pool): Promise<void> {
  await p.query(`TRUNCATE proposals, knowledge_chunks, knowledge_items, feature_artifacts, phase_transitions,
    context_packs, features, embedding_config, frameworks, app_policies, apps RESTART IDENTITY CASCADE`);
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = null;
}
