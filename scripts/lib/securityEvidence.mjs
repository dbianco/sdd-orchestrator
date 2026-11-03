// Turns Trivy and Opengrep JSON reports into the `security` evidence object the verify gate expects:
//   { status: 'pass' | 'skipped', new_high, skipped_reason? }
// status is 'pass' when the scanners ran: the verify gate compares new_high with the track's max_new_high, so a
// policy that tolerates N findings keeps working. (status 'fail' is for a scanner that crashed or could not finish.)
// "High" means Trivy HIGH or CRITICAL and Opengrep ERROR. "New" means not covered by a committed baseline.

const TRIVY_HIGH = new Set(['HIGH', 'CRITICAL']);

/** High-severity findings from a Trivy report (`trivy fs --format json`), as stable keys plus display text. */
export function trivyHigh(report) {
  const out = [];
  for (const r of report?.Results ?? []) {
    const target = r.Target ?? '?';
    for (const v of r.Vulnerabilities ?? []) {
      if (TRIVY_HIGH.has(v.Severity)) out.push({ key: `trivy:vuln:${target}:${v.VulnerabilityID}:${v.PkgName}@${v.InstalledVersion}`, text: `${v.Severity} ${v.VulnerabilityID} in ${v.PkgName}@${v.InstalledVersion} (${target})` });
    }
    for (const m of r.Misconfigurations ?? []) {
      if (TRIVY_HIGH.has(m.Severity)) out.push({ key: `trivy:misconfig:${target}:${m.ID}`, text: `${m.Severity} ${m.ID} ${m.Title ?? ''} (${target})`.trim() });
    }
    for (const s of r.Secrets ?? []) {
      if (TRIVY_HIGH.has(s.Severity)) out.push({ key: `trivy:secret:${target}:${s.RuleID}`, text: `${s.Severity} secret ${s.RuleID} (${target}:${s.StartLine ?? '?'})` });
    }
  }
  return out;
}

/** High-severity findings from an Opengrep (or Semgrep) report (`opengrep scan --json`): severity ERROR. */
export function opengrepHigh(report) {
  const out = [];
  for (const r of report?.results ?? []) {
    if (String(r.extra?.severity ?? '').toUpperCase() === 'ERROR') {
      // No line number in the key: unrelated edits that shift lines must not turn old findings into "new" ones.
      out.push({ key: `opengrep:${r.check_id}:${r.path}`, text: `ERROR ${r.check_id} (${r.path}:${r.start?.line ?? '?'})` });
    }
  }
  return out;
}

const count = (findings) => {
  const m = {};
  for (const f of findings) m[f.key] = (m[f.key] ?? 0) + 1;
  return m;
};

/** Baseline file content for the current high findings (a multiset: key -> how many are accepted). */
export function makeBaseline(findings, now = new Date()) {
  return { version: 1, generated_at: now.toISOString(), findings: count(findings) };
}

/** Findings beyond what the baseline accepts: for each key, only the occurrences above the baselined count. */
export function newFindings(findings, baseline) {
  const allowed = { ...(baseline?.findings ?? {}) };
  const out = [];
  for (const f of findings) {
    if ((allowed[f.key] ?? 0) > 0) allowed[f.key] -= 1;
    else out.push(f);
  }
  return out;
}

/**
 * @param {{ trivy?: object, opengrep?: object, baseline?: object | null, skipped?: string }} input
 * @returns {{ security: object, high: number, newFindings: {key: string, text: string}[], baselined: number }}
 */
export function buildSecurity({ trivy, opengrep, baseline = null, skipped } = {}) {
  if (!trivy && !opengrep) {
    if (!skipped) throw new Error('give at least one scanner report (--trivy, --opengrep) or --skipped "<reason>"');
    return { security: { status: 'skipped', new_high: 0, skipped_reason: skipped }, high: 0, newFindings: [], baselined: 0 };
  }
  const all = [...(trivy ? trivyHigh(trivy) : []), ...(opengrep ? opengrepHigh(opengrep) : [])];
  const fresh = newFindings(all, baseline);
  return { security: { status: 'pass', new_high: fresh.length }, high: all.length, newFindings: fresh, baselined: all.length - fresh.length };
}
