import { Counter, Histogram, Registry } from 'prom-client';
import type { MetricsHooks } from './services/deps.js';

export function createMetrics(): { registry: Registry; hooks: MetricsHooks } {
  const registry = new Registry();
  const routing = new Counter({ name: 'sdd_routing_decisions_total', help: 'Routing decisions by rule', labelNames: ['rule'], registers: [registry] });
  const gates = new Counter({ name: 'sdd_gate_results_total', help: 'Gate findings by check and result', labelNames: ['check', 'result'], registers: [registry] });
  const degraded = new Counter({ name: 'sdd_degraded_packs_total', help: 'Context packs built in degraded mode', registers: [registry] });
  const overBudget = new Counter({ name: 'sdd_over_budget_packs_total', help: 'Context packs whose fixed positions exceeded the budget', registers: [registry] });
  const authRejections = new Counter({ name: 'sdd_auth_rejections_total', help: 'Requests rejected for missing or invalid tokens; would_reject counts anonymous calls accepted in warn mode', labelNames: ['reason'], registers: [registry] });
  const approvals = new Counter({ name: 'sdd_approvals_total', help: 'Approval requests created and decided', labelNames: ['decision'], registers: [registry] });
  const approvalWait = new Histogram({ name: 'sdd_approval_wait_seconds', help: 'Time from approval request to decision', buckets: [60, 300, 900, 3600, 14400, 86400, 259200], registers: [registry] });
  const ciEvidence = new Counter({ name: 'sdd_ci_evidence_total', help: 'CI evidence reports received', labelNames: ['app'], registers: [registry] });
  const failedCycles = new Counter({ name: 'sdd_failed_cycles_total', help: 'verify->implement moves flagged cycle_failed', registers: [registry] });
  return {
    registry,
    hooks: {
      routed: (rule) => routing.inc({ rule }),
      gate: (check, result) => gates.inc({ check, result }),
      degradedPack: () => degraded.inc(),
      overBudgetPack: () => overBudget.inc(),
      failedCycle: () => failedCycles.inc(),
      authRejected: (reason) => authRejections.inc({ reason }),
      ciEvidence: (app) => ciEvidence.inc({ app }),
      approval: (event, waitSeconds) => { approvals.inc({ decision: event }); if (waitSeconds !== undefined) approvalWait.observe(waitSeconds); },
    },
  };
}
