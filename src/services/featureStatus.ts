import { requireFeature } from '../store/features.js';
import { latestPackPerPhase } from '../store/packs.js';
import { listTransitions } from '../store/transitions.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface TransitionSummary {
  id: string; from_phase: string; to_phase: string; direction: string; result: string; human_approved: boolean; reason: string | null;
  created_by: string; created_at: string; findings_count: number;
}
export interface FeatureStatusResult extends FeatureState { transitions: TransitionSummary[]; latest_pack_per_phase: Record<string, string> }

export async function getFeatureStatus(deps: ServiceDeps, featureId: string): Promise<FeatureStatusResult> {
  const q = deps.pool;
  const feature = await requireFeature(q, featureId);
  const { state } = await featureState(q, feature);
  const transitions = (await listTransitions(q, feature.id)).map((t) => ({
    id: t.id, from_phase: t.from_phase, to_phase: t.to_phase, direction: t.direction, result: t.result, human_approved: t.human_approved,
    reason: t.reason, created_by: t.created_by, created_at: t.created_at.toISOString(), findings_count: t.findings.length,
  }));
  return { ...state, transitions, latest_pack_per_phase: await latestPackPerPhase(q, feature.id) };
}
