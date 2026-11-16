import { describe, it, expect } from 'vitest';
import { validateGateDecl } from '../../../src/gates/library.js';
import { regexError } from '../../../src/gates/regex.js';
import { hintFor } from '../../../src/gates/hints.js';
import { GATE_MISCONFIGURED, runGate } from '../../../src/gates/run.js';

const gate = (name: string, params: Record<string, unknown>) => ({ transition: 'tasks->implement', artifacts: ['tasks.md'], checks: [{ name, params }] });
const TASK = String.raw`^- \[[ xX]\] (?<id>T\d+)`;

describe('regexError', () => {
  it('is null for a pattern that compiles and the reason otherwise', () => {
    expect(regexError(TASK)).toBeNull();
    expect(regexError('(?<id>T')).toBe('/(?<id>T/: Unterminated group');
    expect(regexError('*R', 'g')).toBe('/*R/g: Nothing to repeat');
  });
});

describe('regex gate params', () => {
  it.each([
    ['task_done_checks', { artifact: 'tasks.md', task_regex: '[', done_regex: 'Done:' }, 'task_regex'],
    ['task_done_checks', { artifact: 'tasks.md', task_regex: TASK, done_regex: '(?<x' }, 'done_regex'],
    ['task_ordering', { artifact: 'tasks.md', task_regex: '(?<id>T\\d+', dep_regex: 'after (?<id>T\\d+)' }, 'task_regex'],
    ['task_ordering', { artifact: 'tasks.md', task_regex: TASK, dep_regex: 'after (?<id>T\\d+' }, 'dep_regex'],
    ['task_ordering', { artifact: 'tasks.md', task_regex: TASK, dep_regex: 'after (?<ids>.+)', id_regex: '+T' }, 'id_regex'],
    ['artifact_traceability', { artifact: 'tasks.md', task_regex: '(?<id>T\\d+))', ref_regex: '(?<id>R\\d+)' }, 'task_regex'],
    ['artifact_traceability', { artifact: 'tasks.md', task_regex: TASK, ref_regex: '(?<id>R\\d+)[' }, 'ref_regex'],
    ['artifact_traceability', { artifact: 'tasks.md', task_regex: TASK, ref_regex: '(?<ids>.+)', id_regex: '*R' }, 'id_regex'],
    ['requirement_ids', { artifact: 'tasks.md', id_regex: '(?<id>FR-\\d+' }, 'id_regex'],
    ['placeholder_scan', { markers: ['TODO', '[unclosed'] }, 'markers.1'],
  ])('%s rejects a %s that does not compile, naming the field', (name, params, field) => {
    const errors = validateGateDecl(gate(name, params));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(new RegExp(`^check ${name} has invalid params: ${field.replace('.', '\\.')} is not a valid regular expression: /.+/g?m?: .+$`));
  });
  it('reports only the compile error for a broken pattern, not the missing-group rule as well', () => {
    expect(validateGateDecl(gate('task_ordering', { artifact: 'tasks.md', task_regex: TASK, dep_regex: '(' })))
      .toEqual(['check task_ordering has invalid params: dep_regex is not a valid regular expression: /(/g: Unterminated group']);
  });
  it('still reports a missing named group on a pattern that compiles', () => {
    expect(validateGateDecl(gate('artifact_traceability', { artifact: 'tasks.md', task_regex: 'T\\d+', ref_regex: '(?<id>R\\d+)' })))
      .toEqual(['check artifact_traceability has invalid params: task_regex must contain named group "id"']);
    expect(validateGateDecl(gate('task_ordering', { artifact: 'tasks.md', task_regex: TASK, dep_regex: 'after (?<ids>.+)' })))
      .toEqual(['check task_ordering has invalid params: id_regex is required when dep_regex uses group "ids"']);
  });
  it('accepts the patterns the bundled packs use', () => {
    expect(validateGateDecl(gate('artifact_traceability', { artifact: 'tasks.md', task_regex: TASK, ref_regex: String.raw`\(AC:\s*(?<ids>R\d+(?:\s*,\s*R\d+)*)\)`, id_regex: String.raw`R\d+` }))).toEqual([]);
    expect(validateGateDecl(gate('placeholder_scan', { markers: ['\\bTBD\\b', 'NEEDS HUMAN INPUT'] }))).toEqual([]);
  });
});

describe('runGate with a pack ingested before its params were validated', () => {
  const g = gate('task_done_checks', { artifact: 'tasks.md', task_regex: '[', done_regex: 'Done:' });
  const ctx = { artifacts: { 'tasks.md': '- [ ] T1 do it\n' }, evidence: null, human_approved: true, pack: 'mini@1.0.0' };
  it('blocks the move with a finding instead of throwing a SyntaxError', () => {
    const run = () => runGate(g, ctx, false);
    expect(run).not.toThrow();
    expect(run()).toEqual({
      result: 'fail',
      findings: [{
        check: 'gate_misconfigured', severity: 'blocker', location: 'task_done_checks',
        message: 'check task_done_checks in framework pack mini@1.0.0 cannot run: task_regex is not a valid regular expression: /[/: Unterminated character class. '
          + 'This is not a problem with the artifacts: an admin must fix the pack and re-ingest the same version (sdd-admin ingest), which repairs this feature in place; then retry the move',
      }],
    });
  });
  it('reports under its own check, so the hint is about the pack rather than the broken check', () => {
    const [f] = runGate(g, ctx, false).findings;
    expect(f?.check).toBe(GATE_MISCONFIGURED);
    expect(hintFor(f!.check)?.title).toBe('Framework pack gate is misconfigured');
    expect(hintFor(f!.check)?.fix).toMatch(/re-ingest the same pack version/);
    expect(hintFor(f!.check)?.fix).not.toMatch(/repin|backward/);
    expect(hintFor(f!.check)).not.toEqual(hintFor('task_done_checks'));
  });
  it('does not tell anyone to make a backward move, which a feature in its first phase cannot do', () => {
    expect(runGate(g, ctx, false).findings[0]?.message).not.toMatch(/repin|backward/);
  });
  it('names the pack generically when the caller does not say which one', () => {
    expect(runGate(g, { ...ctx, pack: undefined }, false).findings[0]?.message).toMatch(/^check task_done_checks in the framework pack cannot run: /);
  });
  it('keeps running the other checks of the gate', () => {
    const g = { transition: 'tasks->implement', artifacts: ['tasks.md'], checks: [
      { name: 'placeholder_scan', params: { markers: ['('] } },
      { name: 'required_sections', params: { artifact: 'tasks.md', sections: ['Tasks'] } },
    ] };
    const r = runGate(g, { artifacts: { 'tasks.md': '# x\n' }, evidence: null, human_approved: true }, false);
    expect(r.findings.map((f) => [f.check, f.location])).toEqual([['gate_misconfigured', 'placeholder_scan'], ['required_sections', 'tasks.md']]);
  });
});
