import { describe, it, expect } from 'vitest';
import { TrackDeclSchema, phaseOrder, gateFor, validateTrackShape } from '../../../src/lifecycle/track.js';
import { allowedTargets, mandatesApproval } from '../../../src/lifecycle/reachability.js';
import { validateGateDecl } from '../../../src/gates/library.js';
import { runGate } from '../../../src/gates/run.js';
import type { TrackDecl } from '../../../src/domain/types.js';

// Modeled on OpenSpec's `default` track shape (see test/unit/lifecycle/track.test.ts's
// `openspecDefault` fixture): specify (mandatory, mapped) -> plan/tasks skipped ->
// implement -> verify -> integrate (mandatory, mapped) -> learn skipped.
const openspecDefault: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped',
    tasks: 'skipped',
    implement: { alias: 'apply', command: '/openspec:apply', template: 'openspec.template.apply' },
    verify: { alias: 'verify', template: 'openspec.template.verify' },
    integrate: { alias: 'archive', command: '/openspec:archive', template: 'openspec.template.archive' },
    learn: 'skipped',
  },
  gates: [
    { transition: 'specify->implement', artifacts: ['proposal.md'], checks: [{ name: 'placeholder_scan' }] },
    { transition: 'verify->integrate', artifacts: [], checks: [{ name: 'verify_evidence' }] },
  ],
};

describe('gate library + lifecycle engine composed together', () => {
  it('parses a real track declaration and validates its shape and its gates', () => {
    const parsed = TrackDeclSchema.parse(openspecDefault);
    expect(validateTrackShape(parsed)).toEqual([]);
    expect(parsed.gates.flatMap((g) => validateGateDecl(g))).toEqual([]);
  });

  it('walks the full lifecycle end to end through real gate checks', () => {
    const parsed = TrackDeclSchema.parse(openspecDefault);
    expect(phaseOrder(parsed)).toEqual(['specify', 'implement', 'verify', 'integrate']);

    // specify -> implement: gate requires the proposal.md artifact and runs placeholder_scan.
    const specifyTarget = allowedTargets(parsed, 'specify').forward[0]!;
    expect(specifyTarget).toBe('implement');
    const specifyGate = gateFor(parsed, 'specify', specifyTarget);
    const specifyMandatedApproval = mandatesApproval(parsed, 'specify', specifyTarget, false);

    const cleanPass = runGate(
      specifyGate,
      { artifacts: { 'proposal.md': '## Why\nThis proposal describes a real change.' }, evidence: null, human_approved: true },
      specifyMandatedApproval,
    );
    expect(cleanPass.result).toBe('pass');

    // Same gate, same registry, but the artifact carries a placeholder marker: must fail
    // via the real placeholder_scan check (proves the check ran through the actual registry).
    const placeholderFail = runGate(
      specifyGate,
      { artifacts: { 'proposal.md': 'This proposal is still TBD.' }, evidence: null, human_approved: true },
      specifyMandatedApproval,
    );
    expect(placeholderFail.result).toBe('fail');
    expect(placeholderFail.findings).toContainEqual(expect.objectContaining({ check: 'placeholder_scan' }));

    // implement -> verify: no gate declared on this edge, so runGate(null, ...) passes trivially.
    const implementTarget = allowedTargets(parsed, 'implement').forward[0]!;
    expect(implementTarget).toBe('verify');
    const implementGate = gateFor(parsed, 'implement', implementTarget);
    expect(implementGate).toBeNull();
    expect(runGate(implementGate, { artifacts: {}, evidence: null, human_approved: false }, false)).toEqual({ result: 'pass', findings: [] });

    // verify -> integrate: gate requires verify_evidence.
    const verifyTarget = allowedTargets(parsed, 'verify').forward[0]!;
    expect(verifyTarget).toBe('integrate');
    const verifyGate = gateFor(parsed, 'verify', verifyTarget);
    const verifyMandatedApproval = mandatesApproval(parsed, 'verify', verifyTarget, false);
    // This fixture leaves spec_review unset (i.e. review is required right after `specify`,
    // not deferred to after `verify`), so approval is not mandated on this edge for a
    // non-high-risk change.
    expect(verifyMandatedApproval).toBe(false);

    const goodEvidence = {
      tests: { command: 'npm test', passed: 10, failed: 0 },
      lint: 'pass',
      security: { status: 'pass', new_high: 0, skipped_reason: null },
    };
    const verifyPass = runGate(verifyGate, { artifacts: {}, evidence: goodEvidence, human_approved: true }, verifyMandatedApproval);
    expect(verifyPass.result).toBe('pass');

    // Omitting evidence entirely on the same gate must fail via the real verify_evidence check.
    const verifyFail = runGate(verifyGate, { artifacts: {}, evidence: null, human_approved: true }, verifyMandatedApproval);
    expect(verifyFail.result).toBe('fail');
    expect(verifyFail.findings).toContainEqual(expect.objectContaining({ check: 'verify_evidence' }));
  });

  it('rejects a gate declaring an unknown check', () => {
    const badGate = { transition: 'specify->implement', artifacts: [], checks: [{ name: 'not_a_real_check' }] };
    const errors = validateGateDecl(badGate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContainEqual(expect.stringContaining('unknown check'));
  });
});
