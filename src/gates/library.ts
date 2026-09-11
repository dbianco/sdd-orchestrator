import type { GateDecl } from '../domain/types.js';
import type { CheckDefinition } from './types.js';
import { deltaMarkers } from './checks/deltaMarkers.js';
import { humanApproved } from './checks/humanApproved.js';
import { measurableCriteria } from './checks/measurableCriteria.js';
import { missingArtifact } from './checks/missingArtifact.js';
import { placeholderScan } from './checks/placeholderScan.js';
import { requiredSections } from './checks/requiredSections.js';
import { scopeDrift } from './checks/scopeDrift.js';
import { taskDoneChecks } from './checks/taskDoneChecks.js';
import { taskOrdering } from './checks/taskOrdering.js';
import { verifyEvidence } from './checks/verifyEvidence.js';

export const GATE_LIBRARY_VERSION = '1';

export const GATE_LIBRARY: Record<string, CheckDefinition> = Object.fromEntries(
  [missingArtifact, placeholderScan, requiredSections, measurableCriteria, taskDoneChecks, taskOrdering,
    deltaMarkers, verifyEvidence, scopeDrift, humanApproved].map((c) => [c.name, c]),
);

export function getCheck(name: string): CheckDefinition | undefined {
  return GATE_LIBRARY[name];
}

const ARTIFACT_PARAM_KEYS = ['artifact', 'plan_artifact'];

export function validateGateDecl(gate: GateDecl): string[] {
  const errors: string[] = [];
  for (const check of gate.checks) {
    const def = getCheck(check.name);
    if (!def) { errors.push(`unknown check "${check.name}"`); continue; }
    const parsed = def.params.safeParse(check.params ?? {});
    if (!parsed.success) { errors.push(`check ${check.name} has invalid params: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`); continue; }
    for (const key of ARTIFACT_PARAM_KEYS) {
      const named = (check.params ?? {})[key];
      if (typeof named === 'string' && !gate.artifacts.includes(named)) {
        errors.push(`check ${check.name} names artifact "${named}" which is not declared for the transition`);
      }
    }
  }
  return errors;
}
