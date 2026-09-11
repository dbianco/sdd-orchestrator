import type { Queryable } from '../db/pool.js';
import type { TrackDecl } from '../domain/types.js';
import { allowedTargets } from '../lifecycle/reachability.js';
import { phaseAlias } from '../lifecycle/track.js';
import { getFrameworkVersion, trackOf } from '../store/frameworks.js';
import type { FeatureRow } from '../store/rows.js';

export interface FeatureState {
  feature_id: string; app: string; slug: string; intent: string; framework: string; framework_pack_version: string; track: string | null;
  current_phase: string; phase_alias: string; status: string; blocked_reason: string | null; high_risk: boolean; failed_cycles: number;
  external_ref: string | null; trigger_ref: string | null; allowed_targets: { forward: string[]; backward: string[] };
}

export async function loadTrack(q: Queryable, feature: FeatureRow): Promise<TrackDecl> {
  const fw = await getFrameworkVersion(q, feature.framework, feature.framework_pack_version);
  if (!fw) throw new Error(`pinned framework ${feature.framework}@${feature.framework_pack_version} is missing`);
  return trackOf(fw, feature.track);
}

export async function featureState(q: Queryable, feature: FeatureRow): Promise<{ state: FeatureState; track: TrackDecl }> {
  const track = await loadTrack(q, feature);
  const app = (await q.query<{ slug: string }>('SELECT slug FROM apps WHERE id = $1', [feature.app_id])).rows[0]!;
  const targets = feature.status === 'archived' ? { forward: [], backward: [] } : allowedTargets(track, feature.current_phase);
  return {
    track,
    state: {
      feature_id: feature.id, app: app.slug, slug: feature.slug, intent: feature.intent, framework: feature.framework,
      framework_pack_version: feature.framework_pack_version, track: feature.track, current_phase: feature.current_phase,
      phase_alias: phaseAlias(track, feature.current_phase), status: feature.status, blocked_reason: feature.blocked_reason,
      high_risk: feature.high_risk, failed_cycles: feature.failed_cycles, external_ref: feature.external_ref, trigger_ref: feature.trigger_ref,
      allowed_targets: { forward: targets.forward, backward: targets.backward },
    },
  };
}
