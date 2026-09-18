import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { CommitRow } from './rows.js';

export interface NewCommit {
  app_id: string; sha: string; branch: string | null; message: string; files_changed: string[]; committed_at: Date | null;
  routing_id: string | null; feature_id: string | null;
}

// Postgres validates CHECK constraints on the INSERT candidate before ON CONFLICT arbitration, so the
// candidate borrows the existing row's anchors; `xmax = 0` is true only for a row this statement inserted.
export async function upsertCommit(q: Queryable, c: NewCommit, actor: string): Promise<{ row: CommitRow; deduplicated: boolean }> {
  const sha = c.sha.toLowerCase();
  const r = await q.query<CommitRow & { inserted: boolean }>(
    `INSERT INTO commits (id, app_id, sha, branch, message, files_changed, committed_at, routing_id, feature_id, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       COALESCE($8::text, (SELECT routing_id FROM commits WHERE app_id = $2 AND sha = $3)),
       COALESCE($9::text, (SELECT feature_id FROM commits WHERE app_id = $2 AND sha = $3)),
       'host', $10)
     ON CONFLICT (app_id, sha) DO UPDATE SET
       branch = COALESCE(EXCLUDED.branch, commits.branch),
       message = EXCLUDED.message,
       files_changed = EXCLUDED.files_changed,
       committed_at = COALESCE(EXCLUDED.committed_at, commits.committed_at),
       routing_id = COALESCE(commits.routing_id, EXCLUDED.routing_id),
       feature_id = COALESCE(commits.feature_id, EXCLUDED.feature_id),
       updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [newId('cm'), c.app_id, sha, c.branch, c.message, c.files_changed, c.committed_at, c.routing_id, c.feature_id, actor],
  );
  const { inserted, ...row } = r.rows[0]!;
  return { row, deduplicated: !inserted };
}

export async function listCommitsForRouting(q: Queryable, event: { id: string; feature_id: string | null }): Promise<CommitRow[]> {
  const r = await q.query<CommitRow>(
    `SELECT * FROM commits WHERE routing_id = $1 OR ($2::text IS NOT NULL AND feature_id = $2)
     ORDER BY committed_at NULLS LAST, created_at`,
    [event.id, event.feature_id],
  );
  return r.rows;
}
