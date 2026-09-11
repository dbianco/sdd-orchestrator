import { describe, it, expect } from 'vitest';
import { createMetrics } from '../../src/metrics.js';

describe('metrics', () => {
  it('exposes the five counters in prometheus format', async () => {
    const { registry, hooks } = createMetrics();
    hooks.routed('10-brownfield-small-medium');
    hooks.gate('placeholder_scan', 'fail');
    hooks.degradedPack(); hooks.overBudgetPack(); hooks.failedCycle();
    const text = await registry.metrics();
    expect(text).toContain('sdd_routing_decisions_total{rule="10-brownfield-small-medium"} 1');
    expect(text).toContain('sdd_gate_results_total{check="placeholder_scan",result="fail"} 1');
    expect(text).toContain('sdd_degraded_packs_total 1');
    expect(text).toContain('sdd_over_budget_packs_total 1');
    expect(text).toContain('sdd_failed_cycles_total 1');
  });
});
