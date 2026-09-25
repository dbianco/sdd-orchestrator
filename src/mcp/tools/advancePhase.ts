import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { advancePhase } from '../../services/advancePhase.js';
import { authorizeCall } from '../../auth/authorize.js';
import type { AuthContext } from '../../auth/context.js';
import { guarded } from '../encode.js';
import { ActorSchema, FeatureStateShape, FindingShape, PhaseSchema, WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerAdvancePhase(server: McpServer, deps: McpDeps, auth: AuthContext): void {
  server.registerTool('advance_phase', {
    title: 'Move a feature to the next or an earlier phase',
    description: [
      'Runs the deterministic gate checks declared by the pinned framework track for a forward move and records the transition, artifact hashes and artifact text; backward moves record a reason and run no checks.',
      'Use it when the current phase\'s artifacts are ready (forward) or when work must return to an earlier phase (backward). A gate failure is a normal result with result "fail" and findings, not an error.',
      'expected_phase must equal the current phase or the call fails with STALE_STATE. Evidence is required on the move out of verify. cycle_failed is accepted only on verify->implement.',
      'dry_run runs the same forward-move gate checks and returns result and findings without recording a transition, persisting artifacts, or moving the phase; use it to check evidence or artifacts before spending a real attempt. Accepted only on forward moves.',
      'Returns result, findings, next_instructions (on pass) and feature state.',
      'Example: advance_phase({"feature_id":"f_01j9...","actor":"daniel","expected_phase":"specify","target_phase":"implement","artifacts":{"proposal.md":"..."},"human_approved":true})',
    ].join(' '),
    inputSchema: {
      feature_id: z.string().min(1), actor: ActorSchema, expected_phase: PhaseSchema,
      target_phase: z.string().min(1).describe('A phase name or the literal "archived"'),
      artifacts: z.record(z.string()).optional().describe('Artifact name to content; the transition declares which names it needs'),
      evidence: z.record(z.unknown()).optional().describe('Verify evidence object (spec section 10.4); required out of verify'),
      human_approved: z.boolean().optional(), cycle_failed: z.boolean().optional(), pack_id: z.string().optional(),
      reason: z.string().min(1).optional().describe('Required for backward moves'), repin: z.boolean().optional(),
      dry_run: z.boolean().optional().describe('Evaluate gate checks without recording a transition; forward moves only'),
    },
    outputSchema: {
      result: z.enum(['pass', 'fail', 'awaiting_approval']), approval_id: z.string().optional(), findings: z.array(FindingShape), next_instructions: z.string().nullable(), feature: FeatureStateShape, warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'advance_phase', async () => {
    const a = await authorizeCall(deps.pool, auth, { featureId: args.feature_id }, args.actor, true);
    const raw = await advancePhase(deps, {
      token_id: a.token_id, feature_id: args.feature_id, actor: a.actor!, expected_phase: args.expected_phase, target_phase: args.target_phase, artifacts: args.artifacts,
      evidence: args.evidence, human_approved: args.human_approved, cycle_failed: args.cycle_failed, pack_id: args.pack_id ?? null, reason: args.reason ?? null, repin: args.repin,
      dry_run: args.dry_run,
    });
    const r = { ...raw, warnings: [...a.warnings, ...raw.warnings] };
    const text = r.result !== 'fail' && r.next_instructions ? r.next_instructions : JSON.stringify({ result: r.result, findings: r.findings, feature: r.feature, warnings: r.warnings }, null, 2);
    return { structured: { ...r }, text };
  }));
}
