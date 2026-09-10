import { describe, it, expect } from 'vitest';
import { route, parseFrameworkRef, type RouterInput } from '../../../src/router/router.js';
import { DomainError } from '../../../src/errors.js';

const frameworks = [
  { name: 'openspec', pack_version: '1.0.0', tracks: ['default', 'hotfix', 'refactor'] },
  { name: 'spec-kit', pack_version: '1.0.0', tracks: ['default', 'refactor'] },
  { name: 'bmad', pack_version: '1.0.0', tracks: ['quick', 'full'] },
  { name: 'kiro', pack_version: '1.0.0', tracks: ['default'] },
  { name: 'sdlc', pack_version: '1.0.0', tracks: ['default'] },
];

function input(over: Partial<RouterInput> = {}): RouterInput {
  return {
    task_description: 'Add CSV export to the orders page',
    workspace: { estimated_files: 4, paths_touched: ['src/orders/a.ts'], is_greenfield: false },
    framework_preference: null,
    policy: null,
    policy_version: null,
    app: { compliance: false, default_stack: ['typescript'] },
    frameworks,
    ...over,
  };
}

describe('parseFrameworkRef', () => {
  it('splits name and optional track', () => {
    expect(parseFrameworkRef('bmad')).toEqual({ name: 'bmad', track: null });
    expect(parseFrameworkRef('bmad:quick')).toEqual({ name: 'bmad', track: 'quick' });
  });
});

