import { describe, it, expect } from 'vitest';
import { renderVerifyEvidenceHint } from '../../../src/gates/evidence.js';

describe('renderVerifyEvidenceHint', () => {
  it('shows the required field names, an example value and the enum choices', () => {
    const text = renderVerifyEvidenceHint({});
    expect(text).toContain('tests.command');
    expect(text).toContain('tests.passed');
    expect(text).toContain('tests.failed');
    expect(text).toContain("lint: 'pass' | 'fail'");
    expect(text).toContain("security.status: 'pass' | 'fail' | 'skipped'");
    expect(text).toContain('security.skipped_reason is required when security.status is "skipped"');
  });

  it('always states the new_high cap, defaulting to 0 when unset', () => {
    expect(renderVerifyEvidenceHint({})).toContain('max 0 new high severity finding(s)');
    expect(renderVerifyEvidenceHint({ max_new_high: 2 })).toContain('max 2 new high severity finding(s)');
  });

  it('omits refactor-only fields when max_existing_tests_modified is not set', () => {
    const text = renderVerifyEvidenceHint({});
    expect(text).not.toContain('existing_tests_modified');
    expect(text).not.toContain('characterization_tests');
  });

  it('mentions the refactor-only fields when max_existing_tests_modified is set', () => {
    const text = renderVerifyEvidenceHint({ max_existing_tests_modified: 0 });
    expect(text).toContain('existing_tests_modified');
    expect(text).toContain('characterization_tests (must be non-empty)');
    expect(text).toContain('max 0 existing test file(s) modified');
  });
});
