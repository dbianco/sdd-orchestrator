import { describe, it, expect } from 'vitest';
import { EvalFileSchema, recallAt, reciprocalRank } from '../../../src/eval/run.js';

describe('eval metrics', () => {
  it('computes recall@k and reciprocal rank', () => {
    expect(recallAt(['a', 'b'], ['x', 'a'])).toBe(0.5);
    expect(recallAt(['a'], [])).toBe(0);
    expect(reciprocalRank(['a', 'b'], ['x', 'y', 'b', 'a'])).toBeCloseTo(1 / 3);
    expect(reciprocalRank(['a'], ['x'])).toBe(0);
  });
  it('validates case files strictly', () => {
    expect(() => EvalFileSchema.parse([{ query: 'q', phase: 'specify', framework: 'openspec', expect: [] }])).toThrow();
    expect(() => EvalFileSchema.parse([{ query: 'q', phase: 'nope', framework: 'openspec', expect: ['a'] }])).toThrow();
    expect(() => EvalFileSchema.parse([{ query: 'q', phase: 'specify', framework: 'openspec', expect: ['a'], typo: 1 }])).toThrow();
  });
});
