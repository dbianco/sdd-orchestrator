import type { Queryable } from '../db/pool.js';
import type { Decision, FeatureStatus, Workspace } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { FeatureRow } from './rows.js';

export interface NewFeature {
  app_id: string; slug: string; intent: string; framework: string; framework_pack_version: string; track: string | null;
  high_risk: boolean; policy_version: number | null; policy_override_reason: string | null; source_task: string;
  external_ref: string | null; trigger_ref: string | null; decision: Decision; workspace: Workspace | null;
}

async function freeSlug(q: Queryable, appId: string, base: string): Promise<string> {
  const r = await q.query<{ slug: string }>('SELECT slug FROM features WHERE app_id = $1 AND (slug = $2 OR slug LIKE $2 || \'-%\')', [appId, base]);
  const taken = new Set(r.rows.map((x) => x.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function createFeature(q: Queryable, f: NewFeature, actor: string): Promise<FeatureRow> {
  const slug = await freeSlug(q, f.app_id, f.slug);
  const r = await q.query<FeatureRow>(
    `INSERT INTO features (id, app_id, slug, intent, framework, framework_pack_version, track, current_phase, status, high_risk, failed_cycles,
       policy_version, policy_override_reason, source_task, external_ref, trigger_ref, decision, workspace, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'specify', 'active', $8, 0, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [newId('f'), f.app_id, slug, f.intent, f.framework, f.framework_pack_version, f.track, f.high_risk, f.policy_version,
      f.policy_override_reason, f.source_task, f.external_ref, f.trigger_ref, JSON.stringify(f.decision), f.workspace ? JSON.stringify(f.workspace) : null, actor],
  );
  return r.rows[0]!;
}

export async function getFeature(q: Queryable, id: string, opts: { forUpdate?: boolean } = {}): Promise<FeatureRow | null> {
  const r = await q.query<FeatureRow>(`SELECT * FROM features WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return r.rows[0] ?? null;
}

export async function requireFeature(q: Queryable, id: string, opts: { forUpdate?: boolean } = {}): Promise<FeatureRow> {
  const f = await getFeature(q, id, opts);
  if (!f) throw new DomainError('FEATURE_NOT_FOUND', `no feature with id "${id}"`, { feature_id: id });
  return f;
}

export async function updateFeature(
  q: Queryable,
  id: string,
  patch: Partial<Pick<FeatureRow, 'current_phase' | 'status' | 'blocked_reason' | 'failed_cycles' | 'framework_pack_version'>>,
): Promise<FeatureRow> {
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    values.push(v);
    sets.push(`${k} = $${values.length}`);
  }
  const r = await q.query<FeatureRow>(`UPDATE features SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
  return r.rows[0]!;
}

export async function listFeatures(q: Queryable, appId: string, statuses: FeatureStatus[], externalRef: string | null, limit: number): Promise<FeatureRow[]> {
  const r = await q.query<FeatureRow>(
    `SELECT * FROM features WHERE app_id = $1 AND status = ANY($2) AND ($3::text IS NULL OR external_ref = $3) ORDER BY updated_at DESC LIMIT $4`,
    [appId, statuses, externalRef, limit],
  );
  return r.rows;
}
