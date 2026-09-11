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

describe('renderPhaseInstructions', () => {
  it('restates feature id, phase, alias and command', () => {
    const text = renderPhaseInstructions({ feature_id: 'f_1', framework: 'openspec', track: 'default', phase: 'specify', track_decl: track });
    expect(text).toContain('Feature: f_1');
    expect(text).toContain('Phase: specify (proposal)');
    expect(text).toContain('/openspec:proposal');
    expect(text).toContain('Keep the feature id f_1');
    expect(text).toContain('expected_phase: "specify"');
    expect(text).toContain('target_phase: "implement"');
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
});
