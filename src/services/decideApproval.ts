import { withTransaction, type Queryable } from '../db/pool.js';
import type { Finding, PhaseOrArchived } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { gateFor } from '../lifecycle/track.js';
import { decideApproval, getApproval } from '../store/approvals.js';
import { requireFeature } from '../store/features.js';
import { currentPolicy } from '../store/policies.js';
import type { ApprovalRow, AppRow, FeatureRow, TransitionRow } from '../store/rows.js';
import { insertTransition } from '../store/transitions.js';
import { applyForwardMove } from './advancePhase.js';
import type { ServiceDeps } from './deps.js';
import { featureState, loadTrack, type FeatureState } from './featureState.js';

export interface DecisionInput { approval_id: string; actor: string; apps: string[] | null; token_id?: string | null }
export interface ApproveInput extends DecisionInput { comment?: string | null }
export interface RejectInput extends DecisionInput { reason: string }
export interface DecisionResult { approval: ApprovalRow; feature: FeatureState; next_instructions: string | null }

interface Locked { request: ApprovalRow; feature: FeatureRow; app: AppRow; awaiting: TransitionRow }

async function lockPending(tx: Queryable, input: DecisionInput): Promise<Locked> {
  const request = await getApproval(tx, input.approval_id, { forUpdate: true });
  if (!request) throw new DomainError('APPROVAL_NOT_FOUND', `no approval request with id "${input.approval_id}"`, { approval_id: input.approval_id });
  const feature = await requireFeature(tx, request.feature_id, { forUpdate: true });
  const app = (await tx.query<AppRow>('SELECT * FROM apps WHERE id = $1', [feature.app_id])).rows[0]!;
  if (input.apps && !input.apps.includes(feature.app_id)) {
    throw new DomainError('FORBIDDEN', `this token is not allowed for app ${app.slug}`, { app: app.slug });
  }
  if (request.status !== 'pending') {
    throw new DomainError('APPROVAL_NOT_PENDING', `approval request ${request.id} is ${request.status}`, { approval_id: request.id, status: request.status });
  }
  if (feature.status === 'archived') throw new DomainError('FEATURE_ARCHIVED', `feature ${feature.id} is archived`, { feature_id: feature.id });
  if (feature.current_phase !== request.from_phase) {
    throw new DomainError('STALE_STATE', `the request is for ${request.from_phase} but the feature is in ${feature.current_phase}`, { current_phase: feature.current_phase });
  }
  const awaiting = (await tx.query<TransitionRow>('SELECT * FROM phase_transitions WHERE id = $1', [request.transition_id])).rows[0]!;
  return { request, feature, app, awaiting };
}

export async function requiresDistinctApprover(q: Queryable, app: AppRow, feature: FeatureRow): Promise<boolean> {
  if (app.compliance || feature.high_risk) return true;
  return (await currentPolicy(q, app.id))?.policy.approval?.distinct_approver ?? false;
}

function waitSeconds(request: ApprovalRow): number {
  return (Date.now() - request.created_at.getTime()) / 1000;
}

export async function approveRequest(deps: ServiceDeps, input: ApproveInput): Promise<DecisionResult> {
  return withTransaction(deps.pool, async (tx) => {
    const { request, feature, app, awaiting } = await lockPending(tx, input);
    if (input.actor === request.requested_by && await requiresDistinctApprover(tx, app, feature)) {
      throw new DomainError('FORBIDDEN', 'approver must differ from requester', { requested_by: request.requested_by });
    }
    const artifacts = Object.fromEntries((await tx.query<{ name: string; content: string | null }>(
      'SELECT name, content FROM feature_artifacts WHERE transition_id = $1', [awaiting.id],
    )).rows.filter((a) => a.content !== null).map((a) => [a.name, a.content!]));
    const track = await loadTrack(tx, feature);
    const target = request.to_phase as PhaseOrArchived;
    const transition = await insertTransition(tx, {
      feature_id: feature.id, from_phase: request.from_phase, to_phase: request.to_phase, direction: 'forward', result: 'pass',
      findings: awaiting.findings, evidence: awaiting.evidence, pack_id: awaiting.pack_id, artifact_hashes: awaiting.artifact_hashes,
      human_approved: true, reason: input.comment ?? null, token_id: input.token_id ?? null, approval_id: request.id, approved_by: input.actor,
      ci_evidence_id: awaiting.ci_evidence_id, evidence_sources: awaiting.evidence_sources,
    }, input.actor);
    const approval = await decideApproval(tx, request.id, { status: 'approved', decided_by: input.actor, comment: input.comment ?? null });
    const { state, next } = await applyForwardMove(tx, feature, track, target, gateFor(track, feature.current_phase, target), artifacts, transition.id, input.actor);
    deps.metrics?.approval('approved', waitSeconds(request));
    return { approval, feature: state, next_instructions: next };
  });
}

export async function rejectRequest(deps: ServiceDeps, input: RejectInput): Promise<DecisionResult> {
  return withTransaction(deps.pool, async (tx) => {
    const { request, feature, awaiting } = await lockPending(tx, input);
    const rejection: Finding = { check: 'human_approved', severity: 'blocker', location: null, message: `rejected by ${input.actor}: ${input.reason}` };
    await insertTransition(tx, {
      feature_id: feature.id, from_phase: request.from_phase, to_phase: request.to_phase, direction: 'forward', result: 'fail',
      findings: [...awaiting.findings, rejection], evidence: awaiting.evidence, pack_id: awaiting.pack_id, artifact_hashes: awaiting.artifact_hashes,
      human_approved: false, reason: input.reason, token_id: input.token_id ?? null, approval_id: request.id,
      ci_evidence_id: awaiting.ci_evidence_id, evidence_sources: awaiting.evidence_sources,
    }, input.actor);
    const approval = await decideApproval(tx, request.id, { status: 'rejected', decided_by: input.actor, comment: input.reason });
    const { state } = await featureState(tx, feature);
    deps.metrics?.approval('rejected', waitSeconds(request));
    return { approval, feature: state, next_instructions: null };
  });
}
