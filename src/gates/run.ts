import type { Finding, GateDecl } from '../domain/types.js';
import { getCheck } from './library.js';
import { missingArtifact } from './checks/missingArtifact.js';
import { humanApproved } from './checks/humanApproved.js';
import type { CheckInput } from './types.js';

export interface GateContext { artifacts: Record<string, string>; evidence: unknown; human_approved: boolean }
export interface GateResult { result: 'pass' | 'fail'; findings: Finding[] }

export function runGate(gate: GateDecl | null, ctx: GateContext, mandatedApproval: boolean): GateResult {
  const findings: Finding[] = [];
  const base: Omit<CheckInput, 'params' | 'severity'> = {
    artifacts: ctx.artifacts,
    declaredArtifacts: gate?.artifacts ?? [],
    evidence: ctx.evidence as CheckInput['evidence'],
    human_approved: ctx.human_approved,
  };
  if (gate) {
    findings.push(...missingArtifact.run({ ...base, params: {}, severity: 'blocker' }));
    for (const check of gate.checks) {
      const def = getCheck(check.name);
      if (!def) throw new Error(`gate names unknown check "${check.name}"; packs are validated at ingestion`);
      findings.push(...def.run({ ...base, params: check.params ?? {}, severity: check.severity ?? def.defaultSeverity }));
    }
  }
  const declaresApproval = gate?.checks.some((c) => c.name === 'human_approved') ?? false;
  if (mandatedApproval && !declaresApproval) {
    findings.push(...humanApproved.run({ ...base, params: {}, severity: 'blocker' }));
  }
  return { result: findings.some((f) => f.severity === 'blocker') ? 'fail' : 'pass', findings };
}
