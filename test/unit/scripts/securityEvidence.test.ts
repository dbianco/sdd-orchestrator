import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSecurity, makeBaseline, opengrepHigh, trivyHigh } from '../../../scripts/lib/securityEvidence.mjs';
import { verifyEvidence } from '../../../src/gates/checks/verifyEvidence.js';

const trivy = {
  Results: [
    { Target: 'requirements.txt', Vulnerabilities: [
      { VulnerabilityID: 'CVE-2024-1', PkgName: 'flask', InstalledVersion: '2.0.0', Severity: 'CRITICAL' },
      { VulnerabilityID: 'CVE-2024-2', PkgName: 'jinja2', InstalledVersion: '3.0.0', Severity: 'MEDIUM' },
    ] },
    { Target: 'Dockerfile', Misconfigurations: [{ ID: 'DS002', Title: 'Image user should not be root', Severity: 'HIGH' }, { ID: 'DS026', Severity: 'LOW' }] },
    { Target: 'key.json', Secrets: [{ RuleID: 'gcp-service-account', Severity: 'CRITICAL', StartLine: 3 }] },
  ],
};
const opengrep = { results: [
  { check_id: 'cors-wildcard', path: 'src/app.py', start: { line: 10 }, extra: { severity: 'ERROR' } },
  { check_id: 'cors-wildcard', path: 'src/app.py', start: { line: 40 }, extra: { severity: 'ERROR' } },
  { check_id: 'i18n-lint', path: 'src/ui.ts', start: { line: 1 }, extra: { severity: 'WARNING' } },
] };

describe('security evidence from Trivy and Opengrep', () => {
  it('counts Trivy HIGH/CRITICAL (vulns, misconfig, secrets) and Opengrep ERROR only', () => {
    expect(trivyHigh(trivy).map((f) => f.key)).toEqual([
      'trivy:vuln:requirements.txt:CVE-2024-1:flask@2.0.0', 'trivy:misconfig:Dockerfile:DS002', 'trivy:secret:key.json:gcp-service-account',
    ]);
    expect(opengrepHigh(opengrep)).toHaveLength(2);
  });

  it('reports a seeded high finding as new_high > 0 and a clean scan as 0', () => {
    expect(buildSecurity({ trivy })).toMatchObject({ security: { status: 'pass', new_high: 3 } }); // the gate compares new_high with max_new_high
    expect(buildSecurity({ trivy: { Results: [] }, opengrep: { results: [] } }).security).toEqual({ status: 'pass', new_high: 0 });
  });

  it('only counts findings beyond the baseline, per occurrence, and ignores moved lines', () => {
    const baseline = makeBaseline([...trivyHigh(trivy), ...opengrepHigh(opengrep).slice(0, 1)]);
    const r = buildSecurity({ trivy, opengrep, baseline });
    expect(r.security).toEqual({ status: 'pass', new_high: 1 }); // the second cors-wildcard in the same file is new
    expect(r.baselined).toBe(4);
    const moved = { results: [{ ...opengrep.results[0], start: { line: 99 } }] };
    expect(buildSecurity({ trivy, opengrep: moved, baseline }).security).toEqual({ status: 'pass', new_high: 0 });
    // a resolved finding frees nothing else: fixing one occurrence does not hide a new one elsewhere
    expect(buildSecurity({ opengrep: { results: [{ check_id: 'sqli', path: 'a.py', extra: { severity: 'ERROR' } }] }, baseline }).security.new_high).toBe(1);
  });

  it('reports skipped with a reason, and refuses to pass silently with no input', () => {
    expect(buildSecurity({ skipped: 'no scanner in this pipeline' }).security).toEqual({ status: 'skipped', new_high: 0, skipped_reason: 'no scanner in this pipeline' });
    expect(() => buildSecurity({})).toThrow(/--skipped/);
  });

  it('produces objects that the verify_evidence gate accepts or rejects accordingly', () => {
    const evidence = (security: object) => ({ tests: { command: 't', passed: 1, failed: 0 }, lint: 'pass', security });
    const run = (security: object) => verifyEvidence.run({ artifacts: {}, declaredArtifacts: [], evidence: evidence(security), human_approved: false, params: {}, severity: 'blocker' });
    expect(run(buildSecurity({ trivy: { Results: [] } }).security)).toEqual([]);
    expect(run(buildSecurity({ trivy }).security).map((f) => f.message)).toEqual(['3 new high severity finding(s), max 0']);
    expect(run(buildSecurity({ skipped: 'offline' }).security).map((f) => f.severity)).toEqual(['warning']);
  });

  it('the CLI writes a baseline, prints the object and merges it into evidence.json', async () => {
    const run = (args: string[]) => promisify(execFile)('node', [resolve('scripts/sdd-security-evidence.mjs'), ...args]);
    const dir = await mkdtemp(join(tmpdir(), 'sdd-sec-'));
    await writeFile(join(dir, 'trivy.json'), JSON.stringify(trivy));
    await writeFile(join(dir, 'opengrep.json'), JSON.stringify(opengrep));
    await writeFile(join(dir, 'evidence.json'), JSON.stringify({ lint: 'pass' }));
    const base = join(dir, 'baseline.json');
    const first = await run(['--trivy', join(dir, 'trivy.json'), '--opengrep', join(dir, 'opengrep.json'), '--write-baseline', base]);
    expect(JSON.parse(first.stdout)).toEqual({ status: 'pass', new_high: 0 });
    expect(JSON.parse(await readFile(base, 'utf8')).findings['opengrep:cors-wildcard:src/app.py']).toBe(2);
    const second = await run(['--trivy', join(dir, 'trivy.json'), '--baseline', base, '--merge', join(dir, 'evidence.json')]);
    expect(JSON.parse(second.stdout)).toEqual({ status: 'pass', new_high: 0 });
    expect(JSON.parse(await readFile(join(dir, 'evidence.json'), 'utf8'))).toEqual({ lint: 'pass', security: { status: 'pass', new_high: 0 } });
    const noBaseline = await run(['--trivy', join(dir, 'trivy.json')]);
    expect(JSON.parse(noBaseline.stdout)).toEqual({ status: 'pass', new_high: 3 });
    await expect(run([])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('--skipped') });
  });
});
