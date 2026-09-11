import { describe, it, expect } from 'vitest';
import { applyBackwardMove, MAX_FAILED_CYCLES } from '../../../src/lifecycle/cycles.js';

describe('applyBackwardMove', () => {
  it('increments failed_cycles on verify->implement with cycle_failed', () => {
    expect(applyBackwardMove({ failed_cycles: 0, status: 'active' }, 'verify', 'implement', true, 'tests red'))
      .toEqual({ failed_cycles: 1, status: 'active', blocked_reason: null, blocked_now: false });
  });
  it('blocks when the increment reaches the limit and keeps the reason', () => {
    expect(MAX_FAILED_CYCLES).toBe(3);
    expect(applyBackwardMove({ failed_cycles: 2, status: 'active' }, 'verify', 'implement', true, 'still red'))
      .toEqual({ failed_cycles: 3, status: 'blocked', blocked_reason: 'still red', blocked_now: true });
  });
  it('resets and unblocks on any other backward move', () => {
    expect(applyBackwardMove({ failed_cycles: 3, status: 'blocked' }, 'implement', 'specify', false, 'rethink'))
      .toEqual({ failed_cycles: 0, status: 'active', blocked_reason: null, blocked_now: false });
    expect(applyBackwardMove({ failed_cycles: 2, status: 'active' }, 'verify', 'implement', false, 'not a cycle'))
      .toEqual({ failed_cycles: 0, status: 'active', blocked_reason: null, blocked_now: false });
  });
});
