import type { Queryable } from '../db/pool.js';

export interface FeatureCountRow { status: string; current_phase: string; framework: string; track: string | null; count: number }
export async function featureCounts(q: Queryable, appId: string | null = null): Promise<FeatureCountRow[]> {
  const r = await q.query<FeatureCountRow>(
    `SELECT status, current_phase, framework, track, count(*)::int AS count
     FROM features WHERE ($1::text IS NULL OR app_id = $1)
     GROUP BY status, current_phase, framework, track ORDER BY count DESC`,
    [appId],
  );
  return r.rows;
}

export interface GateCheckStatRow { check: string; blocker_count: number; warning_count: number }
export async function gateCheckStats(q: Queryable, appId: string | null = null): Promise<GateCheckStatRow[]> {
  const r = await q.query<GateCheckStatRow>(
    `SELECT finding->>'check' AS "check",
       count(*) FILTER (WHERE finding->>'severity' = 'blocker')::int AS blocker_count,
       count(*) FILTER (WHERE finding->>'severity' = 'warning')::int AS warning_count
     FROM phase_transitions pt
     JOIN features f ON f.id = pt.feature_id
     CROSS JOIN LATERAL jsonb_array_elements(pt.findings) AS finding
     WHERE ($1::text IS NULL OR f.app_id = $1)
     GROUP BY finding->>'check' ORDER BY blocker_count DESC`,
    [appId],
  );
  return r.rows;
}

export interface FlowCountRow { from_phase: string; to_phase: string; result: 'pass' | 'fail'; count: number }
export async function flowCounts(q: Queryable, appId: string | null = null): Promise<FlowCountRow[]> {
  const r = await q.query<FlowCountRow>(
    `SELECT pt.from_phase, pt.to_phase, pt.result, count(*)::int AS count
     FROM phase_transitions pt
     JOIN features f ON f.id = pt.feature_id
     WHERE ($1::text IS NULL OR f.app_id = $1) AND pt.direction = 'forward'
     GROUP BY pt.from_phase, pt.to_phase, pt.result ORDER BY pt.from_phase, pt.to_phase`,
    [appId],
  );
  return r.rows;
}

export interface ProposalStatusCountRow { status: 'pending' | 'approved' | 'rejected'; count: number }
export async function proposalsSummary(q: Queryable): Promise<ProposalStatusCountRow[]> {
  const r = await q.query<ProposalStatusCountRow>(`SELECT status, count(*)::int AS count FROM proposals GROUP BY status`);
  return r.rows;
}

export interface KnowledgeCountRow { kind: string; memory_type: string | null; count: number }
export async function knowledgeCounts(q: Queryable): Promise<KnowledgeCountRow[]> {
  const r = await q.query<KnowledgeCountRow>(`SELECT kind, memory_type, count(*)::int AS count FROM knowledge_items GROUP BY kind, memory_type ORDER BY count DESC`);
  return r.rows;
}
