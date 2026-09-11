import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export async function runMigrations(databaseUrl: string, log: (msg: string) => void = () => undefined): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log,
    logger: { info: log, warn: log, error: log, debug: () => undefined },
  });
}
