import { describe, it, expect } from 'vitest';
import { GATE_LIBRARY, GATE_LIBRARY_VERSION, validateGateDecl } from '../../../src/gates/library.js';
import { runGate } from '../../../src/gates/run.js';

describe('library', () => {
  it('exposes exactly the spec checks', () => {
    expect(Object.keys(GATE_LIBRARY).sort()).toEqual([
      'delta_markers', 'human_approved', 'measurable_criteria', 'missing_artifact', 'placeholder_scan',
      'required_sections', 'scope_drift', 'task_done_checks', 'task_ordering', 'verify_evidence',
    ]);
    expect(GATE_LIBRARY_VERSION).toBe('1');
  });
  it('validates declarations', () => {
    expect(validateGateDecl({ transition: 'specify->implement', artifacts: ['a.md'], checks: [{ name: 'nope' }] })).toEqual(['unknown check "nope"']);
    expect(validateGateDecl({ transition: 'specify->implement', artifacts: ['a.md'], checks: [{ name: 'required_sections', params: { artifact: 'b.md', sections: ['X'] } }] })).toEqual(['check required_sections names artifact "b.md" which is not declared for the transition']);
    expect(validateGateDecl({ transition: 'specify->implement', artifacts: ['a.md'], checks: [{ name: 'required_sections', params: { artifact: 'a.md' } }] })[0]).toMatch(/invalid params/);
    expect(validateGateDecl({ transition: 'x', artifacts: [], checks: [{ name: 'verify_evidence' }] })).toEqual([]);
  });
});

describe('runGate', () => {
  const gate = { transition: 'specify->implement', artifacts: ['spec.md'], checks: [
    { name: 'placeholder_scan' },
    { name: 'required_sections', params: { artifact: 'spec.md', sections: ['Goal'] } },
    { name: 'scope_drift', params: { plan_artifact: 'spec.md', files_section: 'Goal' } },
  ] };
  it('passes with no gate and no mandated approval', () => {
    expect(runGate(null, { artifacts: {}, evidence: null, human_approved: false }, false)).toEqual({ result: 'pass', findings: [] });
  });
  it('runs missing_artifact implicitly and fails on blockers', () => {
    const r = runGate(gate, { artifacts: {}, evidence: null, human_approved: true }, false);
    expect(r.result).toBe('fail');
    expect(r.findings[0]).toMatchObject({ check: 'missing_artifact', location: 'spec.md' });
  });
  it('does not fail on warnings alone', () => {
    const r = runGate(gate, { artifacts: { 'spec.md': '## Goal\n- `a.ts`' }, evidence: { files_changed: ['b.ts'] }, human_approved: true }, false);
    expect(r.result).toBe('pass');
    expect(r.findings).toEqual([{ check: 'scope_drift', severity: 'warning', location: 'b.ts', message: 'b.ts is not listed in spec.md section "Goal"' }]);
  });
  it('adds the mandated human_approved check', () => {
    const r = runGate(gate, { artifacts: { 'spec.md': '## Goal\nx' }, evidence: null, human_approved: false }, true);
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([{ check: 'human_approved', severity: 'blocker', location: null, message: 'human approval is required for this transition' }]);
  });
  it('honours a track-level severity override', () => {
    const g = { ...gate, checks: [{ name: 'placeholder_scan', severity: 'warning' as const }] };
    const r = runGate(g, { artifacts: { 'spec.md': 'TODO' }, evidence: null, human_approved: true }, false);
    expect(r.result).toBe('pass');
    expect(r.findings[0]?.severity).toBe('warning');
  });
  it('does not duplicate the human_approved finding when the gate already declares it', () => {
    const g = { transition: 'specify->implement', artifacts: ['spec.md'], checks: [
      { name: 'human_approved' },
    ] };
    const r = runGate(g, { artifacts: { 'spec.md': 'x' }, evidence: null, human_approved: false }, true);
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([{ check: 'human_approved', severity: 'blocker', location: null, message: 'human approval is required for this transition' }]);
  });
  it('still mandates approval when the gate itself is null', () => {
    const r = runGate(null, { artifacts: {}, evidence: null, human_approved: false }, true);
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([{ check: 'human_approved', severity: 'blocker', location: null, message: 'human approval is required for this transition' }]);
  });
});
