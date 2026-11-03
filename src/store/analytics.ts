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
       count(DISTINCT pt.id) FILTER (WHERE finding->>'severity' = 'blocker')::int AS blocker_count,
       count(DISTINCT pt.id) FILTER (WHERE finding->>'severity' = 'warning')::int AS warning_count
     FROM phase_transitions pt
     JOIN features f ON f.id = pt.feature_id
     CROSS JOIN LATERAL jsonb_array_elements(pt.findings) AS finding
     WHERE ($1::text IS NULL OR f.app_id = $1) AND pt.result <> 'awaiting_approval'
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
     WHERE ($1::text IS NULL OR f.app_id = $1) AND pt.direction = 'forward' AND pt.result <> 'awaiting_approval'
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

export interface ValueMetrics {
  weeks: { week: string; total: number; passed: number }[];
  first_pass_rate: number | null;
  caught: { failed_transitions: number; features: number };
  approvals: { decided: number; pending: number; avg_hours: number | null; median_hours: number | null; oldest_pending_hours: number | null };
}

/** Evidence that the process pays off: first-attempt gate success per week, problems caught, approval latency. */
export async function valueMetrics(q: Queryable, appId: string | null = null, weeks = 8): Promise<ValueMetrics> {
  const [weekly, caught, approvals] = await Promise.all([
    q.query<{ week: string; total: number; passed: number }>(
      `WITH first_try AS (
         SELECT DISTINCT ON (pt.feature_id, pt.from_phase, pt.to_phase) pt.result, pt.created_at
         FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id
         WHERE ($1::text IS NULL OR f.app_id = $1) AND pt.direction = 'forward' AND pt.result IN ('pass', 'fail')
         ORDER BY pt.feature_id, pt.from_phase, pt.to_phase, pt.created_at)
       SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*)::int AS total, count(*) FILTER (WHERE result = 'pass')::int AS passed
       FROM first_try WHERE created_at >= now() - make_interval(weeks => $2::int)
       GROUP BY 1 ORDER BY 1`, [appId, weeks]),
    q.query<{ failed_transitions: number; features: number }>(
      `SELECT count(*)::int AS failed_transitions, count(DISTINCT pt.feature_id)::int AS features
       FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id
       WHERE ($1::text IS NULL OR f.app_id = $1) AND pt.result = 'fail' AND pt.direction = 'forward'
         AND pt.created_at >= now() - make_interval(weeks => $2::int)`, [appId, weeks]),
    q.query<{ decided: number; pending: number; avg_hours: number | null; median_hours: number | null; oldest_pending_hours: number | null }>(
      `SELECT count(*) FILTER (WHERE ar.status IN ('approved', 'rejected'))::int AS decided,
         count(*) FILTER (WHERE ar.status = 'pending')::int AS pending,
         avg(extract(epoch FROM ar.decided_at - ar.created_at) / 3600) FILTER (WHERE ar.status IN ('approved', 'rejected'))::float AS avg_hours,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ar.decided_at - ar.created_at) / 3600) FILTER (WHERE ar.status IN ('approved', 'rejected')))::float AS median_hours,
         max(extract(epoch FROM now() - ar.created_at) / 3600) FILTER (WHERE ar.status = 'pending')::float AS oldest_pending_hours
       FROM approval_requests ar JOIN features f ON f.id = ar.feature_id
       WHERE ($1::text IS NULL OR f.app_id = $1)`, [appId]),
  ]);
  const total = weekly.rows.reduce((s, w) => s + w.total, 0);
  const passed = weekly.rows.reduce((s, w) => s + w.passed, 0);
  return { weeks: weekly.rows, first_pass_rate: total === 0 ? null : passed / total, caught: caught.rows[0]!, approvals: approvals.rows[0]! };
}

export interface WeekActivity {
  actor: string;
  days: number;
  actors: string[];
  shipped: { feature_id: string; slug: string; at: string }[];
  worked_on: { feature_id: string; slug: string; status: string; current_phase: string }[];
  transitions: { passed: number; failed: number };
  caught: { check: string; count: number; example: string | null }[];
  approvals: { decided: number; approved: number; rejected: number; requested: number; avg_wait_hours: number | null };
}

