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
  it('rejects regexes without an id group at parse time', () => {
    expect(() => taskOrdering.params.parse({ artifact: 'x', task_regex: '^- ', dep_regex: 'dep (?<id>T\\d+)' })).toThrow(/named group "id"/);
  });
});
