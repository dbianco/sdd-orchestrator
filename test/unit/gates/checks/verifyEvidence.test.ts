import { describe, it, expect } from 'vitest';
import { verifyEvidence } from '../../../../src/gates/checks/verifyEvidence.js';
import type { CheckInput } from '../../../../src/gates/types.js';

const good = {
  tests: { command: 'npm test', passed: 42, failed: 0 },
  lint: 'pass',
  security: { status: 'pass', new_high: 0, skipped_reason: null },
  files_changed: ['src/a.ts'],
};

function run(evidence: unknown, params: Record<string, unknown> = {}, severity: CheckInput['severity'] = 'blocker') {
  const input: CheckInput = { artifacts: {}, declaredArtifacts: [], evidence: evidence as CheckInput['evidence'], human_approved: false, params, severity };
  return verifyEvidence.run(input);
}

describe('verify_evidence', () => {
  it('passes with complete passing evidence', () => {
    expect(run(good)).toEqual([]);
  });
  it('blocks when evidence is absent', () => {
    expect(run(null)[0]).toMatchObject({ severity: 'blocker', message: 'evidence is required on the transition out of verify' });
  });
  it('blocks on a missing required field with its path', () => {
    const f = run({ ...good, tests: { command: 'npm test', passed: 1 } });
    expect(f[0]?.message).toMatch(/tests\.failed/);
  });
  it('blocks on failed tests, lint fail, or security fail', () => {
    expect(run({ ...good, tests: { ...good.tests, failed: 2 } })[0]?.message).toBe('2 tests failed');
    expect(run({ ...good, lint: 'fail' })[0]?.message).toBe('lint failed');
    expect(run({ ...good, security: { status: 'fail', new_high: 3 } })[0]?.message).toBe('security scan failed');
  });
  it('blocks when new_high exceeds max_new_high', () => {
    expect(run({ ...good, security: { status: 'pass', new_high: 1 } })[0]?.message).toBe('1 new high severity finding(s), max 0');
    expect(run({ ...good, security: { status: 'pass', new_high: 1 } }, { max_new_high: 1 })).toEqual([]);
  });
  it('warns on a skipped scan with a reason and blocks without one', () => {
    const w = run({ ...good, security: { status: 'skipped', new_high: 0, skipped_reason: 'no scanner in CI' } });
    expect(w).toEqual([{ check: 'verify_evidence', severity: 'warning', location: 'security', message: 'security scan skipped: no scanner in CI' }]);
    expect(run({ ...good, security: { status: 'skipped', new_high: 0 } })[0]?.severity).toBe('blocker');
  });
  it('enforces max_existing_tests_modified and characterization tests when set', () => {
    const f = run({ ...good, existing_tests_modified: 1 }, { max_existing_tests_modified: 0 });
    expect(f.map((x) => x.message)).toEqual(['1 existing test file(s) modified, max 0', 'characterization_tests must be non-empty']);
    expect(run({ ...good, existing_tests_modified: 0, characterization_tests: ['a.test.ts'] }, { max_existing_tests_modified: 0 })).toEqual([]);
    expect(run(good, { max_existing_tests_modified: 0 })[0]?.message).toMatch(/existing_tests_modified is required/);
  });
  it('threads severity parameter: configurable findings honor it, always-blockers ignore it', () => {
    // Configurable finding (tests.failed) should become 'warning' when severity is 'warning'
    const configurableWarning = run({ ...good, tests: { ...good.tests, failed: 1 } }, {}, 'warning');
    expect(configurableWarning[0]).toMatchObject({ severity: 'warning', message: '1 tests failed' });
    // Same finding with default severity should be 'blocker'
    const configurableBlocker = run({ ...good, tests: { ...good.tests, failed: 1 } }, {}, 'blocker');
    expect(configurableBlocker[0]).toMatchObject({ severity: 'blocker', message: '1 tests failed' });
    // Always-blocker finding (evidence absent) should stay 'blocker' even when severity is 'warning'
    const alwaysBlockerWithWarning = run(null, {}, 'warning');
    expect(alwaysBlockerWithWarning[0]).toMatchObject({ severity: 'blocker', message: 'evidence is required on the transition out of verify' });
    // Always-blocker finding (skipped without reason) should stay 'blocker' even when severity is 'warning'
    const skippedBlockerWithWarning = run({ ...good, security: { status: 'skipped', new_high: 0 } }, {}, 'warning');
    expect(skippedBlockerWithWarning[0]).toMatchObject({ severity: 'blocker', message: 'security.skipped_reason is required when status is skipped' });
  });
});