/** What one person did through the flow in the last `days` days, framed as problems caught early. */
export async function weekActivity(q: Queryable, actor: string, appId: string | null = null, days = 7): Promise<WeekActivity> {
  const since = `now() - make_interval(days => $3::int)`;
  const [actors, shipped, worked, counts, caught, decided, requested] = await Promise.all([
    q.query<{ actor: string }>(`SELECT DISTINCT pt.created_by AS actor FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id WHERE ($1::text IS NULL OR f.app_id = $1) AND pt.created_at >= ${since.replace('$3', '$2')} ORDER BY 1`, [appId, days]),
    q.query<{ feature_id: string; slug: string; at: string }>(
      `SELECT f.id AS feature_id, f.slug, to_char(pt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
       FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id
       WHERE pt.created_by = $1 AND ($2::text IS NULL OR f.app_id = $2) AND pt.to_phase = 'archived' AND pt.result = 'pass' AND pt.created_at >= ${since} ORDER BY pt.created_at DESC`, [actor, appId, days]),
    q.query<{ feature_id: string; slug: string; status: string; current_phase: string }>(
      `SELECT DISTINCT f.id AS feature_id, f.slug, f.status, f.current_phase
       FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id
       WHERE pt.created_by = $1 AND ($2::text IS NULL OR f.app_id = $2) AND pt.created_at >= ${since} ORDER BY f.slug`, [actor, appId, days]),
    q.query<{ passed: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE pt.result = 'pass')::int AS passed, count(*) FILTER (WHERE pt.result = 'fail')::int AS failed
       FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id
       WHERE pt.created_by = $1 AND ($2::text IS NULL OR f.app_id = $2) AND pt.direction = 'forward' AND pt.created_at >= ${since}`, [actor, appId, days]),
    q.query<{ check: string; count: number; example: string | null }>(
      `SELECT finding->>'check' AS "check", count(*)::int AS count, min(finding->>'message') AS example
       FROM phase_transitions pt JOIN features f ON f.id = pt.feature_id
       CROSS JOIN LATERAL jsonb_array_elements(pt.findings) AS finding
       WHERE pt.created_by = $1 AND ($2::text IS NULL OR f.app_id = $2) AND pt.result = 'fail' AND finding->>'severity' = 'blocker' AND pt.created_at >= ${since}
       GROUP BY 1 ORDER BY count DESC LIMIT 10`, [actor, appId, days]),
    q.query<{ approved: number; rejected: number }>(
      `SELECT count(*) FILTER (WHERE ar.status = 'approved')::int AS approved, count(*) FILTER (WHERE ar.status = 'rejected')::int AS rejected
       FROM approval_requests ar JOIN features f ON f.id = ar.feature_id
       WHERE ar.decided_by = $1 AND ($2::text IS NULL OR f.app_id = $2) AND ar.decided_at >= ${since}`, [actor, appId, days]),
    q.query<{ requested: number; avg_wait_hours: number | null }>(
      `SELECT count(*)::int AS requested, avg(extract(epoch FROM ar.decided_at - ar.created_at) / 3600) FILTER (WHERE ar.decided_at IS NOT NULL)::float AS avg_wait_hours
       FROM approval_requests ar JOIN features f ON f.id = ar.feature_id
       WHERE ar.requested_by = $1 AND ($2::text IS NULL OR f.app_id = $2) AND ar.created_at >= ${since}`, [actor, appId, days]),
  ]);
  const d = decided.rows[0]!;
  return {
    actor, days, actors: actors.rows.map((r) => r.actor), shipped: shipped.rows, worked_on: worked.rows, transitions: counts.rows[0]!, caught: caught.rows,
    approvals: { decided: d.approved + d.rejected, approved: d.approved, rejected: d.rejected, requested: requested.rows[0]!.requested, avg_wait_hours: requested.rows[0]!.avg_wait_hours },
  };
}
