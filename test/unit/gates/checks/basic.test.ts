import { describe, it, expect } from 'vitest';
import { missingArtifact } from '../../../../src/gates/checks/missingArtifact.js';
import { placeholderScan } from '../../../../src/gates/checks/placeholderScan.js';
import { requiredSections } from '../../../../src/gates/checks/requiredSections.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function input(over: Partial<CheckInput>): CheckInput {
  return { artifacts: {}, declaredArtifacts: [], evidence: null, human_approved: false, params: {}, severity: 'blocker', ...over };
}

describe('missing_artifact', () => {
  it('reports each declared artifact absent from the call', () => {
    const f = missingArtifact.run(input({ declaredArtifacts: ['proposal.md', 'tasks.md'], artifacts: { 'tasks.md': 'x' } }));
    expect(f).toEqual([{ check: 'missing_artifact', severity: 'blocker', location: 'proposal.md', message: 'artifact "proposal.md" was not submitted' }]);
  });
  it('passes when all are present', () => {
    expect(missingArtifact.run(input({ declaredArtifacts: ['a'], artifacts: { a: '' } }))).toEqual([]);
  });
});

describe('placeholder_scan', () => {
  it('scans every submitted artifact with default markers and line numbers', () => {
    const f = placeholderScan.run(input({ artifacts: { 'a.md': 'ok\nTBD here\nsee OQ-3', 'b.md': 'NEEDS HUMAN INPUT' } }));
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['a.md:2', 'marker \\bTBD\\b'], ['a.md:3', 'marker \\bOQ-\\d+\\b'], ['b.md:1', 'marker NEEDS HUMAN INPUT'],
    ]);
  });
  it('is case-sensitive and accepts custom markers', () => {
    expect(placeholderScan.run(input({ artifacts: { 'a.md': 'todo later' } }))).toEqual([]);
    expect(placeholderScan.run(input({ artifacts: { 'a.md': 'FIXME' }, params: { markers: ['FIXME'] } }))).toHaveLength(1);
  });
  it('honours the configured severity', () => {
    expect(placeholderScan.run(input({ artifacts: { 'a.md': 'TODO' }, severity: 'warning' }))[0]?.severity).toBe('warning');
  });
});

describe('required_sections', () => {
  const md = '## Goal\ntext\n## Tasks\n\n## Other\nx';
  it('reports missing and empty sections', () => {
    const f = requiredSections.run(input({ artifacts: { 'spec.md': md }, params: { artifact: 'spec.md', sections: ['Goal', 'Tasks', 'Acceptance Criteria'] } }));
    expect(f.map((x) => x.message)).toEqual(['section "Tasks" is empty', 'section "Acceptance Criteria" is missing']);
    expect(f[0]?.location).toBe('spec.md:3');
  });
  it('matches headings case-insensitively at any level', () => {
    const f = requiredSections.run(input({ artifacts: { 'spec.md': '### goal\nx' }, params: { artifact: 'spec.md', sections: ['Goal'] } }));
    expect(f).toEqual([]);
  });
  it('is silent when the artifact is absent (missing_artifact reports that)', () => {
    expect(requiredSections.run(input({ params: { artifact: 'spec.md', sections: ['Goal'] } }))).toEqual([]);
  });
});
