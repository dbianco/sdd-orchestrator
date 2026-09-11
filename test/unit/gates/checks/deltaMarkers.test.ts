import { describe, it, expect } from 'vitest';
import { deltaMarkers } from '../../../../src/gates/checks/deltaMarkers.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function run(md: string) {
  const input: CheckInput = { artifacts: { 'spec.md': md }, declaredArtifacts: [], evidence: null, human_approved: false, params: { artifact: 'spec.md' }, severity: 'blocker' };
  return deltaMarkers.run(input);
}

describe('delta_markers', () => {
  it('requires at least one delta section', () => {
    expect(run('## Intro\nx')[0]?.message).toMatch(/no ADDED, MODIFIED or REMOVED Requirements section/);
  });
  it('accepts empty delta sections (refactor spec)', () => {
    expect(run('## ADDED Requirements\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n')).toEqual([]);
  });
  it('requires Reason and Migration on each removed entry', () => {
    const md = '## REMOVED Requirements\n### Requirement: Legacy export\n**Reason**: replaced\n### Requirement: Old auth\nsome text';
    const f = run(md);
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['spec.md:2', 'removed requirement "Requirement: Legacy export" lacks **Migration**'],
      ['spec.md:4', 'removed requirement "Requirement: Old auth" lacks **Reason**'],
      ['spec.md:4', 'removed requirement "Requirement: Old auth" lacks **Migration**'],
    ]);
  });
  it('treats a body without sub-headings as one entry', () => {
    expect(run('## REMOVED Requirements\n- old thing\n**Reason**: x\n**Migration**: y')).toEqual([]);
    expect(run('## REMOVED Requirements\n- old thing')).toHaveLength(2);
  });
  it('treats nested sub-headings under removed entries (3-level nesting)', () => {
    const md = '## REMOVED Requirements\n### Requirement: Legacy export\n**Reason**: replaced by new module\n**Migration**: use new export instead\n#### Scenario: CommonJS users\nsome migration guide';
    const f = run(md);
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['spec.md:5', 'removed requirement "Scenario: CommonJS users" lacks **Reason**'],
      ['spec.md:5', 'removed requirement "Scenario: CommonJS users" lacks **Migration**'],
    ]);
  });
});
