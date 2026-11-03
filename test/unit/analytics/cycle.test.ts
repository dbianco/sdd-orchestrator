import { describe, it, expect } from 'vitest';
import { featureCycle, median, summarizeCycles, type FeatureFacts } from '../../../src/analytics/cycle.js';

const t0 = Date.parse('2026-10-01T00:00:00Z');
const at = (hours: number) => new Date(t0 + hours * 3_600_000);
const move = (from: string, to: string, h: number, result = 'pass', direction: 'forward' | 'backward' = 'forward') => ({ from_phase: from, to_phase: to, direction, result, at: at(h) });
const facts = (id: string, transitions: FeatureFacts['transitions'], over: Partial<FeatureFacts> = {}): FeatureFacts => ({ feature_id: id, framework: 'openspec', track: 'default', created_at: at(0), transitions, ...over });

describe('featureCycle', () => {
  it('attributes time to the phase a passing move leaves, and splits spec from build time', () => {
    const c = featureCycle(facts('f1', [move('specify', 'plan', 4), move('plan', 'tasks', 6), move('tasks', 'implement', 7), move('implement', 'verify', 27), move('verify', 'integrate', 30), move('integrate', 'archived', 32)]));
    expect(c.phase_hours).toEqual({ specify: 4, plan: 2, tasks: 1, implement: 20, verify: 3, integrate: 2 });
    expect(c.spec_hours).toBe(7);
    expect(c.build_hours).toBe(25);
    expect(c.archived).toBe(true);
    expect(c.cycle_hours).toBe(32);
  });

  it('counts failed attempts and the rework between the first failure and the eventual pass', () => {
    const c = featureCycle(facts('f2', [move('specify', 'plan', 1, 'fail'), move('specify', 'plan', 2, 'fail'), move('specify', 'plan', 5, 'pass'), move('plan', 'tasks', 6, 'awaiting_approval')]));
    expect(c.failed_attempts).toBe(2);
    expect(c.rework_hours).toBe(4); // first failure at 1h, passed at 5h
    expect(c.phase_hours.specify).toBe(5);
    expect(c.archived).toBe(false);
    expect(c.cycle_hours).toBeNull();
  });

  it('counts backward moves as spec amendments and keeps their time', () => {
    const c = featureCycle(facts('f3', [move('specify', 'plan', 2), move('plan', 'tasks', 3), move('tasks', 'implement', 4), move('implement', 'plan', 10, 'pass', 'backward'), move('plan', 'tasks', 11)]));
    expect(c.backward_moves).toBe(1);
    expect(c.phase_hours.implement).toBe(6);
    expect(c.phase_hours.plan).toBe(2); // 1h first time, 1h on the way back
  });

  it('handles a feature with no transitions', () => {
    expect(featureCycle(facts('f4', []))).toMatchObject({ spec_hours: 0, build_hours: 0, archived: false, failed_attempts: 0 });
  });
});

describe('summarizeCycles', () => {
  it('computes medians, the spec share, rework and a per-track breakdown', () => {
    const a = featureCycle(facts('a', [move('specify', 'plan', 2), move('plan', 'implement', 4), move('implement', 'archived', 24)]));
    const b = featureCycle(facts('b', [move('specify', 'plan', 4), move('plan', 'implement', 8), move('implement', 'archived', 48)]));
    const hot = featureCycle(facts('c', [move('specify', 'implement', 1, 'fail'), move('specify', 'implement', 3), move('implement', 'archived', 5)], { track: 'hotfix' }));
    const m = summarizeCycles([a, b, hot]);
    expect(m).toMatchObject({ features: 3, archived: 3, median_cycle_hours: 24 });
    expect(m.phase_median_hours).toMatchObject({ specify: 3, plan: 3, implement: 20 });
    expect(m.spec_share).toBeCloseTo((4 + 8 + 3) / (4 + 8 + 3 + 20 + 40 + 2), 5);
    expect(m.rework).toMatchObject({ features_with_rework: 1, median_rework_hours: 2, failed_attempts: 1, backward_moves: 0 });
    expect(m.by_track.map((t) => [t.track, t.features, t.median_cycle_hours])).toEqual([['default', 2, 36], ['hotfix', 1, 5]]);
    expect(m.by_track[1]!.avg_failed_attempts).toBe(1);
  });

  it('is empty-safe', () => {
    expect(summarizeCycles([])).toMatchObject({ features: 0, median_cycle_hours: null, spec_share: null, by_track: [] });
    expect(median([])).toBeNull();
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
