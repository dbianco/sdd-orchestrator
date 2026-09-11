import type { Phase, Scope } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { renderNextGate, renderPhaseInstructions } from '../lifecycle/instructions.js';
import { phaseMapping } from '../lifecycle/track.js';
import { currentItem, listAlwaysOn } from '../store/knowledge.js';
import { insertPack } from '../store/packs.js';
import { getFrameworkVersion, trackOf } from '../store/frameworks.js';
import type { AppRow, ContextPackRow, FeatureRow, KnowledgeItemRow } from '../store/rows.js';
import type { RetrievedChunk } from '../store/retrieval.js';
import { countTokens } from '../tokens.js';
import { trimToBudget } from './budget.js';
import { extractExactIds } from './exactIds.js';
import { attachedLayers, resolveScope, resolveStack } from './layers.js';
import { renderAlwaysOn, renderChunk, renderPack, renderStopConditions } from './render.js';
import { DEFAULT_MIN_SIMILARITY, retrieve, type RetrieveDeps } from './retrieve.js';

export interface AssemblerDeps extends RetrieveDeps { defaultBudget: number }
export interface AssembleInput { feature: FeatureRow; app: AppRow; phase: Phase; focus: string | null; scope: Scope; createdBy: string }
export interface AssembledPack { pack: ContextPackRow; warnings: string[] }

interface Scored { chunk: RetrievedChunk; tokens: number; score: number }

async function pinnedTemplate(deps: AssemblerDeps, feature: FeatureRow, templateId: string | undefined, warnings: string[]): Promise<KnowledgeItemRow | null> {
  if (!templateId) return null;
  const r = await deps.q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items WHERE stable_id = $1 AND pack_name = $2 AND pack_version = $3 ORDER BY version DESC LIMIT 1`,
    [templateId, feature.framework, feature.framework_pack_version],
  );
  if (r.rows[0]) return r.rows[0];
  const current = await currentItem(deps.q, templateId);
  if (current) warnings.push(`phase template "${templateId}" not found for ${feature.framework}@${feature.framework_pack_version}, using current version instead`);
  return current;
}

export async function assembleContextPack(deps: AssemblerDeps, input: AssembleInput): Promise<AssembledPack> {
  const { feature, app, phase, focus, scope, createdBy } = input;
  const warnings: string[] = [];
  const fw = await getFrameworkVersion(deps.q, feature.framework, feature.framework_pack_version);
  if (!fw) {
    throw new DomainError('UNKNOWN_FRAMEWORK', `pinned framework ${feature.framework}@${feature.framework_pack_version} is missing`, {
      framework: feature.framework, pack_version: feature.framework_pack_version,
    });
  }
  const track = trackOf(fw, feature.track);
  const mapping = phaseMapping(track, phase);
  const budget = app.token_budget ?? deps.defaultBudget;
  const minSimilarity = app.min_similarity ?? DEFAULT_MIN_SIMILARITY;
  const items: { stable_id: string; version: number }[] = [];

  // Position 1
  const header = renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase, track_decl: track });
  // Position 2 (independent of scope)
  const alwaysOn = await listAlwaysOn(deps.q, app.id);
  items.push(...alwaysOn.map((i) => ({ stable_id: i.stable_id, version: i.version })));
  // Position 3
  const template = await pinnedTemplate(deps, feature, mapping.template, warnings);
  if (mapping.template && !template) warnings.push(`phase template "${mapping.template}" not found for ${feature.framework}@${feature.framework_pack_version}`);
  if (template) items.push({ stable_id: template.stable_id, version: template.version });
  // Position 6
  const footer = `${renderStopConditions(app.stop_conditions)}\n\n${renderNextGate(track, phase, feature.high_risk)}`;

  const fixedText = renderPack({ header, alwaysOn: renderAlwaysOn(alwaysOn), template: template?.body ?? '', retrieved: '', stack: '', footer });
  const fixedTokens = countTokens(fixedText);

  // Positions 4 and 5
  const query = focus ?? feature.source_task;
  const ids = extractExactIds(query, feature.source_task, feature.trigger_ref, feature.external_ref);
  const resolved = await resolveScope(deps.q, scope, app);
  const { layers, warnings: layerWarnings } = await attachedLayers(deps.q, resolveStack(feature.workspace?.stack, app.default_stack));
  warnings.push(...layerWarnings);
  const stackPacks = layers.filter((l) => l.kind === 'stack_guide').map((l) => l.pack_name);

  const knowledge = await retrieve(deps, {
    query, ids, minSimilarity,
    filter: { scope: resolved, framework: feature.framework, frameworkPackVersion: feature.framework_pack_version, phase, kinds: ['app_memory', 'standard', 'framework_pack'], tier: null, excludeItemIds: [...(template ? [template.id] : []), ...alwaysOn.map((i) => i.id)] },
  });
  const guides = stackPacks.length === 0
    ? { chunks: [], degraded: knowledge.degraded }
    : await retrieve(deps, { query, ids, minSimilarity, filter: { scope: resolved, framework: feature.framework, frameworkPackVersion: feature.framework_pack_version, phase, kinds: ['stack_guide'], packNames: stackPacks, excludeItemIds: [...(template ? [template.id] : []), ...alwaysOn.map((i) => i.id)] } });
  const degraded = knowledge.degraded || guides.degraded;
  if (degraded) warnings.push('retrieval degraded: embedding provider unavailable, positions 4 and 5 built from exact-id matches only');

  const score = (c: RetrievedChunk): Scored => ({ chunk: c, tokens: countTokens(renderChunk(c)), score: c.match === 'exact_id' ? 2 : c.score });
  const trimmed = trimToBudget(fixedTokens, knowledge.chunks.map(score), guides.chunks.map(score), budget);
  if (trimmed.over_budget) warnings.push(`over budget: fixed positions use ${fixedTokens} tokens of ${budget}`);
  if (trimmed.dropped_stack + trimmed.dropped_retrieved > 0) warnings.push(`trimmed ${trimmed.dropped_stack} stack guide and ${trimmed.dropped_retrieved} retrieved chunk(s) to fit ${budget} tokens`);
  for (const s of [...trimmed.retrieved, ...trimmed.stack]) items.push({ stable_id: s.chunk.stable_id, version: s.chunk.version });

  const rendered = renderPack({
    header, alwaysOn: renderAlwaysOn(alwaysOn), template: template?.body ?? '',
    retrieved: trimmed.retrieved.map((s) => renderChunk(s.chunk)).join('\n\n'),
    stack: trimmed.stack.map((s) => renderChunk(s.chunk)).join('\n\n'),
    footer,
  });
  const pack = await insertPack(deps.q, {
    feature_id: feature.id, phase, scope, focus, items, rendered, token_count: countTokens(rendered), budget, degraded, over_budget: trimmed.over_budget,
  }, createdBy);
  return { pack, warnings };
}
