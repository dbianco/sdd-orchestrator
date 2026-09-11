import { describe, it, expect } from 'vitest';
import { allowedTargets, classifyMove, mandatesApproval } from '../../../src/lifecycle/reachability.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const full: TrackDecl = {
  phases: { specify: {}, plan: {}, tasks: {}, implement: {}, verify: {}, integrate: {}, learn: {} }, gates: [],
};
const hotfix: TrackDecl = {
  spec_review: 'deferred',
  phases: { specify: {}, plan: 'skipped', tasks: 'skipped', implement: {}, verify: {}, integrate: {}, learn: {} }, gates: [],
};

describe('allowedTargets', () => {
  it('forward is the next non-skipped phase; backward is every earlier non-skipped phase', () => {
    expect(allowedTargets(hotfix, 'specify')).toEqual({ forward: ['implement'], backward: [] });
    expect(allowedTargets(hotfix, 'verify')).toEqual({ forward: ['integrate'], backward: ['specify', 'implement'] });
  });
  it('forward from the last phase is archived', () => {
    expect(allowedTargets(hotfix, 'learn').forward).toEqual(['archived']);
    expect(allowedTargets(full, 'learn').forward).toEqual(['archived']);
  });
});

describe('classifyMove', () => {
  it('classifies forward, backward and illegal', () => {
    expect(classifyMove(full, 'plan', 'tasks')).toBe('forward');
    expect(classifyMove(full, 'verify', 'implement')).toBe('backward');
    expect(classifyMove(full, 'specify', 'tasks')).toBeNull();
    expect(classifyMove(hotfix, 'specify', 'plan')).toBeNull();
    expect(classifyMove(full, 'learn', 'archived')).toBe('forward');
    expect(classifyMove(full, 'learn', 'nonsense')).toBeNull();
  });
});

describe('mandatesApproval', () => {
  it('mandates approval on the first forward move out of specify', () => {
    expect(mandatesApproval(full, 'specify', 'plan', false)).toBe(true);
    expect(mandatesApproval(full, 'plan', 'tasks', false)).toBe(false);
  });
  it('defers to the move out of verify when spec_review is deferred', () => {
    expect(mandatesApproval(hotfix, 'specify', 'implement', false)).toBe(false);
    expect(mandatesApproval(hotfix, 'verify', 'integrate', false)).toBe(true);
  });
  it('mandates approval out of verify when high risk', () => {
    expect(mandatesApproval(full, 'verify', 'integrate', true)).toBe(true);
    expect(mandatesApproval(full, 'verify', 'integrate', false)).toBe(false);
  });
});