describe('route: rules in order', () => {
  it('rule 1: policy framework wins with high confidence and track from intent', () => {
    const out = route(input({ policy: { framework: 'openspec', path_rules: [], risk_paths: [] }, policy_version: 3,
      workspace: { intent: 'incident', estimated_files: 2 } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', track: 'hotfix', confidence: 'high', rule: '1-policy', policy_version: 3, framework_pack_version: '1.0.0', high_risk: true });
  });
  it('rule 1: policy path rule matches paths_touched', () => {
    const out = route(input({ policy: { framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: [] },
      workspace: { estimated_files: 4, paths_touched: ['src/payments/x.ts'] } }));
    expect(out.decision).toMatchObject({ framework: 'bmad', track: 'full', rule: '1-policy', high_risk: true });
    expect(out.decision.reasons.join(' ')).toContain('**/payments/**');
  });
  it('rule 1: policy naming a track uses it', () => {
    const out = route(input({ policy: { framework: 'bmad:quick', path_rules: [], risk_paths: [] } }));
    expect(out.decision).toMatchObject({ framework: 'bmad', track: 'quick' });
  });
  it('rule 1 and 2: unknown framework fails with UNKNOWN_FRAMEWORK', () => {
    expect(() => route(input({ policy: { framework: 'aiup', path_rules: [], risk_paths: [] } }))).toThrow(DomainError);
    try { route(input({ framework_preference: 'aiup' })); } catch (e) { expect((e as DomainError).code).toBe('UNKNOWN_FRAMEWORK'); }
  });
  it('rule 2: explicit preference with a warning when later rules differ', () => {
    const out = route(input({ framework_preference: 'spec-kit' }));
    expect(out.decision).toMatchObject({ framework: 'spec-kit', track: 'default', rule: '2-preference', confidence: 'high' });
    expect(out.decision.reasons.some((r) => r.includes('would have chosen openspec'))).toBe(true);
  });
  it('rule 2: BMAD preference defaults to full', () => {
    expect(route(input({ framework_preference: 'bmad' })).decision.track).toBe('full');
  });
  it('rule 3: spike returns none with guidance and no track', () => {
    const out = route(input({ task_description: 'Can we stream exports?' }));
    expect(out.decision).toMatchObject({ intent: 'spike', framework: 'none', track: null, rule: '3-spike', framework_pack_version: null });
    expect(out.guidance).toMatch(/prototype/i);
  });
  it('rule 4: trivial accepted when small, no risk, no compliance', () => {
    const out = route(input({ workspace: { intent: 'trivial', estimated_files: 1, paths_touched: ['src/a.ts'] } }));
    expect(out.decision).toMatchObject({ intent: 'trivial', framework: 'none', rule: '4-trivial' });
    expect(out.lite).toBe(true);
  });
  it('rule 4: trivial downgraded on size', () => {
    const out = route(input({ workspace: { intent: 'trivial', estimated_files: 8, is_greenfield: false } }));
    expect(out.decision.intent).toBe('feature');
    expect(out.decision.rule).toBe('10-brownfield-small-medium');
    expect(out.decision.reasons.some((r) => /trivial.*downgraded.*size/i.test(r))).toBe(true);
    expect(out.lite).toBe(false);
  });
  it('rule 4: trivial downgraded on risk path', () => {
    const out = route(input({ workspace: { intent: 'trivial', estimated_files: 1, paths_touched: ['src/auth/x.ts'], is_greenfield: false } }));
    expect(out.decision.intent).toBe('feature');
    expect(out.decision.high_risk).toBe(true);
    expect(out.decision.reasons.some((r) => /trivial.*downgraded.*risk/i.test(r))).toBe(true);
  });
  it('rule 4: trivial downgraded on compliance', () => {
    const out = route(input({ app: { compliance: true, default_stack: [] }, workspace: { intent: 'trivial', estimated_files: 1, is_greenfield: false } }));
    expect(out.decision.intent).toBe('feature');
    expect(out.decision.reasons.some((r) => /trivial.*downgraded.*compliance/i.test(r))).toBe(true);
  });
  it('rule 4: trivial in text is not honoured', () => {
    const out = route(input({ task_description: 'trivial: rename a variable' }));
    expect(out.decision.intent).toBe('feature');
  });
  it('rule 5: product routes to sdlc', () => {
    expect(route(input({ task_description: 'PRD for a new product' })).decision).toMatchObject({ framework: 'sdlc', track: 'default', rule: '5-product' });
  });
  it('rule 6: incident routes to openspec hotfix at any size and forces high_risk', () => {
    const out = route(input({ task_description: 'production is down', workspace: { estimated_files: 30 } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', track: 'hotfix', rule: '6-incident', high_risk: true });
  });
  it('rule 7 and 8: refactor by size', () => {
    expect(route(input({ task_description: 'refactor exports', workspace: { estimated_files: 5 } })).decision).toMatchObject({ framework: 'openspec', track: 'refactor', rule: '7-refactor-small-medium' });
    expect(route(input({ task_description: 'refactor exports', workspace: { estimated_files: 25 } })).decision).toMatchObject({ framework: 'spec-kit', track: 'refactor', rule: '8-refactor-large' });
  });
  it('rule 9: large with compliance or new subsystem routes to bmad with track by size', () => {
    expect(route(input({ app: { compliance: true, default_stack: [] }, workspace: { estimated_files: 25 } })).decision).toMatchObject({ framework: 'bmad', track: 'full', rule: '9-large-compliance-or-subsystem' });
    expect(route(input({ workspace: { estimated_files: 12, new_subsystem: true } })).decision).toMatchObject({ framework: 'bmad', track: 'quick' });
    expect(route(input({ workspace: { estimated_files: null, new_subsystem: true } })).decision).toMatchObject({ framework: 'bmad', track: 'full' });
  });
  it('rule 10: brownfield small or medium routes to openspec default', () => {
    expect(route(input()).decision).toMatchObject({ framework: 'openspec', track: 'default', rule: '10-brownfield-small-medium', confidence: 'high' });
  });
  it('rule 11: greenfield small/medium or any large routes to spec-kit default', () => {
    expect(route(input({ workspace: { estimated_files: 4, is_greenfield: true } })).decision).toMatchObject({ framework: 'spec-kit', track: 'default', rule: '11-greenfield-or-large' });
    expect(route(input({ workspace: { estimated_files: 40, is_greenfield: false } })).decision).toMatchObject({ framework: 'spec-kit', rule: '11-greenfield-or-large' });
  });
  it('rule 12: unknown greenfield yields medium confidence with questions', () => {
    const out = route(input({ workspace: { estimated_files: 4 } }));
    expect(out.decision).toMatchObject({ framework: 'spec-kit', confidence: 'medium', rule: '12-unknown' });
    expect(out.clarifying_questions.length).toBeGreaterThan(0);
    expect(out.clarifying_questions.length).toBeLessThanOrEqual(3);
  });
  it('rule 12: unknown size with spec library prefers openspec', () => {
    const out = route(input({ workspace: { has_spec_library: true } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', confidence: 'medium', rule: '12-unknown' });
  });
  it('remediation routes by size like a feature and keeps the intent', () => {
    const out = route(input({ task_description: 'Fix CVE-2026-1 in lodash' }));
    expect(out.decision).toMatchObject({ intent: 'remediation', framework: 'openspec', rule: '10-brownfield-small-medium' });
  });
  it('kiro is only reachable by rules 1 and 2', () => {
    const out = route(input({ framework_preference: 'kiro' }));
    expect(out.decision).toMatchObject({ framework: 'kiro', track: 'default' });
  });
  it('a deprecated framework (absent from the current list) fails on preference', () => {
    expect(() => route(input({ framework_preference: 'kiro', frameworks: frameworks.filter((f) => f.name !== 'kiro') }))).toThrow(/UNKNOWN_FRAMEWORK|no current version/);
  });
  it('names asserted facts in reasons', () => {
    const out = route(input());
    expect(out.decision.reasons.some((r) => r.includes('asserted by host'))).toBe(true);
  });
  it('sets high_risk from risk paths without changing the framework', () => {
    const out = route(input({ workspace: { estimated_files: 4, paths_touched: ['src/billing/x.ts'], is_greenfield: false } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', high_risk: true });
  });
});
