import type { FeatureStatus } from '../domain/types.js';
import { requireApp } from '../store/apps.js';
import { listFeatures } from '../store/features.js';
import type { ServiceDeps } from './deps.js';

export interface ListFeaturesInput { app: string; status?: FeatureStatus[]; external_ref?: string | null; limit?: number }
export interface FeatureSummary {
  feature_id: string; slug: string; intent: string; framework: string; track: string | null; current_phase: string; status: string;
  external_ref: string | null; trigger_ref: string | null; updated_at: string;
}

export async function listFeaturesService(deps: ServiceDeps, input: ListFeaturesInput): Promise<{ features: FeatureSummary[] }> {
  const app = await requireApp(deps.pool, input.app);
  const rows = await listFeatures(deps.pool, app.id, input.status ?? ['active', 'blocked'], input.external_ref ?? null, input.limit ?? 50);
  return {
    features: rows.map((f) => ({
      feature_id: f.id, slug: f.slug, intent: f.intent, framework: f.framework, track: f.track, current_phase: f.current_phase, status: f.status,
      external_ref: f.external_ref, trigger_ref: f.trigger_ref, updated_at: f.updated_at.toISOString(),
    })),
  };
}
