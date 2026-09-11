import { Counter, Registry } from 'prom-client';
import type { MetricsHooks } from './services/deps.js';

export function createMetrics(): { registry: Registry; hooks: MetricsHooks } {
  const registry = new Registry();
  const routing = new Counter({ name: 'sdd_routing_decisions_total', help: 'Routing decisions by rule', labelNames: ['rule'], registers: [registry] });
  const gates = new Counter({ name: 'sdd_gate_results_total', help: 'Gate findings by check and result', labelNames: ['check', 'result'], registers: [registry] });
  const degraded = new Counter({ name: 'sdd_degraded_packs_total', help: 'Context packs built in degraded mode', registers: [registry] });
  const overBudget = new Counter({ name: 'sdd_over_budget_packs_total', help: 'Context packs whose fixed positions exceeded the budget', registers: [registry] });
  const failedCycles = new Counter({ name: 'sdd_failed_cycles_total', help: 'verify->implement moves flagged cycle_failed', registers: [registry] });
  return {
    registry,
    hooks: {
      routed: (rule) => routing.inc({ rule }),
      gate: (check, result) => gates.inc({ check, result }),
      degradedPack: () => degraded.inc(),
      overBudgetPack: () => overBudget.inc(),
      failedCycle: () => failedCycles.inc(),
    },
  };
}
