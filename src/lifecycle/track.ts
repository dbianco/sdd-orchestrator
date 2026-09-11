import { z } from 'zod';
import { PHASES, type GateDecl, type Phase, type PhaseMapping, type PhaseOrArchived, type TrackDecl } from '../domain/types.js';

const PhaseMappingSchema = z.object({
  alias: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  template: z.string().min(1).optional(),
});
const PhaseEntrySchema = z.union([z.literal('skipped'), PhaseMappingSchema]);

export const GateCheckDeclSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  severity: z.enum(['blocker', 'warning']).optional(),
});
export const GateDeclSchema = z.object({
  transition: z.string().regex(/^[a-z]+->[a-z]+$/),
  artifacts: z.array(z.string().min(1)).default([]),
  checks: z.array(GateCheckDeclSchema).default([]),
});

export const TrackDeclSchema = z.object({
  spec_review: z.enum(['required', 'deferred']).optional(),
  phases: z.object(Object.fromEntries(PHASES.map((p) => [p, PhaseEntrySchema])) as Record<Phase, typeof PhaseEntrySchema>),
  gates: z.array(GateDeclSchema).default([]),
});
export const TracksSchema = z.record(z.string().min(1), TrackDeclSchema);

export const MANDATORY_PHASES: Phase[] = ['specify', 'implement', 'verify', 'integrate'];

export function phaseOrder(track: TrackDecl): Phase[] {
  return PHASES.filter((p) => track.phases[p] !== 'skipped');
}

export function transitionKey(from: Phase, to: PhaseOrArchived): string {
  return `${from}->${to}`;
}

export function gateFor(track: TrackDecl, from: Phase, to: PhaseOrArchived): GateDecl | null {
  const key = transitionKey(from, to);
  return track.gates.find((g) => g.transition === key) ?? null;
}

export function phaseMapping(track: TrackDecl, phase: Phase): PhaseMapping {
  const entry = track.phases[phase];
  if (entry === 'skipped') throw new Error(`phase ${phase} is skipped in this track`);
  return entry;
}

export function phaseAlias(track: TrackDecl, phase: Phase): string {
  const entry = track.phases[phase];
  return entry === 'skipped' ? phase : entry.alias ?? phase;
}

export function validateTrackShape(track: TrackDecl): string[] {
  const errors: string[] = [];
  for (const p of MANDATORY_PHASES) {
    if (track.phases[p] === 'skipped') errors.push(`phase ${p} is mandatory and cannot be skipped`);
  }
  const order = phaseOrder(track);
  for (const gate of track.gates) {
    const [from, to] = gate.transition.split('->') as [string, string];
    const i = order.indexOf(from as Phase);
    if (i < 0) { errors.push(`gate transition ${gate.transition} starts from a phase that is skipped or unknown`); continue; }
    const expected = i === order.length - 1 ? 'archived' : order[i + 1]!;
    if (to !== expected) errors.push(`gate transition ${gate.transition} is not a forward edge of this track (expected ${from}->${expected})`);
  }
  return errors;
}
