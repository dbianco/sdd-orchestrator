import { describe, it, expect } from 'vitest';
import { measurableCriteria, DEFAULT_ADJECTIVES } from '../../../../src/gates/checks/measurableCriteria.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function run(md: string, extra: string[] = []) {
  const input: CheckInput = {
    artifacts: { 'spec.md': md }, declaredArtifacts: [], evidence: null, human_approved: false,
    params: { artifact: 'spec.md', section: 'Success Criteria', adjectives: extra }, severity: 'blocker',
  };
  return measurableCriteria.run(input);
}

describe('measurable_criteria', () => {
  it('has a default adjective list', () => {
    expect(DEFAULT_ADJECTIVES).toContain('fast');
    expect(DEFAULT_ADJECTIVES).toContain('scalable');
  });
  it('flags vague lines and accepts quantified ones', () => {
    const f = run('## Success Criteria\n- export must be fast\n- export completes in under 800 ms for 10k rows\n- 99% of requests succeed\n- the UI is responsive');
    expect(f.map((x) => x.location)).toEqual(['spec.md:2', 'spec.md:5']);
    expect(f[0]?.message).toContain('"export must be fast"');
  });
  it('accepts a bare integer as the measure', () => {
    expect(run('## Success Criteria\n- fast enough for 3 concurrent exports')).toEqual([]);
  });
  it('ignores lines without a listed adjective', () => {
    expect(run('## Success Criteria\n- exports include a header row')).toEqual([]);
  });
  it('extends the adjective list', () => {
    expect(run('## Success Criteria\n- must be snappy', ['snappy'])).toHaveLength(1);
  });
  it('is silent when the section or artifact is missing', () => {
    expect(run('## Other\n- slow')).toEqual([]);
  });
});
