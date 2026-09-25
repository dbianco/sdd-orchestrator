import type { Queryable } from '../db/pool.js';
import type { FeatureRequirementRow } from './rows.js';

export interface CapturedRequirement { id: string; artifact: string; line: number }

export async function replaceRequirements(q: Queryable, featureId: string, transitionId: string, reqs: CapturedRequirement[], actor: string): Promise<void> {
  await q.query('DELETE FROM feature_requirements WHERE feature_id = $1', [featureId]);
  for (const r of reqs) {
    await q.query(
      `INSERT INTO feature_requirements (feature_id, req_id, artifact, line, transition_id, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [featureId, r.id, r.artifact, r.line, transitionId, actor],
    );
  }
}

export async function listRequirements(q: Queryable, featureId: string): Promise<FeatureRequirementRow[]> {
  const r = await q.query<FeatureRequirementRow>('SELECT * FROM feature_requirements WHERE feature_id = $1 ORDER BY line, req_id', [featureId]);
  return r.rows;
}
