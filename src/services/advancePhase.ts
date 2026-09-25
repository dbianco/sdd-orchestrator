import { withTransaction } from '../db/pool.js';
import type { Queryable } from '../db/pool.js';
import type { Finding, GateDecl, Phase, PhaseOrArchived, TrackDecl } from '../domain/types.js';
import { isPhase } from '../domain/phases.js';
import { DomainError, firstByPrecedence } from '../errors.js';
import { runGate } from '../gates/run.js';
import { applyBackwardMove, isCycleMove } from '../lifecycle/cycles.js';
import { renderPhaseInstructions } from '../lifecycle/instructions.js';
import { allowedTargets, classifyMove, mandatesApproval } from '../lifecycle/reachability.js';
import { gateFor } from '../lifecycle/track.js';
import { requireFeature, updateFeature } from '../store/features.js';
import type { FeatureRow } from '../store/rows.js';
import { currentFramework } from '../store/frameworks.js';
import { mergeEvidence, requiresCiEvidence } from '../gates/mergeEvidence.js';
import { createApproval, supersedePending } from '../store/approvals.js';
import { latestCiEvidenceSinceVerify, latestFeatureCommitSha } from '../store/ciEvidence.js';
import { currentPolicy } from '../store/policies.js';
import { getPack, latestPack } from '../store/packs.js';
import { insertArtifacts, insertTransition, sha256 } from '../store/transitions.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';
import { captureRequirements, requirementIdsFor } from './requirements.js';

export interface AdvancePhaseInput {
  feature_id: string; actor: string; expected_phase: Phase; target_phase: string; artifacts?: Record<string, string>; evidence?: unknown;
  human_approved?: boolean; cycle_failed?: boolean; pack_id?: string | null; reason?: string | null; repin?: boolean; dry_run?: boolean;
  token_id?: string | null;
}
export interface AdvancePhaseResult {
  result: 'pass' | 'fail' | 'awaiting_approval'; findings: Finding[]; next_instructions: string | null; feature: FeatureState; warnings: string[];
  approval_id?: string;
}

export const HUMAN_APPROVED_IGNORED = 'human_approved is ignored; approval is requested from a person on the server';

export function serverApprovals(deps: Pick<ServiceDeps, 'authMode'>): boolean {
  return (deps.authMode ?? 'off') !== 'off';
}

export function awaitingApprovalInstructions(featureId: string, from: string, to: string, approvalId: string): string {
  return [
    `The move ${from} -> ${to} for ${featureId} passed its checks and waits for a person.`,
    `Ask a reviewer to approve ${approvalId} in the admin UI (Approvals) or with \`sdd-admin approvals approve ${approvalId}\`.`,
    `Poll get_feature_status; do not start ${to} until current_phase is ${to}.`,
  ].join('\n');
}

// Moves a feature through a passing forward transition; shared by advance_phase and approval decisions.
export async function applyForwardMove(
  tx: Queryable, feature: FeatureRow, track: TrackDecl, target: PhaseOrArchived, gate: GateDecl | null,
  artifacts: Record<string, string>, transitionId: string, actor: string,
): Promise<{ state: FeatureState; next: string }> {
  await captureRequirements(tx, gate, artifacts, feature.id, transitionId, actor);
  const updated = target === 'archived'
    ? await updateFeature(tx, feature.id, { status: 'archived' })
    : await updateFeature(tx, feature.id, { current_phase: target });
  const { state } = await featureState(tx, updated);
  const next = target === 'archived'
    ? `Feature ${feature.id} is archived. Its packs, transitions and artifacts remain readable through get_feature_status and get_context.`
    : renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: target, track_decl: track });
  return { state, next };
}

// With auth on, CI evidence is merged into the verify evidence and, for compliance or high-risk work, required.
async function resolveEvidence(tx: Queryable, feature: FeatureRow, hostEvidence: unknown): Promise<{
  evidence: unknown; findings: Finding[]; sources: Record<string, 'ci' | 'host'> | null; ci_evidence_id: string | null;
}> {
  const app = (await tx.query<{ compliance: boolean }>('SELECT compliance FROM apps WHERE id = $1', [feature.app_id])).rows[0]!;
  const policy = await currentPolicy(tx, feature.app_id);
  const required = requiresCiEvidence({ compliance: app.compliance, high_risk: feature.high_risk, policyEvidence: policy?.policy.evidence });
  const ci = await latestCiEvidenceSinceVerify(tx, feature.id);
  const latestCommit = required && ci ? await latestFeatureCommitSha(tx, feature.id) : null;
  const merged = mergeEvidence(hostEvidence, ci ? { evidence: ci.evidence, commit_sha: ci.commit_sha } : null, { required, latestCommit });
  return { evidence: merged.evidence, findings: merged.findings, sources: merged.evidence ? merged.sources : null, ci_evidence_id: ci?.id ?? null };
}

