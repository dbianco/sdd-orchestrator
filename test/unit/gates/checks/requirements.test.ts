import { describe, it, expect } from 'vitest';
import { extractRequirementIds, requirementIds } from '../../../../src/gates/checks/requirementIds.js';
import { requirementCoverage } from '../../../../src/gates/checks/requirementCoverage.js';
import { validateGateDecl } from '../../../../src/gates/library.js';
import type { CheckInput } from '../../../../src/gates/types.js';

const FR = String.raw`\*\*(?<id>FR-\d{3})\*\*`;
const spec = '## Functional Requirements\n- **FR-001**: The system MUST export CSV.\n- **FR-002**: The system MUST stream.\n- **FR-002**: duplicate\n';

function input(over: Partial<CheckInput>): CheckInput {
  return { artifacts: {}, declaredArtifacts: [], evidence: null, human_approved: false, params: {}, severity: 'blocker', requirements: [], ...over };
}

describe('extractRequirementIds', () => {
  it('extracts ids with 1-based line numbers', () => {
    expect(extractRequirementIds(spec, FR)).toEqual([{ id: 'FR-001', line: 2 }, { id: 'FR-002', line: 3 }, { id: 'FR-002', line: 4 }]);
  });
  it('supports line-anchored patterns and trims ids', () => {
    const md = '## ADDED Requirements\n\n### Requirement: CSV export  \nbody\n### Requirement: Streaming\n';
    expect(extractRequirementIds(md, String.raw`^###\s+Requirement:\s+(?<id>.+?)\s*$`)).toEqual([{ id: 'CSV export', line: 3 }, { id: 'Streaming', line: 5 }]);
  });
});

describe('requirement_ids', () => {
  it('reports duplicates at their line', () => {
    const f = requirementIds.run(input({ artifacts: { 'spec.md': spec }, params: { artifact: 'spec.md', id_regex: FR } }));
    expect(f).toEqual([{ check: 'requirement_ids', severity: 'blocker', location: 'spec.md:4', message: 'duplicate requirement id FR-002' }]);
  });
  it('blocks below min', () => {
    const f = requirementIds.run(input({ artifacts: { 'spec.md': '- **FR-001**: x\n' }, params: { artifact: 'spec.md', id_regex: FR, min: 2 } }));
    expect(f.map((x) => x.message)).toEqual(['found 1 requirement id(s) in spec.md, expected at least 2']);
  });
  it('is silent when the artifact is missing (missing_artifact reports it)', () => {
    expect(requirementIds.run(input({ params: { artifact: 'spec.md', id_regex: FR } }))).toEqual([]);
  });
  it('rejects an id_regex without a named id group, or one that does not compile', () => {
    const gate = (id_regex: string) => ({ transition: 'specify->plan', artifacts: ['spec.md'], checks: [{ name: 'requirement_ids', params: { artifact: 'spec.md', id_regex } }] });
    expect(validateGateDecl(gate('FR-\\d+'))[0]).toMatch(/invalid params: id_regex/);
    expect(validateGateDecl(gate('(?<id>['))[0]).toMatch(/invalid params: id_regex/);
    expect(validateGateDecl(gate(FR))).toEqual([]);
  });
});

describe('requirement_coverage', () => {
  it('reports uncovered requirements and unknown ids, case-insensitively', () => {
    const f = requirementCoverage.run(input({ requirements: ['FR-001', 'FR-002'], evidence: { implements: [' fr-001 ', 'FR-009'] } }));
    expect(f).toEqual([
      { check: 'requirement_coverage', severity: 'blocker', location: 'FR-002', message: 'FR-002 is not covered by evidence.implements' },
      { check: 'requirement_coverage', severity: 'warning', location: 'FR-009', message: 'FR-009 in evidence.implements is not a requirement of this feature' },
    ]);
  });
  it('honours a warning severity for uncovered requirements', () => {
    const f = requirementCoverage.run(input({ requirements: ['A'], evidence: {}, severity: 'warning' }));
    expect(f.map((x) => x.severity)).toEqual(['warning']);
  });
  it('warns once when nothing was captured', () => {
    const f = requirementCoverage.run(input({ requirements: [], evidence: { implements: ['FR-1'] } }));
    expect(f).toEqual([{ check: 'requirement_coverage', severity: 'warning', location: null, message: 'no requirements were captured for this feature; coverage not checked' }]);
  });
});
