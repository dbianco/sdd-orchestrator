import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { ProposalRow } from './rows.js';

export async function insertProposal(
  q: Queryable,
  p: { app_id: string; feature_id: string; payload: Record<string, unknown>; supersedes: string | null },
  actor: string,
): Promise<ProposalRow> {
  const r = await q.query<ProposalRow>(
    `INSERT INTO proposals (id, app_id, feature_id, payload, supersedes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [newId('p'), p.app_id, p.feature_id, JSON.stringify(p.payload), p.supersedes, actor],
  );
  return r.rows[0]!;
}

export async function getProposal(q: Queryable, id: string): Promise<ProposalRow | null> {
  const r = await q.query<ProposalRow>('SELECT * FROM proposals WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function listProposals(q: Queryable, status: 'pending' | 'approved' | 'rejected' | null): Promise<ProposalRow[]> {
  const r = await q.query<ProposalRow>('SELECT * FROM proposals WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at', [status]);
  return r.rows;
}

export async function reviewProposal(q: Queryable, id: string, status: 'approved' | 'rejected', reviewer: string, reason: string | null): Promise<ProposalRow> {
  const r = await q.query<ProposalRow>(
    `UPDATE proposals SET status = $2, reviewed_by = $3, review_reason = $4, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, reviewer, reason],
  );
  if (!r.rows[0]) throw new Error(`no proposal with id "${id}"`);
  return r.rows[0];
}
