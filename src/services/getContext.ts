import { assembleContextPack } from '../assembler/assemble.js';
import { withTransaction } from '../db/pool.js';
import type { Phase, Scope } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { DomainError } from '../errors.js';
import { phaseOrder } from '../lifecycle/track.js';
import { requireFeature } from '../store/features.js';
import type { AppRow } from '../store/rows.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface GetContextInput { feature_id: string; actor: string; phase?: Phase | null; focus?: string | null; scope?: Scope }
export interface GetContextResult { context_pack: string; pack_id: string; feature: FeatureState; warnings: string[] }

export async function getContext(deps: ServiceDeps, input: GetContextInput): Promise<GetContextResult> {
  if (deps.embedder) await assertEmbeddingConfigMatches(deps.pool, deps.embedder);
  return withTransaction(deps.pool, async (tx) => {
    const feature = await requireFeature(tx, input.feature_id);
    const { state, track } = await featureState(tx, feature);
    const phase = input.phase ?? feature.current_phase;
    if (!phaseOrder(track).includes(phase)) {
      throw new DomainError('VALIDATION_ERROR', `phase ${phase} is skipped in track ${feature.track ?? 'default'}`, { field: 'phase', phases: phaseOrder(track) });
    }
    const app = (await tx.query<AppRow>('SELECT * FROM apps WHERE id = $1', [feature.app_id])).rows[0]!;
    const { pack, warnings } = await assembleContextPack({ q: tx, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, {
      feature, app, phase, focus: input.focus ?? null, scope: input.scope ?? 'app', createdBy: input.actor,
    });
    if (pack.degraded) deps.metrics?.degradedPack();
    if (pack.over_budget) deps.metrics?.overBudgetPack();
    return { context_pack: pack.rendered, pack_id: pack.id, feature: state, warnings };
  });
}
