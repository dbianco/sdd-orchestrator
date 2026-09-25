import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient } from '../helpers/mcp.js';
import { createToken } from '../../src/store/tokens.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('authentication over Streamable HTTP', () => {
  let secret: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    secret = (await createToken(pool, { actor: 'dana', name: 'test', scopes: ['host'], app_ids: null, expires_at: null }, 'test')).secret;
  });
  afterAll(closeTestPool);

  it('refuses an unauthenticated client in enforce mode', async () => {
    await expect(withClient('http', async (client) => { await client.listTools(); }, { env: { SDD_AUTH_MODE: 'enforce' } })).rejects.toThrow(/401|unauthorized/i);
  });

  it('serves an authenticated client in enforce mode', async () => {
    await withClient('http', async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('route_task');
    }, { env: { SDD_AUTH_MODE: 'enforce' }, headers: { Authorization: `Bearer ${secret}` } });
  });
});
