import { describe, it, expect } from 'vitest';
import { renderPhaseInstructions, renderNextGate } from '../../../src/lifecycle/instructions.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const track: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped', tasks: 'skipped', implement: { alias: 'apply' }, verify: {}, integrate: { alias: 'archive' }, learn: 'skipped',
  },
  gates: [{ transition: 'specify->implement', artifacts: ['proposal.md', 'spec.md'], checks: [
    { name: 'placeholder_scan' }, { name: 'required_sections', params: { artifact: 'proposal.md', sections: ['Why'] } },
  ] }],
};

// A track whose verify -> integrate gate declares verify_evidence, to prove the evidence
// hints are derived from the gate declaration, not from the phase name.
const trackWithVerifyEvidence: TrackDecl = {
  phases: {
    specify: { alias: 'proposal' }, plan: 'skipped', tasks: 'skipped',
    implement: { alias: 'apply' }, verify: {}, integrate: { alias: 'archive' }, learn: 'skipped',
  },
  gates: [{ transition: 'verify->integrate', artifacts: [], checks: [{ name: 'verify_evidence' }] }],
};

// A track whose verify -> integrate gate does NOT declare verify_evidence, to prove the
// absence of the check name (rather than the phase name) drives the absence of the hint.
const trackWithoutVerifyEvidence: TrackDecl = {
  phases: {
    specify: { alias: 'proposal' }, plan: 'skipped', tasks: 'skipped',
    implement: { alias: 'apply' }, verify: {}, integrate: { alias: 'archive' }, learn: 'skipped',
  },
  gates: [{ transition: 'verify->integrate', artifacts: [], checks: [{ name: 'human_approved' }] }],
};

describe('renderPhaseInstructions', () => {
  it('restates feature id, phase, alias and command', () => {
    const text = renderPhaseInstructions({ feature_id: 'f_1', framework: 'openspec', track: 'default', phase: 'specify', track_decl: track });
    expect(text).toContain('Feature: f_1');
    expect(text).toContain('Phase: specify (proposal)');
    expect(text).toContain('/openspec:proposal');
    expect(text).toContain('Keep the feature id f_1');
    expect(text).toContain('expected_phase: "specify"');
    expect(text).toContain('target_phase: "implement"');
    expect(text).toContain('After each commit, call record_commit with feature_id "f_1".');
  });
  it('hints that evidence is required when the forward gate declares verify_evidence', () => {
    const text = renderPhaseInstructions({ feature_id: 'f_1', framework: 'openspec', track: 'default', phase: 'verify', track_decl: trackWithVerifyEvidence });
    expect(text).toContain('This transition requires evidence');
    expect(text).toContain('verify_evidence');
  });
  it('does not hint about evidence when the forward gate does not declare verify_evidence', () => {
    const text = renderPhaseInstructions({ feature_id: 'f_1', framework: 'openspec', track: 'default', phase: 'verify', track_decl: trackWithoutVerifyEvidence });
    expect(text).not.toContain('This transition requires evidence');
  });
  it('does not hint about evidence for a phase whose forward gate has no gate at all', () => {
    const text = renderPhaseInstructions({ feature_id: 'f_1', framework: 'openspec', track: 'default', phase: 'implement', track_decl: track });
    expect(text).not.toContain('This transition requires evidence');
  });
});

describe('renderNextGate', () => {
  it('lists artifacts, checks and the approval mandate', () => {
    const text = renderNextGate(track, 'specify', false);
    expect(text).toContain('Next gate: specify -> implement');
    expect(text).toContain('Artifacts: proposal.md, spec.md');
    expect(text).toContain('placeholder_scan');
    expect(text).toContain('required_sections (artifact=proposal.md, sections=Why)');
    expect(text).toContain('Human approval: required');
  });
  it('describes the archive edge', () => {
    expect(renderNextGate(track, 'integrate', false)).toContain('Next gate: integrate -> archived');
  });
  it('includes the evidence schema hint when the gate declares verify_evidence, regardless of phase name', () => {
    const text = renderNextGate(trackWithVerifyEvidence, 'verify', false);
    expect(text).toContain('Evidence object shape:');
    expect(text).toContain('tests.command');
    expect(text).toContain("lint: 'pass' | 'fail'");
  });
  it('omits the evidence hint on a verify-phase gate that does not declare verify_evidence', () => {
    const text = renderNextGate(trackWithoutVerifyEvidence, 'verify', false);
    expect(text).not.toContain('Evidence object shape:');
  });
  it('includes the evidence hint on a non-verify phase whose gate declares verify_evidence', () => {
    const trackNonVerifyEvidence: TrackDecl = {
      ...track,
      gates: [{ transition: 'specify->implement', artifacts: [], checks: [{ name: 'verify_evidence' }] }],
    };
    const text = renderNextGate(trackNonVerifyEvidence, 'specify', false);
    expect(text).toContain('Next gate: specify -> implement');
    expect(text).toContain('Evidence object shape:');
  });
  it('threads the verify_evidence check params into the hint (refactor track extras)', () => {
    const refactorTrack: TrackDecl = {
      ...track,
      gates: [{ transition: 'verify->integrate', artifacts: [], checks: [{ name: 'verify_evidence', params: { max_existing_tests_modified: 0 } }] }],
    };
    const text = renderNextGate(refactorTrack, 'verify', false);
    expect(text).toContain('characterization_tests (must be non-empty)');
    expect(text).toContain('max 0 existing test file(s) modified');
  });
});
