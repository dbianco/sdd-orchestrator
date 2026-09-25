import type { Queryable } from '../db/pool.js';
import { generateToken, hashToken, type Scope } from '../auth/tokens.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { ApiTokenRow } from './rows.js';

export interface NewToken { actor: string; name: string; scopes: Scope[]; app_ids: string[] | null; expires_at: Date | null }

const PUBLIC_COLUMNS = 'id, actor, name, scopes, app_ids, expires_at, revoked_at, revoked_reason, last_used_at, created_at, updated_at, created_by';

export async function createToken(q: Queryable, t: NewToken, createdBy: string): Promise<{ row: ApiTokenRow; secret: string }> {
  const secret = generateToken();
  const r = await q.query<ApiTokenRow>(
    `INSERT INTO api_tokens (id, actor, name, scopes, app_ids, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PUBLIC_COLUMNS}`,
    [newId('tk'), t.actor, t.name, t.scopes, t.app_ids, hashToken(secret), t.expires_at, createdBy],
  );
  return { row: r.rows[0]!, secret };
}

export async function findActiveTokenByHash(q: Queryable, hash: string): Promise<ApiTokenRow | null> {
  const r = await q.query<ApiTokenRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM api_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [hash],
  );
  return r.rows[0] ?? null;
}

export async function listTokens(q: Queryable, filter: { actor?: string } = {}): Promise<ApiTokenRow[]> {
  const r = await q.query<ApiTokenRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM api_tokens WHERE ($1::text IS NULL OR actor = $1) ORDER BY created_at`,
    [filter.actor ?? null],
  );
  return r.rows;
}

export async function revokeToken(q: Queryable, id: string, reason: string, actor: string): Promise<ApiTokenRow> {
  const r = await q.query<ApiTokenRow>(
    `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, $2), updated_at = now()
     WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, `${reason} (by ${actor})`],
  );
  if (!r.rows[0]) throw new DomainError('VALIDATION_ERROR', `token ${id} does not exist`, { field: 'id' });
  return r.rows[0];
}

// Throttled: a busy token writes last_used_at at most once a minute.
export async function touchToken(q: Queryable, id: string): Promise<void> {
  await q.query(
    `UPDATE api_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')`,
    [id],
  );
}
