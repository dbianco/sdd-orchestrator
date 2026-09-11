import { assembleContextPack } from '../assembler/assemble.js';
import { withTransaction } from '../db/pool.js';
import type { Decision, Workspace } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { DomainError } from '../errors.js';
import { renderPhaseInstructions } from '../lifecycle/instructions.js';
import { defaultFeatureSlug, slugify } from '../lifecycle/slug.js';
import { parseFrameworkRef } from '../router/router.js';
import { requireApp } from '../store/apps.js';
import { createFeature } from '../store/features.js';
import { currentFramework, trackNames, trackOf } from '../store/frameworks.js';
import { currentPolicy } from '../store/policies.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface StartFeatureInput {
  app: string; actor: string; task_description: string; decision: Decision; workspace?: Workspace | null; feature_slug?: string | null;
  external_ref?: string | null; trigger_ref?: string | null; policy_override_reason?: string | null;
}
export interface StartFeatureResult { feature_id: string; context_pack: string; pack_id: string; feature: FeatureState; next_instructions: string; warnings: string[] }

export async function startFeature(deps: ServiceDeps, input: StartFeatureInput): Promise<StartFeatureResult> {
  const warnings: string[] = [];
  const decision = input.decision;
  if (decision.framework === 'none') throw new DomainError('VALIDATION_ERROR', 'start_feature needs a framework; the decision names "none" (spike or trivial)', { field: 'decision.framework' });
  if (deps.embedder) await assertEmbeddingConfigMatches(deps.pool, deps.embedder);

  return withTransaction(deps.pool, async (tx) => {
    const app = await requireApp(tx, input.app);
    const fw = await currentFramework(tx, decision.framework);
    if (!fw) throw new DomainError('UNKNOWN_FRAMEWORK', `framework "${decision.framework}" has no current version`, { framework: decision.framework });
    const tracks = trackNames(fw);
    let track: string;
    if (tracks.length === 1 && tracks[0] === 'default') {
      track = 'default';
      if (decision.track && decision.track !== 'default') throw new DomainError('VALIDATION_ERROR', `framework "${fw.name}" has no track "${decision.track}"`, { field: 'decision.track', tracks });
    } else {
      if (!decision.track) throw new DomainError('VALIDATION_ERROR', `framework "${fw.name}" has tracks (${tracks.join(', ')}); decision.track is required`, { field: 'decision.track', tracks });
      if (!tracks.includes(decision.track)) throw new DomainError('VALIDATION_ERROR', `framework "${fw.name}" has no track "${decision.track}"`, { field: 'decision.track', tracks });
      track = decision.track;
    }
    const policy = await currentPolicy(tx, app.id);
    const policyFramework = policy?.policy.framework ? parseFrameworkRef(policy.policy.framework).name : null;
    if (policyFramework && policyFramework !== decision.framework && !input.policy_override_reason) {
      throw new DomainError('VALIDATION_ERROR', `app policy names ${policyFramework}; policy_override_reason is required to start a ${decision.framework} feature`, { field: 'policy_override_reason' });
    }
    if (decision.framework_pack_version && decision.framework_pack_version !== fw.pack_version) {
      warnings.push(`decision named pack version ${decision.framework_pack_version}; pinned ${fw.pack_version}`);
    }
    const feature = await createFeature(tx, {
      app_id: app.id,
      slug: input.feature_slug ? slugify(input.feature_slug) : defaultFeatureSlug(input.task_description, input.external_ref ?? null),
      intent: decision.intent, framework: fw.name, framework_pack_version: fw.pack_version, track, high_risk: decision.high_risk,
      policy_version: policy?.version ?? null, policy_override_reason: input.policy_override_reason ?? null, source_task: input.task_description,
      external_ref: input.external_ref ?? null, trigger_ref: input.trigger_ref ?? null, decision, workspace: input.workspace ?? null,
    }, input.actor);
    const { pack, warnings: packWarnings } = await assembleContextPack({ q: tx, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, { feature, app, phase: 'specify', focus: null, scope: 'app', createdBy: input.actor });
    warnings.push(...packWarnings);
    if (pack.degraded) deps.metrics?.degradedPack();
    if (pack.over_budget) deps.metrics?.overBudgetPack();
    const { state } = await featureState(tx, feature);
    const nextInstructions = renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: 'specify', track_decl: trackOf(fw, track) });
    return { feature_id: feature.id, context_pack: pack.rendered, pack_id: pack.id, feature: state, next_instructions: nextInstructions, warnings };
  });
}
