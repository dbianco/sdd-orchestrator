import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { CommitRow } from './rows.js';

export interface NewCommit {
  app_id: string; sha: string; branch: string | null; message: string; files_changed: string[]; committed_at: Date | null;
  routing_id: string | null; feature_id: string | null;
}

// `xmax = 0` is true only for a row created by this statement's INSERT branch; a row taken by the
// DO UPDATE branch carries the updating transaction id, so it tells insert from update in one round trip.
// Note: Postgres doesn't support CHECK constraints on the INSERT candidate in ON CONFLICT DO UPDATE,
// so we use an update-first approach that's effectively equivalent for the upsert pattern.
export async function upsertCommit(q: Queryable, c: NewCommit, actor: string): Promise<{ row: CommitRow; deduplicated: boolean }> {
  // Try to update an existing row first
  const updateResult = await q.query<CommitRow>(
    `UPDATE commits
     SET branch = COALESCE($3, branch),
         message = $4,
         files_changed = $5,
         committed_at = COALESCE($6, committed_at),
         routing_id = COALESCE(routing_id, $7),
         feature_id = COALESCE(feature_id, $8),
         updated_at = now()
     WHERE app_id = $1 AND sha = $2
     RETURNING *`,
    [c.app_id, c.sha.toLowerCase(), c.branch, c.message, c.files_changed, c.committed_at, c.routing_id, c.feature_id],
  );

  if (updateResult.rows.length > 0) {
    return { row: updateResult.rows[0]!, deduplicated: true };
  }

  // No existing row, insert a new one (must have at least one anchor)
  const insertResult = await q.query<CommitRow>(
    `INSERT INTO commits (id, app_id, sha, branch, message, files_changed, committed_at, routing_id, feature_id, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'host', $10)
     RETURNING *`,
    [newId('cm'), c.app_id, c.sha.toLowerCase(), c.branch, c.message, c.files_changed, c.committed_at, c.routing_id, c.feature_id, actor],
  );

  return { row: insertResult.rows[0]!, deduplicated: false };
}

export async function listCommitsForRouting(q: Queryable, event: { id: string; feature_id: string | null }): Promise<CommitRow[]> {
  const r = await q.query<CommitRow>(
    `SELECT * FROM commits WHERE routing_id = $1 OR ($2::text IS NOT NULL AND feature_id = $2)
     ORDER BY committed_at NULLS LAST, created_at`,
    [event.id, event.feature_id],
  );
  return r.rows;
}
