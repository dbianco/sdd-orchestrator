import type { Queryable } from '../db/pool.js';
import type { GateDecl } from '../domain/types.js';
import { extractRequirementIds } from '../gates/checks/requirementIds.js';
import { listRequirements, replaceRequirements, type CapturedRequirement } from '../store/requirements.js';

export interface RequirementStatus { id: string; covered: boolean | null }

// The requirements a gate's requirement_ids check would capture; null when the gate has no such check or its artifact is absent.
export function requirementsFromGate(gate: GateDecl | null, artifacts: Record<string, string>): CapturedRequirement[] | null {
  const check = gate?.checks.find((c) => c.name === 'requirement_ids');
  if (!check) return null;
  const { artifact, id_regex } = check.params as { artifact: string; id_regex: string };
  const text = artifacts[artifact];
  if (text === undefined) return null;
  const seen = new Set<string>();
  const reqs: CapturedRequirement[] = [];
  for (const r of extractRequirementIds(text, id_regex)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    reqs.push({ id: r.id, artifact, line: r.line });
  }
  return reqs;
}

export async function captureRequirements(
  q: Queryable, gate: GateDecl | null, artifacts: Record<string, string>, featureId: string, transitionId: string, actor: string,
): Promise<void> {
  const reqs = requirementsFromGate(gate, artifacts);
  if (reqs === null) return;
  await replaceRequirements(q, featureId, transitionId, reqs, actor);
}

export async function requirementIdsFor(q: Queryable, featureId: string): Promise<string[]> {
  return (await listRequirements(q, featureId)).map((r) => r.req_id);
}

export async function requirementStatus(q: Queryable, featureId: string): Promise<RequirementStatus[]> {
  const reqs = await listRequirements(q, featureId);
  if (reqs.length === 0) return [];
  const t = await q.query<{ evidence: { implements?: unknown } | null }>(
    `SELECT evidence FROM phase_transitions
     WHERE feature_id = $1 AND from_phase = 'verify' AND direction = 'forward' AND result = 'pass'
     ORDER BY created_at DESC LIMIT 1`,
    [featureId],
  );
  if (!t.rows[0]) return reqs.map((r) => ({ id: r.req_id, covered: null }));
  const raw = t.rows[0].evidence?.implements;
  const implemented = new Set((Array.isArray(raw) ? raw : []).filter((x): x is string => typeof x === 'string').map((s) => s.trim().toLowerCase()));
  return reqs.map((r) => ({ id: r.req_id, covered: implemented.has(r.req_id.trim().toLowerCase()) }));
}
