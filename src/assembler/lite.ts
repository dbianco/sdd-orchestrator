import { listAlwaysOn } from '../store/knowledge.js';
import type { AppRow } from '../store/rows.js';
import type { RetrievedChunk } from '../store/retrieval.js';
import { countTokens } from '../tokens.js';
import type { AssemblerDeps } from './assemble.js';
import { trimToBudget } from './budget.js';
import { extractExactIds } from './exactIds.js';
import { attachedLayers, resolveStack } from './layers.js';
import { renderAlwaysOn, renderChunk, renderStopConditions } from './render.js';
import { DEFAULT_MIN_SIMILARITY, retrieve } from './retrieve.js';

export interface LitePack {
  rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean;
  items: { stable_id: string; version: number }[]; warnings: string[];
}

export async function buildLitePack(deps: AssemblerDeps, input: { app: AppRow; taskDescription: string; stack: string[] }): Promise<LitePack> {
  const { app } = input;
  const warnings: string[] = [];
  const budget = app.token_budget ?? deps.defaultBudget;
  const alwaysOn = await listAlwaysOn(deps.q, app.id);
  const { layers, warnings: lw } = await attachedLayers(deps.q, resolveStack(input.stack, app.default_stack));
  warnings.push(...lw);
  const stackPacks = layers.filter((l) => l.kind === 'stack_guide').map((l) => l.pack_name);
  const fixed = `# Lite pack\n\n## Always-on standards\n\n${renderAlwaysOn(alwaysOn) || '(none)'}\n\n## Stack guides\n\n`;
  const footer = `\n\n## Stop conditions\n\n${renderStopConditions(app.stop_conditions)}`;
  const fixedTokens = countTokens(fixed + footer);
  // degraded reflects whether the embedder itself is unavailable, not whether retrieval happened to
  // run: a missing embedder must report degraded even when no stack pack matched and retrieve() was
  // skipped, so its meaning doesn't flip depending on unrelated stack-guide data.
  const embedderDegraded = deps.embedder === null;
  const guides = stackPacks.length === 0
    ? { chunks: [] as RetrievedChunk[], degraded: embedderDegraded }
    : await retrieve(deps, { query: input.taskDescription, ids: extractExactIds(input.taskDescription), minSimilarity: app.min_similarity ?? DEFAULT_MIN_SIMILARITY,
        filter: { scope: { appIds: [app.id] }, framework: null, frameworkPackVersion: null, phase: null, kinds: ['stack_guide'], packNames: stackPacks } });
  const degraded = embedderDegraded || guides.degraded;
  if (degraded) warnings.push('retrieval degraded: embedding provider unavailable');
  const scored = guides.chunks.map((c) => ({ chunk: c, tokens: countTokens(renderChunk(c)), score: c.score }));
  const trimmed = trimToBudget(fixedTokens, [], scored, budget);
  if (trimmed.over_budget) warnings.push(`over budget: always-on standards use ${fixedTokens} tokens of ${budget}`);
  const rendered = fixed + (trimmed.stack.map((s) => renderChunk(s.chunk)).join('\n\n') || '(none)') + footer;
  return {
    rendered, token_count: countTokens(rendered), budget, degraded, over_budget: trimmed.over_budget,
    items: [...alwaysOn.map((i) => ({ stable_id: i.stable_id, version: i.version })), ...trimmed.stack.map((s) => ({ stable_id: s.chunk.stable_id, version: s.chunk.version }))],
    warnings,
  };
}
