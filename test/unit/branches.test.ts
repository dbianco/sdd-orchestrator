import { describe, it, expect } from 'vitest';
import { describeDegraded, failedReason, worstReason } from '../../src/assembler/degraded.js';
import { compareSemver } from '../../src/store/frameworks.js';
import { taskOrdering } from '../../src/gates/checks/taskOrdering.js';

describe('degraded retrieval reasons', () => {
  it('describes every kind, including the generic fallback and non-Error failures', () => {
    expect(describeDegraded({ kind: 'no_query' }, 'Effect.')).toBe('retrieval skipped: there was no task or focus text to search for. Effect.');
    expect(describeDegraded(null, 'Effect.')).toContain('embedding provider unavailable');
    expect(describeDegraded({ kind: 'not_configured' }, 'E.')).toContain('off by configuration');
    const fake = { provider: 'ollama', model: 'm' } as never;
    expect(failedReason(fake, 'plain text')).toEqual({ kind: 'failed', provider: 'ollama', model: 'm', message: 'plain text' });
    expect(failedReason(fake, new Error('boom'))).toMatchObject({ message: 'boom' });
  });

  it('prefers a runtime failure over configuration over an empty query', () => {
    const failed = { kind: 'failed', provider: 'p', model: 'm', message: 'x' } as const;
    expect(worstReason(null, null)).toBeNull();
    expect(worstReason({ kind: 'no_query' }, { kind: 'not_configured' })).toEqual({ kind: 'not_configured' });
    expect(worstReason({ kind: 'not_configured' }, failed)).toBe(failed);
    expect(worstReason(failed, { kind: 'no_query' })).toBe(failed);
  });
});

describe('small helpers', () => {
  it('compares versions of different lengths and ignores non-numeric parts', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('x.y', '0.0')).toBe(0);
  });
});

describe('task_ordering edge cases', () => {
  const input = (md: string | undefined, params: Record<string, unknown>) => ({ artifacts: (md === undefined ? {} : { 'tasks.md': md }) as Record<string, string>, declaredArtifacts: [], evidence: null, human_approved: false, params: { artifact: 'tasks.md', ...params }, severity: 'blocker' as const });

  it('skips a missing artifact and tasks without an id group match', () => {
    expect(taskOrdering.run(input(undefined, { task_regex: '^- (?<id>T\\d+)', dep_regex: 'depends on (?<id>T\\d+)' }))).toEqual([]);
    const optional = { task_regex: '^- \\[ \\] (?<id>T\\d+)?', dep_regex: 'depends on(?: (?<ids>T\\d+))?', id_regex: 'T\\d+' };
    // a task line whose id group did not participate is reported as "?", and a bare "depends on" cites nothing
    expect(taskOrdering.run(input('- [ ] no id, depends on T7\n- [ ] T2 two, depends on', optional)).map((f) => f.message)).toEqual(['task ? depends on T7 which does not appear earlier']);
  });
});
