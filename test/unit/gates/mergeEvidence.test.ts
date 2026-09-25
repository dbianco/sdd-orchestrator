import { describe, it, expect } from 'vitest';
import { mergeEvidence, requiresCiEvidence } from '../../../src/gates/mergeEvidence.js';

const hostEvidence = { tests: { command: 'npm test', passed: 50, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, implements: ['FR-001'] };
const ciEvidence = { tests: { command: 'npm ci-test', passed: 48, failed: 2 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/a.ts'] };

describe('requiresCiEvidence', () => {
  it.each([
    [{ compliance: true, high_risk: false, policyEvidence: 'host' as const }, true],
    [{ compliance: false, high_risk: true, policyEvidence: undefined }, true],
    [{ compliance: false, high_risk: true, policyEvidence: 'host' as const }, false],
    [{ compliance: false, high_risk: false, policyEvidence: 'ci' as const }, true],
    [{ compliance: false, high_risk: false, policyEvidence: undefined }, false],
  ])('%o -> %s', (input, expected) => {
    expect(requiresCiEvidence(input)).toBe(expected);
  });
});

describe('mergeEvidence', () => {
  it('prefers CI field by field and keeps host-only fields', () => {
    const m = mergeEvidence(hostEvidence, { evidence: ciEvidence, commit_sha: 'abc1234' }, { required: false, latestCommit: null });
    expect(m.evidence).toEqual({ ...ciEvidence, implements: ['FR-001'] });
    expect(m.sources).toEqual({ tests: 'ci', lint: 'ci', security: 'ci', files_changed: 'ci', implements: 'host' });
    expect(m.findings).toEqual([]);
  });
  it('passes host evidence through unchanged when there is no CI evidence and none is required', () => {
    const m = mergeEvidence(hostEvidence, null, { required: false, latestCommit: null });
    expect(m.evidence).toEqual(hostEvidence);
    expect(m.findings).toEqual([]);
  });
  it('returns null evidence when there is nothing at all', () => {
    expect(mergeEvidence(undefined, null, { required: false, latestCommit: null }).evidence).toBeNull();
  });
  it('blocks when CI evidence is required and absent, and drops host tests, lint and security', () => {
    const m = mergeEvidence(hostEvidence, null, { required: true, latestCommit: null });
    expect(m.evidence).toEqual({ implements: ['FR-001'] });
    expect(m.findings.map((f) => f.message)).toEqual(['CI evidence required: none recorded since the feature entered verify']);
  });
  it('blocks when required CI evidence misses a field or is for an older commit', () => {
    const m = mergeEvidence(hostEvidence, { evidence: { tests: ciEvidence.tests }, commit_sha: 'abc1234def' }, { required: true, latestCommit: '9999999aaa' });
    expect(m.findings.map((f) => f.message)).toEqual([
      'lint must come from CI evidence for this feature',
      'security must come from CI evidence for this feature',
      'CI evidence is for abc1234 but the latest commit of the feature is 9999999',
    ]);
  });
});
