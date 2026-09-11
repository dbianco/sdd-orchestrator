import { withTransaction } from '../db/pool.js';
import type { Finding, Phase, PhaseOrArchived } from '../domain/types.js';
import { isPhase } from '../domain/phases.js';
import { DomainError, firstByPrecedence } from '../errors.js';
import { runGate } from '../gates/run.js';
import { applyBackwardMove, isCycleMove } from '../lifecycle/cycles.js';
import { renderPhaseInstructions } from '../lifecycle/instructions.js';
import { allowedTargets, classifyMove, mandatesApproval } from '../lifecycle/reachability.js';
import { gateFor } from '../lifecycle/track.js';
import { requireFeature, updateFeature } from '../store/features.js';
import { currentFramework } from '../store/frameworks.js';
import { getPack, latestPack } from '../store/packs.js';
import { insertArtifacts, insertTransition, sha256 } from '../store/transitions.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface AdvancePhaseInput {
  feature_id: string; actor: string; expected_phase: Phase; target_phase: string; artifacts?: Record<string, string>; evidence?: unknown;
  human_approved?: boolean; cycle_failed?: boolean; pack_id?: string | null; reason?: string | null; repin?: boolean;
}
export interface AdvancePhaseResult { result: 'pass' | 'fail'; findings: Finding[]; next_instructions: string | null; feature: FeatureState; warnings: string[] }

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
      const outcome = runGate(gate, { artifacts, evidence: input.evidence ?? null, human_approved: input.human_approved ?? false }, mandated);
      for (const f of outcome.findings) deps.metrics?.gate(f.check, f.severity === 'blocker' ? 'fail' : 'pass');
      const transition = await insertTransition(tx, {
        feature_id: feature.id, from_phase: feature.current_phase, to_phase: target, direction, result: outcome.result, findings: outcome.findings,
        evidence: input.evidence ?? null, pack_id: packId, artifact_hashes: artifactHashes, human_approved: input.human_approved ?? false, reason: input.reason ?? null,
      }, input.actor);
      await insertArtifacts(tx, transition.id, artifacts, input.actor);
      if (outcome.result === 'fail') {
        const { state } = await featureState(tx, feature);
        return { result: 'fail', findings: outcome.findings, next_instructions: null, feature: state, warnings };
      }
      const updated = target === 'archived'
        ? await updateFeature(tx, feature.id, { status: 'archived' })
        : await updateFeature(tx, feature.id, { current_phase: target });
      const { state } = await featureState(tx, updated);
      const next = target === 'archived'
        ? `Feature ${feature.id} is archived. Its packs, transitions and artifacts remain readable through get_feature_status and get_context.`
        : renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: target, track_decl: track });
      return { result: 'pass', findings: outcome.findings, next_instructions: next, feature: state, warnings };
    }

    // backward
    const to = target as Phase;
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
      artifact_hashes: artifactHashes, human_approved: input.human_approved ?? false, reason: input.reason ?? null,
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
