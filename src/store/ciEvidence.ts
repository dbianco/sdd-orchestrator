import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { CiEvidenceRow } from './rows.js';

export interface NewCiEvidence {
  app_id: string; feature_id: string; commit_sha: string; branch: string | null; run_url: string | null;
  evidence: Record<string, unknown>; token_id: string;
}

export async function insertCiEvidence(q: Queryable, e: NewCiEvidence, actor: string): Promise<CiEvidenceRow> {
  const r = await q.query<CiEvidenceRow>(
    `INSERT INTO ci_evidence (id, app_id, feature_id, commit_sha, branch, run_url, evidence, token_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [newId('ce'), e.app_id, e.feature_id, e.commit_sha.toLowerCase(), e.branch, e.run_url, JSON.stringify(e.evidence), e.token_id, actor],
  );
  return r.rows[0]!;
}

// Latest CI evidence posted after the feature last entered verify (or ever, when it never recorded that move).
export async function latestCiEvidenceSinceVerify(q: Queryable, featureId: string): Promise<CiEvidenceRow | null> {
  const r = await q.query<CiEvidenceRow>(
    `SELECT ce.* FROM ci_evidence ce
     WHERE ce.feature_id = $1 AND ce.created_at >= COALESCE((
       SELECT max(created_at) FROM phase_transitions WHERE feature_id = $1 AND to_phase = 'verify' AND result = 'pass'), '-infinity')
     ORDER BY ce.created_at DESC LIMIT 1`,
    [featureId],
  );
  return r.rows[0] ?? null;
}

export async function latestFeatureCommitSha(q: Queryable, featureId: string): Promise<string | null> {
  const r = await q.query<{ sha: string }>(
    `SELECT sha FROM commits WHERE feature_id = $1 ORDER BY committed_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [featureId],
  );
  return r.rows[0]?.sha ?? null;
}
