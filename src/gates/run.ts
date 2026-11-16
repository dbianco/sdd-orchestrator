import type { Finding, GateDecl } from '../domain/types.js';
import { describeIssues, getCheck } from './library.js';
import { missingArtifact } from './checks/missingArtifact.js';
import { humanApproved } from './checks/humanApproved.js';
import { finding, type CheckInput } from './types.js';

export interface GateContext { artifacts: Record<string, string>; evidence: unknown; human_approved: boolean; requirements?: string[] }
export interface GateResult { result: 'pass' | 'fail'; findings: Finding[] }

export function runGate(gate: GateDecl | null, ctx: GateContext, mandatedApproval: boolean): GateResult {
  const findings: Finding[] = [];
  const base: Omit<CheckInput, 'params' | 'severity'> = {
    artifacts: ctx.artifacts,
    declaredArtifacts: gate?.artifacts ?? [],
    evidence: ctx.evidence as CheckInput['evidence'],
    human_approved: ctx.human_approved,
    requirements: ctx.requirements ?? [],
  };
  if (gate) {
    findings.push(...missingArtifact.run({ ...base, params: {}, severity: 'blocker' }));
    for (const check of gate.checks) {
      const def = getCheck(check.name);
      if (!def) throw new Error(`gate names unknown check "${check.name}"; packs are validated at ingestion`);
      // Packs are validated at ingestion, but a pack version ingested before a param rule existed (for example
      // a regex that does not compile) must block the move with an explanation, not crash it with a SyntaxError.
      const parsed = def.params.safeParse(check.params ?? {});
      if (!parsed.success) {
        findings.push(finding(check.name, 'blocker', null, `check is misconfigured in the framework pack (${describeIssues(parsed.error)}); ingest a corrected pack version, then repin the feature with a backward move and repin: true`));
        continue;
      }
      findings.push(...def.run({ ...base, params: check.params ?? {}, severity: check.severity ?? def.defaultSeverity }));
    }
  }
  const declaresApproval = gate?.checks.some((c) => c.name === 'human_approved') ?? false;
  if (mandatedApproval && !declaresApproval) {
    findings.push(...humanApproved.run({ ...base, params: {}, severity: 'blocker' }));
  }
  return { result: findings.some((f) => f.severity === 'blocker') ? 'fail' : 'pass', findings };
}
