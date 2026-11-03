// Cycle time and process overhead, computed from the phase transition history.
// "Spec time" is time spent in specify, plan and tasks; "build time" is everything after.

export const SPEC_PHASES = ['specify', 'plan', 'tasks'] as const;
const HOUR = 3_600_000;

export interface TransitionFact { from_phase: string; to_phase: string; direction: 'forward' | 'backward'; result: string; at: Date }
export interface FeatureFacts { feature_id: string; framework: string; track: string | null; created_at: Date; transitions: TransitionFact[] }

export interface FeatureCycle {
  feature_id: string; framework: string; track: string | null; archived: boolean;
  phase_hours: Record<string, number>; spec_hours: number; build_hours: number; cycle_hours: number | null;
  failed_attempts: number; backward_moves: number; rework_hours: number;
}

/** Time per phase for one feature: each passing move closes the phase it left; failures and rework are counted separately. */
export function featureCycle(f: FeatureFacts): FeatureCycle {
  const phase_hours: Record<string, number> = {};
  let entered = f.created_at.getTime();
  let failed = 0;
  let backward = 0;
  let rework = 0;
  let archivedAt: number | null = null;
  const firstFail = new Map<string, number>();
  for (const t of f.transitions) {
    const at = t.at.getTime();
    const edge = `${t.from_phase}->${t.to_phase}`;
    if (t.result === 'fail') {
      failed += 1;
      if (!firstFail.has(edge)) firstFail.set(edge, at);
    } else if (t.result === 'pass') {
      phase_hours[t.from_phase] = (phase_hours[t.from_phase] ?? 0) + Math.max(0, at - entered) / HOUR;
      entered = at;
      if (t.direction === 'backward') backward += 1;
      const failedAt = firstFail.get(edge);
      if (failedAt !== undefined) { rework += Math.max(0, at - failedAt) / HOUR; firstFail.delete(edge); }
      if (t.to_phase === 'archived') archivedAt = at;
    }
  }
  const sum = (phases: readonly string[]) => phases.reduce((s, p) => s + (phase_hours[p] ?? 0), 0);
  const spec = sum(SPEC_PHASES);
  const total = Object.values(phase_hours).reduce((s, h) => s + h, 0);
  return {
    feature_id: f.feature_id, framework: f.framework, track: f.track, archived: archivedAt !== null,
    phase_hours, spec_hours: spec, build_hours: total - spec,
    cycle_hours: archivedAt === null ? null : (archivedAt - f.created_at.getTime()) / HOUR,
    failed_attempts: failed, backward_moves: backward, rework_hours: rework,
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);
const share = (spec: number, build: number): number | null => (spec + build > 0 ? spec / (spec + build) : null);

export interface TrackCycle {
  framework: string; track: string | null; features: number; archived: number;
  median_cycle_hours: number | null; median_spec_hours: number | null; median_build_hours: number | null;
  spec_share: number | null; avg_failed_attempts: number;
}

export interface CycleMetrics {
  features: number; archived: number;
  median_cycle_hours: number | null; median_spec_hours: number | null; median_build_hours: number | null;
  spec_share: number | null;
  phase_median_hours: Record<string, number>;
  rework: { features_with_rework: number; median_rework_hours: number | null; failed_attempts: number; backward_moves: number };
  by_track: TrackCycle[];
}

export function summarizeCycles(cycles: FeatureCycle[]): CycleMetrics {
  const done = cycles.filter((c) => c.archived);
  const phases = new Map<string, number[]>();
  for (const c of cycles) for (const [p, h] of Object.entries(c.phase_hours)) phases.set(p, [...(phases.get(p) ?? []), h]);
  const phase_median_hours = Object.fromEntries([...phases].map(([p, hs]) => [p, round(median(hs))!]));
  const specTotal = cycles.reduce((s, c) => s + c.spec_hours, 0);
  const buildTotal = cycles.reduce((s, c) => s + c.build_hours, 0);
  const reworked = cycles.filter((c) => c.rework_hours > 0);

  const groups = new Map<string, FeatureCycle[]>();
  for (const c of cycles) groups.set(`${c.framework}:${c.track ?? ''}`, [...(groups.get(`${c.framework}:${c.track ?? ''}`) ?? []), c]);
  const by_track: TrackCycle[] = [...groups.values()].map((g) => {
    const finished = g.filter((c) => c.archived);
    return {
      framework: g[0]!.framework, track: g[0]!.track, features: g.length, archived: finished.length,
      median_cycle_hours: round(median(finished.map((c) => c.cycle_hours!))),
      median_spec_hours: round(median(g.map((c) => c.spec_hours))), median_build_hours: round(median(g.map((c) => c.build_hours))),
      spec_share: share(g.reduce((s, c) => s + c.spec_hours, 0), g.reduce((s, c) => s + c.build_hours, 0)),
      avg_failed_attempts: Math.round((g.reduce((s, c) => s + c.failed_attempts, 0) / g.length) * 10) / 10,
    };
  }).sort((a, b) => b.features - a.features);

  return {
    features: cycles.length, archived: done.length,
    median_cycle_hours: round(median(done.map((c) => c.cycle_hours!))),
    median_spec_hours: round(median(cycles.map((c) => c.spec_hours))), median_build_hours: round(median(cycles.map((c) => c.build_hours))),
    spec_share: share(specTotal, buildTotal),
    phase_median_hours,
    rework: {
      features_with_rework: reworked.length, median_rework_hours: round(median(reworked.map((c) => c.rework_hours))),
      failed_attempts: cycles.reduce((s, c) => s + c.failed_attempts, 0), backward_moves: cycles.reduce((s, c) => s + c.backward_moves, 0),
    },
    by_track,
  };
}
