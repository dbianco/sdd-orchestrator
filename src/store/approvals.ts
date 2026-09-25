import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { ApprovalRow } from './rows.js';

export type ApprovalStatus = ApprovalRow['status'];

export async function createApproval(q: Queryable, a: { feature_id: string; transition_id: string; from_phase: string; to_phase: string }, requestedBy: string): Promise<ApprovalRow> {
  const r = await q.query<ApprovalRow>(
    `INSERT INTO approval_requests (id, feature_id, transition_id, from_phase, to_phase, requested_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
    [newId('ap'), a.feature_id, a.transition_id, a.from_phase, a.to_phase, requestedBy],
  );
  return r.rows[0]!;
}

export async function pendingApproval(q: Queryable, featureId: string): Promise<ApprovalRow | null> {
  const r = await q.query<ApprovalRow>(`SELECT * FROM approval_requests WHERE feature_id = $1 AND status = 'pending'`, [featureId]);
  return r.rows[0] ?? null;
}

export async function supersedePending(q: Queryable, featureId: string, actor: string): Promise<number> {
  const r = await q.query(
    `UPDATE approval_requests SET status = 'superseded', decided_by = $2, decided_at = now(), updated_at = now()
     WHERE feature_id = $1 AND status = 'pending'`,
    [featureId, actor],
  );
  return r.rowCount ?? 0;
}

export async function getApproval(q: Queryable, id: string, opts: { forUpdate?: boolean } = {}): Promise<ApprovalRow | null> {
  const r = await q.query<ApprovalRow>(`SELECT * FROM approval_requests WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return r.rows[0] ?? null;
}

export async function decideApproval(q: Queryable, id: string, d: { status: 'approved' | 'rejected'; decided_by: string; comment: string | null }): Promise<ApprovalRow> {
  const r = await q.query<ApprovalRow>(
    `UPDATE approval_requests SET status = $2, decided_by = $3, comment = $4, decided_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, d.status, d.decided_by, d.comment],
  );
  return r.rows[0]!;
}

export interface ApprovalListRow extends ApprovalRow { app: string; feature_slug: string; framework: string; track: string | null }

export async function listApprovals(q: Queryable, filter: { appId?: string | null; status?: ApprovalStatus | null; appIds?: string[] | null } = {}): Promise<ApprovalListRow[]> {
  const r = await q.query<ApprovalListRow>(
    `SELECT ar.*, a.slug AS app, f.slug AS feature_slug, f.framework, f.track
     FROM approval_requests ar JOIN features f ON f.id = ar.feature_id JOIN apps a ON a.id = f.app_id
     WHERE ($1::text IS NULL OR f.app_id = $1) AND ($2::text IS NULL OR ar.status = $2) AND ($3::text[] IS NULL OR f.app_id = ANY($3))
     ORDER BY ar.created_at`,
    [filter.appId ?? null, filter.status ?? null, filter.appIds ?? null],
  );
  return r.rows;
}
