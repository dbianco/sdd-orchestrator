import { describe, it, expect } from 'vitest';
import { bashWriteTargets, decideEdit, isSpecPath } from '../hooks/lib/decide.mjs';

const cfg = (enforcement = 'block') => ({ app: 'checkout', enforcement });
const feature = (over = {}) => ({ feature_id: 'f_1', current_phase: 'implement', status: 'active', pending_approval: null, ...over });

describe('isSpecPath', () => {
  it.each(['openspec/changes/x/proposal.md', 'specs/001/spec.md', '.specify/memory/constitution.md', '_bmad-output/prd.md', '.kiro/specs/a/requirements.md', '.sdlc/prd.md', 'docs/adr/0001.md'])('%s is a spec path', (p) => {
    expect(isSpecPath(p)).toBe(true);
  });
  it.each(['src/a.ts', 'docs/diagram.png', 'README.md', 'openspecx/a.md'])('%s is not', (p) => {
    expect(isSpecPath(p)).toBe(false);
  });
});

describe('decideEdit', () => {
  it('denies code edits when nothing is routed, and allows spec paths', () => {
    const d = decideEdit({ state: null, config: cfg(), relPath: 'src/a.ts', branch: 'main' });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/route_task/);
    expect(decideEdit({ state: null, config: cfg(), relPath: 'docs/notes.md', branch: 'main' }).allow).toBe(true);
  });
  it('allows everything after a trivial or spike routing', () => {
    for (const intent of ['trivial', 'spike']) {
      expect(decideEdit({ state: { routing_id: 'r_1', intent, lite: intent === 'trivial' }, config: cfg(), relPath: 'src/a.ts', branch: 'main' }).allow).toBe(true);
    }
  });
  it('keeps a routed feature intent to spec paths until start_feature', () => {
    expect(decideEdit({ state: { routing_id: 'r_1', intent: 'feature', lite: false }, config: cfg(), relPath: 'src/a.ts', branch: 'main' }).reason).toMatch(/start_feature/);
  });
  it.each(['specify', 'plan', 'tasks'])('limits a feature in %s to spec paths', (phase) => {
    const d = decideEdit({ state: feature({ current_phase: phase }), config: cfg(), relPath: 'src/a.ts', branch: 'main' });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/advance_phase/);
    expect(decideEdit({ state: feature({ current_phase: phase }), config: cfg(), relPath: 'openspec/x.md', branch: 'main' }).allow).toBe(true);
  });
  it.each(['implement', 'verify', 'integrate', 'learn'])('allows code in %s', (phase) => {
    expect(decideEdit({ state: feature({ current_phase: phase }), config: cfg(), relPath: 'src/a.ts', branch: 'main' }).allow).toBe(true);
  });
  it('limits blocked features and pending approvals to spec paths, naming the approval', () => {
    const pending = decideEdit({ state: feature({ pending_approval: { approval_id: 'ap_1', to: 'integrate' } }), config: cfg(), relPath: 'src/a.ts', branch: 'main' });
    expect(pending.reason).toMatch(/ap_1/);
    const blocked = decideEdit({ state: feature({ status: 'blocked', blocked_reason: 'three failed cycles' }), config: cfg(), relPath: 'src/a.ts', branch: 'main' });
    expect(blocked.reason).toMatch(/three failed cycles/);
  });
  it('never allows .sdd/, even in warn or off', () => {
    for (const e of ['block', 'warn', 'off']) {
      const d = decideEdit({ state: feature(), config: cfg(e), relPath: '.sdd/state.json', branch: 'main' });
      expect(d.allow).toBe(false);
    }
  });
  it('turns denials into warnings in warn mode and allows everything in off', () => {
    const w = decideEdit({ state: null, config: cfg('warn'), relPath: 'src/a.ts', branch: 'main' });
    expect(w).toMatchObject({ allow: true, warning: expect.stringMatching(/route_task/) });
    expect(decideEdit({ state: null, config: cfg('off'), relPath: 'src/a.ts', branch: 'main' })).toEqual({ allow: true });
  });
});

describe('bashWriteTargets', () => {
  it('finds redirection and tee targets', () => {
    expect(bashWriteTargets('echo x > src/a.ts && cat y | tee -a b.txt')).toEqual(['src/a.ts', 'b.txt']);
    expect(bashWriteTargets('npm test 2>&1 | head')).toEqual([]);
    expect(bashWriteTargets('echo hi >> "notes/log.md"')).toEqual(['notes/log.md']);
    expect(bashWriteTargets('cmd > /dev/null')).toEqual([]);
  });
});
