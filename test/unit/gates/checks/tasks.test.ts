import { describe, it, expect } from 'vitest';
import { taskDoneChecks, taskBlocks } from '../../../../src/gates/checks/taskDoneChecks.js';
import { taskOrdering } from '../../../../src/gates/checks/taskOrdering.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function input(md: string, params: Record<string, unknown>): CheckInput {
  return { artifacts: { 'tasks.md': md }, declaredArtifacts: [], evidence: null, human_approved: false, params: { artifact: 'tasks.md', ...params }, severity: 'blocker' };
}

describe('taskBlocks', () => {
  it('splits from one task match to the next', () => {
    const b = taskBlocks('intro\n- [ ] A\n  detail\n- [ ] B\n', /^- \[ \] /);
    expect(b.map((x) => [x.startLine, x.lines.length])).toEqual([[2, 2], [4, 2]]);
  });
});

describe('task_done_checks', () => {
  it('treats ticked tasks like open ones (issue #12)', () => {
    const f = taskDoneChecks.run(input('- [x] one (AC: 1)\n- [X] two\n- [ ] three (AC: 3)', { task_regex: '^- \\[[ xX]\\] ', done_regex: '\\(AC: \\d' }));
    expect(f.map((x) => x.location)).toEqual(['tasks.md:2']);
  });
  const params = { task_regex: '^- \\[ \\] ', done_regex: '\\(AC: \\d' };
  it('flags task blocks without a done match', () => {
    const f = taskDoneChecks.run(input('- [ ] one\n  (AC: 1)\n- [ ] two\n  nothing\n- [ ] three (AC: 2)', params));
    expect(f).toEqual([{ check: 'task_done_checks', severity: 'blocker', location: 'tasks.md:3', message: 'task "two" has no done check matching \\(AC: \\d' }]);
  });
  it('passes when every block matches', () => {
    expect(taskDoneChecks.run(input('- [ ] one (AC: 1)', params))).toEqual([]);
  });
});

describe('task_ordering', () => {
  const params = { task_regex: '^- \\[ \\] (?<id>T\\d+)', dep_regex: 'depends on (?<id>T\\d+)' };
  it('flags a dependency on a later or unknown task', () => {
    const f = taskOrdering.run(input('- [ ] T1 first, depends on T2\n- [ ] T2 second\n- [ ] T3 depends on T9', params));
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['tasks.md:1', 'task T1 depends on T2 which does not appear earlier'],
      ['tasks.md:3', 'task T3 depends on T9 which does not appear earlier'],
    ]);
  });
  it('passes when dependencies precede', () => {
    expect(taskOrdering.run(input('- [ ] T1 a\n- [ ] T2 b, depends on T1', params))).toEqual([]);
  });
  it('sees ticked tasks as earlier tasks (issue #12)', () => {
    const p = { task_regex: '^- \\[[ xX]\\] (?<id>T\\d+)', dep_regex: 'depends on (?<id>T\\d+)' };
    expect(taskOrdering.run(input('- [x] T3 Define the model (AC: R1)\n- [ ] T13 Build labels, depends on T3 (AC: R6)\n- [X] T14 done, depends on T13', p))).toEqual([]);
  });
  describe('lists of dependencies (issue #13)', () => {
    const list = { task_regex: '^- \\[[ xX]\\] (?<id>T\\d+)', dep_regex: 'depends on (?<ids>T\\d+(?:\\s*(?:,|and|&)\\s*(?:depends on\\s+)?T\\d+)*)', id_regex: 'T\\d+' };
    it('checks every id in a comma, "and" or repeated list', () => {
      const md = '- [ ] T1 First (AC: R1)\n- [ ] T2 Second, depends on T1, T99 (AC: R2)\n- [ ] T3 Third, depends on T1 and depends on T98 (AC: R3)\n- [ ] T4 Fourth, depends on T1 and T2 & T3\n- [ ] T5 Fifth, depends on T6, T7';
      expect(taskOrdering.run(input(md, list)).map((x) => [x.location, x.message])).toEqual([
        ['tasks.md:2', 'task T2 depends on T99 which does not appear earlier'],
        ['tasks.md:3', 'task T3 depends on T98 which does not appear earlier'],
        ['tasks.md:5', 'task T5 depends on T6 which does not appear earlier'],
        ['tasks.md:5', 'task T5 depends on T7 which does not appear earlier'],
      ]);
    });
    it('reports a repeated id once per task and passes valid lists', () => {
      expect(taskOrdering.run(input('- [ ] T1 a\n- [ ] T2 b\n- [ ] T3 c, depends on T1, T2 and depends on T1', list))).toEqual([]);
      expect(taskOrdering.run(input('- [ ] T1 a, depends on T9, T9 and depends on T9', list))).toHaveLength(1);
    });
    it('requires id_regex when dep_regex uses the ids group', () => {
      const r = taskOrdering.params.safeParse({ artifact: 'x', task_regex: '^- (?<id>T\\d+)', dep_regex: 'depends on (?<ids>T\\d+)' });
      expect(r.success).toBe(false);
    });
  });
  it('rejects regexes without an id group at parse time', () => {
    const result = taskOrdering.params.safeParse({ artifact: 'x', task_regex: '^- ', dep_regex: 'dep (?<id>T\\d+)' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toMatch(/named group "id"/);
  });
});
