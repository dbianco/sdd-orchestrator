import type { Phase, PhaseOrArchived, TrackDecl } from '../domain/types.js';
import { isPhase } from '../domain/phases.js';
import { phaseOrder } from './track.js';

export function allowedTargets(track: TrackDecl, current: Phase): { forward: PhaseOrArchived[]; backward: Phase[] } {
  const order = phaseOrder(track);
  const i = order.indexOf(current);
  if (i < 0) throw new Error(`phase ${current} is not part of this track`);
  const forward: PhaseOrArchived[] = [i === order.length - 1 ? 'archived' : order[i + 1]!];
  return { forward, backward: order.slice(0, i) };
}

export function classifyMove(track: TrackDecl, current: Phase, target: string): 'forward' | 'backward' | null {
  const { forward, backward } = allowedTargets(track, current);
  if ((forward as string[]).includes(target)) return 'forward';
  if (isPhase(target) && backward.includes(target)) return 'backward';
  return null;
}

export function mandatesApproval(track: TrackDecl, from: Phase, to: PhaseOrArchived, highRisk: boolean): boolean {
  const order = phaseOrder(track);
  const deferred = track.spec_review === 'deferred';
  const isFirstOutOfSpecify = from === 'specify' && order[1] === to;
  const isOutOfVerify = from === 'verify' && order[order.indexOf('verify') + 1] === to;
  if (!deferred && isFirstOutOfSpecify) return true;
  if (deferred && isOutOfVerify) return true;
  if (highRisk && isOutOfVerify) return true;
  return false;
}
