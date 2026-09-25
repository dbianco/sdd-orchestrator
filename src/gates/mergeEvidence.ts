import type { Finding } from '../domain/types.js';

export const CI_ONLY_FIELDS = ['tests', 'lint', 'security'] as const;

export interface CiEvidenceInput { evidence: Record<string, unknown>; commit_sha: string }
export interface MergedEvidence { evidence: Record<string, unknown> | null; sources: Record<string, 'ci' | 'host'>; findings: Finding[] }

export function requiresCiEvidence(f: { compliance: boolean; high_risk: boolean; policyEvidence: 'ci' | 'host' | undefined }): boolean {
  if (f.compliance) return true;
  if (f.policyEvidence === 'host') return false;
  return f.policyEvidence === 'ci' || f.high_risk;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const short = (sha: string) => sha.slice(0, 7);
const blocker = (location: string | null, message: string): Finding => ({ check: 'verify_evidence', severity: 'blocker', location, message });

// CI values win field by field; when CI evidence is required, tests, lint and security may only come from CI.
export function mergeEvidence(host: unknown, ci: CiEvidenceInput | null, opts: { required: boolean; latestCommit: string | null }): MergedEvidence {
  const hostFields = isRecord(host) ? host : {};
  const ciFields = ci?.evidence ?? {};
  const evidence: Record<string, unknown> = {};
  const sources: Record<string, 'ci' | 'host'> = {};
  const findings: Finding[] = [];
  for (const [k, v] of Object.entries(ciFields)) { evidence[k] = v; sources[k] = 'ci'; }
  for (const [k, v] of Object.entries(hostFields)) {
    if (k in evidence) continue;
    if (opts.required && (CI_ONLY_FIELDS as readonly string[]).includes(k)) continue;
    evidence[k] = v; sources[k] = 'host';
  }
  if (opts.required) {
    if (!ci) {
      findings.push(blocker(null, 'CI evidence required: none recorded since the feature entered verify'));
    } else {
      for (const k of CI_ONLY_FIELDS) if (!(k in ciFields)) findings.push(blocker(k, `${k} must come from CI evidence for this feature`));
      if (opts.latestCommit && opts.latestCommit !== ci.commit_sha) {
        findings.push(blocker('commit_sha', `CI evidence is for ${short(ci.commit_sha)} but the latest commit of the feature is ${short(opts.latestCommit)}`));
      }
    }
  }
  const empty = Object.keys(evidence).length === 0 && !isRecord(host) && !ci;
  return { evidence: empty ? null : evidence, sources, findings };
}
