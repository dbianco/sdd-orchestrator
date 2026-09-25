import type { Queryable } from '../db/pool.js';

export interface RtmRow {
  feature_id: string; slug: string; external_ref: string | null; req_id: string; covered: boolean | null;
  files_changed: string[]; tests_passed: number | null; tests_failed: number | null; evidence_source: 'ci' | 'host' | null;
  spec_approved_by: string | null; verify_approved_by: string | null; archived_at: string | null;
}

interface Raw {
  feature_id: string; slug: string; external_ref: string | null; req_id: string;
  evidence: { implements?: unknown; files_changed?: unknown; tests?: { passed?: unknown; failed?: unknown } } | null;
  verified: boolean; verify_approved: boolean | null; verify_by: string | null; spec_approved: boolean; spec_by: string; archived_at: Date | null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const int = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export async function rtmRows(q: Queryable, appId: string): Promise<RtmRow[]> {
  const r = await q.query<Raw>(
    `SELECT f.id AS feature_id, f.slug, f.external_ref, r.req_id,
       v.evidence, (v.id IS NOT NULL) AS verified, v.human_approved AS verify_approved, v.created_by AS verify_by,
       s.human_approved AS spec_approved, s.created_by AS spec_by, a.created_at AS archived_at
     FROM feature_requirements r
     JOIN features f ON f.id = r.feature_id
     JOIN phase_transitions s ON s.id = r.transition_id
     LEFT JOIN LATERAL (
       SELECT id, evidence, human_approved, created_by FROM phase_transitions
       WHERE feature_id = f.id AND from_phase = 'verify' AND direction = 'forward' AND result = 'pass'
       ORDER BY created_at DESC LIMIT 1) v ON true
     LEFT JOIN LATERAL (
       SELECT created_at FROM phase_transitions
       WHERE feature_id = f.id AND to_phase = 'archived' AND result = 'pass'
       ORDER BY created_at DESC LIMIT 1) a ON true
     WHERE f.app_id = $1
     ORDER BY f.created_at, f.id, r.line, r.req_id`,
    [appId],
  );
  return r.rows.map((x) => {
    const implemented = new Set(strings(x.evidence?.implements).map((s) => s.trim().toLowerCase()));
    return {
      feature_id: x.feature_id, slug: x.slug, external_ref: x.external_ref, req_id: x.req_id,
      covered: x.verified ? implemented.has(x.req_id.trim().toLowerCase()) : null,
      files_changed: strings(x.evidence?.files_changed),
      tests_passed: int(x.evidence?.tests?.passed), tests_failed: int(x.evidence?.tests?.failed),
      evidence_source: x.evidence ? 'host' : null,
      spec_approved_by: x.spec_approved ? x.spec_by : null,
      verify_approved_by: x.verify_approved ? x.verify_by : null,
      archived_at: x.archived_at ? x.archived_at.toISOString() : null,
    };
  });
}

export const RTM_COLUMNS: (keyof RtmRow)[] = [
  'feature_id', 'slug', 'external_ref', 'req_id', 'covered', 'files_changed', 'tests_passed', 'tests_failed',
  'evidence_source', 'spec_approved_by', 'verify_approved_by', 'archived_at',
];

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rtmCsv(rows: RtmRow[]): string {
  return [RTM_COLUMNS.join(','), ...rows.map((r) => RTM_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}
