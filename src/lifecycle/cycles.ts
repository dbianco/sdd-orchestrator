import type { Phase } from '../domain/types.js';

export const MAX_FAILED_CYCLES = 3;

export interface CycleState { failed_cycles: number; status: 'active' | 'blocked' }
export interface CycleOutcome extends CycleState { blocked_reason: string | null; blocked_now: boolean }

export function isCycleMove(from: Phase, to: Phase): boolean {
  return from === 'verify' && to === 'implement';
}

export function applyBackwardMove(state: CycleState, from: Phase, to: Phase, cycleFailed: boolean, reason: string): CycleOutcome {
  if (isCycleMove(from, to) && cycleFailed) {
    const failed = state.failed_cycles + 1;
    if (failed >= MAX_FAILED_CYCLES) return { failed_cycles: failed, status: 'blocked', blocked_reason: reason, blocked_now: true };
    return { failed_cycles: failed, status: state.status, blocked_reason: null, blocked_now: false };
  }
  return { failed_cycles: 0, status: 'active', blocked_reason: null, blocked_now: false };
}
