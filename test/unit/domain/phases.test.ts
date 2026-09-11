import { describe, it, expect } from 'vitest';
import { PHASES } from '../../../src/domain/types.js';
import { phaseIndex, isPhase } from '../../../src/domain/phases.js';

describe('phases', () => {
  it('lists the seven abstract phases in order', () => {
    expect(PHASES).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
  });
  it('indexes phases', () => {
    expect(phaseIndex('specify')).toBe(0);
    expect(phaseIndex('learn')).toBe(6);
  });
  it('recognises phase names', () => {
    expect(isPhase('verify')).toBe(true);
    expect(isPhase('archived')).toBe(false);
  });
});
