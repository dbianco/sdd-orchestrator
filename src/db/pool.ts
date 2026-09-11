import pg from 'pg';

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

// connectionTimeoutMillis bounds both halves of pool.connect(): the TCP/startup handshake with
// Postgres and the wait for a free client once all `max` connections are checked out. Without it a
// blackholed (not refused) database host hangs /healthz's SELECT 1 forever instead of answering
// 503, and a saturated pool queues callers indefinitely. Five seconds is long enough for any
// healthy handshake and short enough to surface saturation as an error; see docs/operations.md for
// how to size `max` against embedding latency.
export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5_000 });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
