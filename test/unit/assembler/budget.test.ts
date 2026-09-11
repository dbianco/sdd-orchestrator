import { describe, it, expect } from 'vitest';
import { trimToBudget } from '../../../src/assembler/budget.js';

const c = (tokens: number, score: number, id: string) => ({ tokens, score, id });

describe('trimToBudget', () => {
  it('keeps everything under budget', () => {
    const r = trimToBudget(100, [c(50, 0.9, 'r1')], [c(50, 0.5, 's1')], 300);
    expect(r).toMatchObject({ over_budget: false, dropped_stack: 0, dropped_retrieved: 0 });
    expect(r.retrieved.map((x) => x.id)).toEqual(['r1']);
  });
  it('drops stack chunks first, lowest score first', () => {
    const r = trimToBudget(100, [c(50, 0.9, 'r1')], [c(50, 0.7, 's1'), c(50, 0.4, 's2')], 210);
    expect(r.stack.map((x) => x.id)).toEqual(['s1']);
    expect(r.dropped_stack).toBe(1);
    expect(r.retrieved).toHaveLength(1);
  });
  it('then drops retrieved chunks lowest score first', () => {
    const r = trimToBudget(100, [c(50, 0.9, 'r1'), c(50, 0.6, 'r2')], [c(50, 0.7, 's1')], 160);
    expect(r.stack).toEqual([]);
    expect(r.retrieved.map((x) => x.id)).toEqual(['r1']);
    expect(r.dropped_retrieved).toBe(1);
  });
  it('flags over budget when fixed positions alone exceed it and keeps everything', () => {
    const r = trimToBudget(400, [c(10, 0.9, 'r1')], [c(10, 0.5, 's1')], 300);
    expect(r.over_budget).toBe(true);
    expect(r.retrieved).toHaveLength(1);
    expect(r.stack).toHaveLength(1);
  });
});
