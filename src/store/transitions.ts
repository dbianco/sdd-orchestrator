import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { Finding } from '../domain/types.js';
import { newId } from '../ids.js';
import type { ArtifactRow, TransitionRow } from './rows.js';

export const ARTIFACT_CONTENT_CAP = 256 * 1024;

export interface NewTransition {
  feature_id: string; from_phase: string; to_phase: string; direction: 'forward' | 'backward'; result: 'pass' | 'fail';
  findings: Finding[]; evidence: unknown | null; pack_id: string | null; artifact_hashes: Record<string, string>; human_approved: boolean; reason: string | null;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function insertTransition(q: Queryable, t: NewTransition, actor: string): Promise<TransitionRow> {
  const r = await q.query<TransitionRow>(
    `INSERT INTO phase_transitions (id, feature_id, from_phase, to_phase, direction, result, findings, evidence, pack_id, artifact_hashes, human_approved, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [newId('t'), t.feature_id, t.from_phase, t.to_phase, t.direction, t.result, JSON.stringify(t.findings), t.evidence == null ? null : JSON.stringify(t.evidence),
      t.pack_id, JSON.stringify(t.artifact_hashes), t.human_approved, t.reason, actor],
  );
  return r.rows[0]!;
}

export async function insertArtifacts(q: Queryable, transitionId: string, artifacts: Record<string, string>, actor: string): Promise<ArtifactRow[]> {
  const rows: ArtifactRow[] = [];
  for (const [name, content] of Object.entries(artifacts)) {
    const byteLength = Buffer.byteLength(content, 'utf8');
    const r = await q.query<ArtifactRow>(
      `INSERT INTO feature_artifacts (id, transition_id, name, sha256, byte_length, content, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [newId('fa'), transitionId, name, sha256(content), byteLength, byteLength > ARTIFACT_CONTENT_CAP ? null : content, actor],
    );
    rows.push(r.rows[0]!);
  }
  return rows;
}

export async function listTransitions(q: Queryable, featureId: string): Promise<TransitionRow[]> {
  const r = await q.query<TransitionRow>('SELECT * FROM phase_transitions WHERE feature_id = $1 ORDER BY created_at, id', [featureId]);
  return r.rows;
}
