import { PHASES, type Phase } from './types.js';

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}
