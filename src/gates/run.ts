import type { Finding, GateDecl } from '../domain/types.js';
import { describeIssues, getCheck } from './library.js';
import { missingArtifact } from './checks/missingArtifact.js';
import { humanApproved } from './checks/humanApproved.js';
import { finding, type CheckInput } from './types.js';

/** `pack` names the framework version the gate came from (`openspec@1.1.0`), for the misconfiguration message. */
export interface GateContext { artifacts: Record<string, string>; evidence: unknown; human_approved: boolean; requirements?: string[]; pack?: string }

/**
 * Finding check name for a gate check whose params do not validate. It is its own check, not the broken
 * check's name, so hints, per-check statistics and "fix this" advice address the pack, not the artifacts.
 */
export const GATE_MISCONFIGURED = 'gate_misconfigured';
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
      // The way out works in every phase, the first included: tracks are read from the stored pack version, so
      // re-ingesting that same version with the pattern fixed repairs every feature pinned to it in place.
      const parsed = def.params.safeParse(check.params ?? {});
      if (!parsed.success) {
        const pack = ctx.pack ? `framework pack ${ctx.pack}` : 'the framework pack';
        findings.push(finding(GATE_MISCONFIGURED, 'blocker', check.name,
          `check ${check.name} in ${pack} cannot run: ${describeIssues(parsed.error)}. This is not a problem with the artifacts: an admin must fix the pack and re-ingest the same version (sdd-admin ingest), which repairs this feature in place; then retry the move`));
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
