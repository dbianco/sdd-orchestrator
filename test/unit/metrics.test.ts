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

  it('registers every metric named in the trust and traceability spec', async () => {
    const { registry, hooks } = createMetrics();
    hooks.authRejected('missing');
    hooks.approval('requested'); hooks.approval('approved', 120);
    hooks.ciEvidence('checkout');
    hooks.requirementsUncovered(2);
    const text = await registry.metrics();
    expect(text).toContain('sdd_auth_rejections_total{reason="missing"} 1');
    expect(text).toContain('sdd_approvals_total{decision="requested"} 1');
    expect(text).toContain('sdd_approvals_total{decision="approved"} 1');
    expect(text).toContain('sdd_approval_wait_seconds_count 1');
    expect(text).toContain('sdd_ci_evidence_total{app="checkout"} 1');
    expect(text).toContain('sdd_requirements_uncovered_total 2');
  });
});