export async function advancePhase(deps: ServiceDeps, input: AdvancePhaseInput): Promise<AdvancePhaseResult> {
  return withTransaction(deps.pool, async (tx) => {
    const feature = await requireFeature(tx, input.feature_id, { forUpdate: true });
    // Evaluation order differs from the plan's numbered ERROR_PRECEDENCE list:
    // FEATURE_NOT_FOUND/FEATURE_ARCHIVED/STALE_STATE are checked before any direction-dependent
    // VALIDATION_ERROR, because classifying the move direction (needed for the
    // reason/cycle_failed/repin checks) requires a non-stale, non-archived feature. This is
    // deliberate, not a bug — proposeMemory.ts is the service that follows the plan's literal
    // VALIDATION_ERROR-first ordering, since it has no such dependency.
    const errors: DomainError[] = [];
    if (feature.status === 'archived') errors.push(new DomainError('FEATURE_ARCHIVED', `feature ${feature.id} is archived`, { feature_id: feature.id }));
    if (feature.current_phase !== input.expected_phase) {
      errors.push(new DomainError('STALE_STATE', `expected_phase ${input.expected_phase} but the feature is in ${feature.current_phase}`, { current_phase: feature.current_phase }));
    }
    if (errors.length > 0) throw firstByPrecedence(errors);

    const { track } = await featureState(tx, feature);
    const direction = classifyMove(track, feature.current_phase, input.target_phase);
    if (!direction) {
      const targets = allowedTargets(track, feature.current_phase);
      throw new DomainError('PHASE_ORDER_VIOLATION', `cannot move from ${feature.current_phase} to ${input.target_phase}`, { forward: targets.forward, backward: targets.backward });
    }
    const target = input.target_phase as PhaseOrArchived;
    const validation = (msg: string, field: string) => new DomainError('VALIDATION_ERROR', msg, { field });
    if (direction === 'backward' && !input.reason) errors.push(validation('reason is required for backward moves', 'reason'));
    if (input.cycle_failed && !(direction === 'backward' && isPhase(target) && isCycleMove(feature.current_phase, target))) {
      errors.push(validation('cycle_failed is accepted only on the backward move from verify to implement', 'cycle_failed'));
    }
    if (input.repin && direction === 'forward') errors.push(validation('repin is accepted only on backward moves', 'repin'));
    if (input.dry_run && direction !== 'forward') errors.push(validation('dry_run is accepted only on forward moves', 'dry_run'));
    let packId: string | null = null;
    if (input.pack_id) {
      const pack = await getPack(tx, input.pack_id);
      if (!pack || pack.feature_id !== feature.id) errors.push(validation(`pack_id ${input.pack_id} does not belong to this feature`, 'pack_id'));
      else packId = pack.id;
    } else {
      packId = (await latestPack(tx, feature.id, feature.current_phase))?.id ?? null;
    }
    if (direction === 'forward' && feature.status === 'blocked') {
      errors.push(new DomainError('FEATURE_BLOCKED', `feature is blocked: ${feature.blocked_reason ?? 'no reason recorded'}`, { blocked_reason: feature.blocked_reason }));
    }
    if (errors.length > 0) throw firstByPrecedence(errors);

    const artifacts = input.artifacts ?? {};
    const artifactHashes = Object.fromEntries(Object.entries(artifacts).map(([n, c]) => [n, sha256(c)]));
    const warnings: string[] = [];

    if (direction === 'forward') {
      const gate = gateFor(track, feature.current_phase, target);
      const mandated = mandatesApproval(track, feature.current_phase, target, feature.high_risk);
      const requirements = await requirementIdsFor(tx, feature.id);
      const onServer = serverApprovals(deps);
      const needsApproval = mandated || (gate?.checks.some((c) => c.name === 'human_approved') ?? false);
      if (onServer && input.human_approved) warnings.push(HUMAN_APPROVED_IGNORED);
      const gateToRun = onServer && gate ? { ...gate, checks: gate.checks.filter((c) => c.name !== 'human_approved') } : gate;
      const humanApproved = onServer ? false : input.human_approved ?? false;
      const ev = onServer && gate?.checks.some((c) => c.name === 'verify_evidence')
        ? await resolveEvidence(tx, feature, input.evidence)
        : { evidence: input.evidence ?? null, findings: [] as Finding[], sources: null, ci_evidence_id: null };
      const gateOutcome = runGate(gateToRun, { artifacts, evidence: ev.evidence, human_approved: humanApproved, requirements }, onServer ? false : mandated);
      const allFindings = [...ev.findings, ...gateOutcome.findings];
      const outcome = { result: allFindings.some((f) => f.severity === 'blocker') ? 'fail' as const : 'pass' as const, findings: allFindings };
      const awaiting = onServer && needsApproval && outcome.result === 'pass';
      const result = awaiting ? 'awaiting_approval' : outcome.result;
      if (input.dry_run) {
        const { state } = await featureState(tx, feature);
        return { result, findings: outcome.findings, next_instructions: null, feature: state, warnings };
      }
      for (const f of outcome.findings) deps.metrics?.gate(f.check, f.severity === 'blocker' ? 'fail' : 'pass');
      const transition = await insertTransition(tx, {
        feature_id: feature.id, from_phase: feature.current_phase, to_phase: target, direction, result, findings: outcome.findings,
        evidence: ev.evidence, pack_id: packId, artifact_hashes: artifactHashes, human_approved: humanApproved, reason: input.reason ?? null, token_id: input.token_id ?? null,
        ci_evidence_id: ev.ci_evidence_id, evidence_sources: ev.sources,
      }, input.actor);
      await insertArtifacts(tx, transition.id, artifacts, input.actor);
      if (awaiting) {
        await supersedePending(tx, feature.id, input.actor);
        const approval = await createApproval(tx, { feature_id: feature.id, transition_id: transition.id, from_phase: feature.current_phase, to_phase: target }, input.actor);
        deps.metrics?.approval('requested');
        const { state } = await featureState(tx, feature);
        return {
          result: 'awaiting_approval', approval_id: approval.id, findings: outcome.findings, feature: state, warnings,
          next_instructions: awaitingApprovalInstructions(feature.id, feature.current_phase, target, approval.id),
        };
      }
      if (outcome.result === 'fail') {
        const { state } = await featureState(tx, feature);
        return { result: 'fail', findings: outcome.findings, next_instructions: null, feature: state, warnings };
      }
      const { state, next } = await applyForwardMove(tx, feature, track, target, gate, artifacts, transition.id, input.actor);
      return { result: 'pass', findings: outcome.findings, next_instructions: next, feature: state, warnings };
    }

    // backward
    const to = target as Phase;
    if (await supersedePending(tx, feature.id, input.actor) > 0) warnings.push('the pending approval request was superseded by this backward move');
    const cycle = applyBackwardMove({ failed_cycles: feature.failed_cycles, status: feature.status as 'active' | 'blocked' }, feature.current_phase, to, input.cycle_failed ?? false, input.reason!);
    if (input.cycle_failed) deps.metrics?.failedCycle();
    let packVersion = feature.framework_pack_version;
    if (input.repin) {
      const current = await currentFramework(tx, feature.framework);
      if (current && current.pack_version !== packVersion) { packVersion = current.pack_version; warnings.push(`repinned to ${feature.framework}@${packVersion}`); }
      else warnings.push('repin requested but the feature is already on the current version');
    }
    const transition = await insertTransition(tx, {
      feature_id: feature.id, from_phase: feature.current_phase, to_phase: to, direction, result: 'pass', findings: [], evidence: null, pack_id: packId,
      artifact_hashes: artifactHashes, human_approved: input.human_approved ?? false, reason: input.reason ?? null, token_id: input.token_id ?? null,
    }, input.actor);
    await insertArtifacts(tx, transition.id, artifacts, input.actor);
    const updated = await updateFeature(tx, feature.id, {
      current_phase: to, status: cycle.status, failed_cycles: cycle.failed_cycles,
      blocked_reason: cycle.status === 'blocked' ? (cycle.blocked_reason ?? feature.blocked_reason) : null, framework_pack_version: packVersion,
    });
    const { state, track: trackNow } = await featureState(tx, updated);
    if (cycle.blocked_now) warnings.push('feature is now blocked after three failed cycles; any backward move unblocks it');
    return { result: 'pass', findings: [], next_instructions: renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: to, track_decl: trackNow }), feature: state, warnings };
  });
}
