import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { hashToken } from '../../../src/auth/tokens.js';
import { createToken, findActiveTokenByHash, listTokens, revokeToken, touchToken } from '../../../src/store/tokens.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('tokens store', () => {
  let pool: pg.Pool;
  beforeEach(async () => { pool = await getTestPool(); await truncateAll(pool); });
  afterAll(closeTestPool);

  it('stores only the hash and finds active tokens by it', async () => {
    const { row, secret } = await createToken(pool, { actor: 'dana', name: 'laptop', scopes: ['host', 'approver'], app_ids: null, expires_at: null }, 'admin');
    expect(row).toMatchObject({ actor: 'dana', scopes: ['host', 'approver'], app_ids: null, created_by: 'admin' });
    expect(row).not.toHaveProperty('token_hash');
    const stored = (await pool.query('SELECT token_hash FROM api_tokens')).rows[0].token_hash;
    expect(stored).toBe(hashToken(secret));
    expect(stored).not.toContain(secret.slice(4));
    expect((await findActiveTokenByHash(pool, hashToken(secret)))?.id).toBe(row.id);
    expect(await findActiveTokenByHash(pool, hashToken('sdd_wrong'))).toBeNull();
    expect((await listTokens(pool, { actor: 'dana' })).map((t) => t.id)).toEqual([row.id]);
  });

  it('does not find revoked or expired tokens', async () => {
    const revoked = await createToken(pool, { actor: 'a', name: 'n', scopes: ['host'], app_ids: null, expires_at: null }, 'x');
    await revokeToken(pool, revoked.row.id, 'lost', 'x');
    expect(await findActiveTokenByHash(pool, hashToken(revoked.secret))).toBeNull();
    const expired = await createToken(pool, { actor: 'a', name: 'n', scopes: ['ci'], app_ids: ['app_1'], expires_at: new Date(Date.now() - 1000) }, 'x');
    expect(await findActiveTokenByHash(pool, hashToken(expired.secret))).toBeNull();
  });

  it('throttles last_used_at to one write a minute', async () => {
    const { row } = await createToken(pool, { actor: 'a', name: 'n', scopes: ['host'], app_ids: null, expires_at: null }, 'x');
    await touchToken(pool, row.id);
    const first = (await pool.query('SELECT last_used_at FROM api_tokens WHERE id = $1', [row.id])).rows[0].last_used_at;
    await touchToken(pool, row.id);
    const second = (await pool.query('SELECT last_used_at FROM api_tokens WHERE id = $1', [row.id])).rows[0].last_used_at;
    expect(first).not.toBeNull();
    expect(second.getTime()).toBe(first.getTime());
  });

  it('rejects unknown scopes at the database', async () => {
    await expect(pool.query(`INSERT INTO api_tokens (id, actor, name, scopes, token_hash, created_by) VALUES ('tk_x', 'a', 'n', ARRAY['root'], 'h', 'x')`)).rejects.toThrow(/check/i);
  });
});
