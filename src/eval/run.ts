import { z } from 'zod';
import { extractExactIds } from '../assembler/exactIds.js';
import { resolveScope } from '../assembler/layers.js';
import { DEFAULT_MIN_SIMILARITY, knowledgeFilter, retrieve, type RetrieveDeps } from '../assembler/retrieve.js';
import { PHASES } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { ScopeSchema } from '../mcp/schemas.js';
import { requireApp } from '../store/apps.js';
import { currentFramework } from '../store/frameworks.js';

export const EvalCaseSchema = z.object({
  query: z.string().min(1),
  phase: z.enum(PHASES),
  framework: z.string().min(1),
  framework_pack_version: z.string().min(1).optional(),
  app: z.string().min(1).optional(),
  scope: ScopeSchema.optional(),
  expect: z.array(z.string().min(1)).min(1),
}).strict();
export type EvalCase = z.infer<typeof EvalCaseSchema>;
export const EvalFileSchema = z.array(EvalCaseSchema).min(1);

export interface CaseResult { query: string; expect: string[]; got: string[]; recall: number; rr: number; degraded: boolean }
export interface EvalReport { k: number; cases: CaseResult[]; recall: number; mrr: number }

export function recallAt(expected: string[], got: string[]): number {
  return expected.filter((e) => got.includes(e)).length / expected.length;
}

export function reciprocalRank(expected: string[], got: string[]): number {
  const i = got.findIndex((g) => expected.includes(g));
  return i === -1 ? 0 : 1 / (i + 1);
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

// Runs each query through position-4 retrieval exactly as get_context builds it, without pinned-template exclusion.
export async function runEval(deps: RetrieveDeps, cases: EvalCase[], opts: { k?: number } = {}): Promise<EvalReport> {
  const k = opts.k ?? 8;
  const results: CaseResult[] = [];
  for (const c of cases) {
    const app = c.app ? await requireApp(deps.q, c.app) : null;
    const version = c.framework_pack_version ?? (await currentFramework(deps.q, c.framework))?.pack_version;
    if (!version) throw new DomainError('UNKNOWN_FRAMEWORK', `framework "${c.framework}" has no current version`, { framework: c.framework });
    const scope = app ? await resolveScope(deps.q, c.scope ?? 'app', app) : 'company';
    const r = await retrieve(deps, {
      query: c.query, ids: extractExactIds(c.query), minSimilarity: app?.min_similarity ?? DEFAULT_MIN_SIMILARITY, limit: k,
      // Always-on standards sit in position 2 of a pack, so they are not position-4 results.
      filter: { ...knowledgeFilter({ scope, framework: c.framework, frameworkPackVersion: version, phase: c.phase }), tier: 'retrieved' },
    });
    const got = [...new Set(r.chunks.map((x) => x.stable_id))];
    results.push({ query: c.query, expect: c.expect, got, recall: recallAt(c.expect, got), rr: reciprocalRank(c.expect, got), degraded: r.degraded });
  }
  return { k, cases: results, recall: mean(results.map((r) => r.recall)), mrr: mean(results.map((r) => r.rr)) };
}
