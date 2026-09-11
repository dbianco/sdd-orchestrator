import type { Phase, TrackDecl } from '../domain/types.js';
import { allowedTargets, mandatesApproval } from './reachability.js';
import { gateFor, phaseAlias, phaseMapping } from './track.js';

export interface InstructionInput {
  feature_id: string;
  framework: string;
  track: string | null;
  phase: Phase;
  track_decl: TrackDecl;
}

export function renderPhaseInstructions(input: InstructionInput): string {
  const { feature_id, framework, track, phase, track_decl } = input;
  const mapping = phaseMapping(track_decl, phase);
  const alias = phaseAlias(track_decl, phase);
  const next = allowedTargets(track_decl, phase).forward[0]!;
  const gate = gateFor(track_decl, phase, next);
  const lines = [
    `Feature: ${feature_id}`,
    `Framework: ${framework}${track ? ` (track ${track})` : ''}`,
    `Phase: ${phase} (${alias})`,
    mapping.command ? `Command: ${mapping.command}` : null,
    `Produce the ${alias} artifacts following the phase template below.`,
    gate && gate.artifacts.length > 0
      ? `When done, call advance_phase with expected_phase: "${phase}", target_phase: "${next}" and artifacts: ${gate.artifacts.join(', ')}.`
      : `When done, call advance_phase with expected_phase: "${phase}", target_phase: "${next}".`,
    `Keep the feature id ${feature_id}; every later call needs it.`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export function renderNextGate(track: TrackDecl, phase: Phase, highRisk: boolean): string {
  const next = allowedTargets(track, phase).forward[0]!;
  const gate = gateFor(track, phase, next);
  const approval = mandatesApproval(track, phase, next, highRisk) || (gate?.checks.some((c) => c.name === 'human_approved') ?? false);
  const checks = (gate?.checks ?? []).map((c) => {
    const params = Object.entries(c.params ?? {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`);
    return params.length > 0 ? `${c.name} (${params.join(', ')})` : c.name;
  });
  return [
    `Next gate: ${phase} -> ${next}`,
    `Artifacts: ${gate && gate.artifacts.length > 0 ? gate.artifacts.join(', ') : 'none'}`,
    `Checks: ${checks.length > 0 ? checks.join('; ') : 'none'}`,
    `Human approval: ${approval ? 'required' : 'not required'}`,
    phase === 'verify' ? 'Evidence: required (tests, lint, security, files_changed)' : null,
  ].filter((l): l is string => l !== null).join('\n');
}
