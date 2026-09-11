import { describe, it, expect } from 'vitest';
import { TrackDeclSchema, phaseOrder, transitionKey, gateFor, phaseAlias, validateTrackShape } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

export const openspecDefault: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped', tasks: 'skipped',
    implement: { alias: 'apply', command: '/openspec:apply', template: 'openspec.template.apply' },
    verify: { alias: 'verify', template: 'openspec.template.verify' },
    integrate: { alias: 'archive', command: '/openspec:archive', template: 'openspec.template.archive' },
    learn: 'skipped',
  },
  gates: [
    { transition: 'specify->implement', artifacts: ['proposal.md'], checks: [{ name: 'placeholder_scan' }] },
    { transition: 'verify->integrate', artifacts: [], checks: [{ name: 'verify_evidence' }] },
  ],
};

describe('TrackDeclSchema', () => {
  it('accepts a full mapping and rejects a missing phase', () => {
    expect(TrackDeclSchema.safeParse(openspecDefault).success).toBe(true);
    const { learn: _l, ...rest } = openspecDefault.phases;
    expect(TrackDeclSchema.safeParse({ ...openspecDefault, phases: rest }).success).toBe(false);
  });
});

describe('phaseOrder and gates', () => {
  it('lists non-skipped phases in order', () => {
    expect(phaseOrder(openspecDefault)).toEqual(['specify', 'implement', 'verify', 'integrate']);
  });
  it('finds the gate for a transition', () => {
    expect(transitionKey('specify', 'implement')).toBe('specify->implement');
    expect(gateFor(openspecDefault, 'specify', 'implement')?.artifacts).toEqual(['proposal.md']);
    expect(gateFor(openspecDefault, 'implement', 'verify')).toBeNull();
    expect(gateFor(openspecDefault, 'integrate', 'archived')).toBeNull();
  });
  it('returns the alias or the phase name', () => {
    expect(phaseAlias(openspecDefault, 'specify')).toBe('proposal');
    expect(phaseAlias(openspecDefault, 'verify')).toBe('verify');
  });
});

describe('validateTrackShape', () => {
  it('rejects skipping a mandatory phase', () => {
    const bad = { ...openspecDefault, phases: { ...openspecDefault.phases, verify: 'skipped' as const } };
    expect(validateTrackShape(bad)).toContain('phase verify is mandatory and cannot be skipped');
  });
  it('rejects a gate on a non-adjacent or backward edge', () => {
    const bad = { ...openspecDefault, gates: [{ transition: 'specify->verify', artifacts: [], checks: [] }] };
    expect(validateTrackShape(bad)).toContain('gate transition specify->verify is not a forward edge of this track (expected specify->implement)');
  });
  it('accepts the archive edge', () => {
    const ok = { ...openspecDefault, gates: [{ transition: 'integrate->archived', artifacts: [], checks: [] }] };
    expect(validateTrackShape(ok)).toEqual([]);
  });
});
