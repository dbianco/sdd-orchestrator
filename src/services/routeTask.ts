import { attachedLayers, resolveStack } from '../assembler/layers.js';
import { buildLitePack, type LitePack } from '../assembler/lite.js';
import type { AttachedLayer, Decision, Workspace } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { route } from '../router/router.js';
import { requireApp } from '../store/apps.js';
import { listCurrentFrameworks, trackNames } from '../store/frameworks.js';
import { currentPolicy } from '../store/policies.js';
import type { ServiceDeps } from './deps.js';

export interface RouteTaskInput { task_description: string; app: string; workspace: Workspace; framework_preference?: string | null }
export interface RouteTaskResult {
  decision: Decision; clarifying_questions: string[]; guidance: string | null; lite_pack: LitePack | null; attached_layers: AttachedLayer[]; warnings: string[];
}

export async function routeTask(deps: ServiceDeps, input: RouteTaskInput): Promise<RouteTaskResult> {
  const q = deps.pool;
  const app = await requireApp(q, input.app);
  const policy = await currentPolicy(q, app.id);
  const frameworks = (await listCurrentFrameworks(q)).map((f) => ({ name: f.name, pack_version: f.pack_version, tracks: trackNames(f) }));
  const out = route({
    task_description: input.task_description, workspace: input.workspace, framework_preference: input.framework_preference ?? null,
    policy: policy?.policy ?? null, policy_version: policy?.version ?? null, app: { compliance: app.compliance, default_stack: app.default_stack }, frameworks,
  });
  deps.metrics?.routed(out.decision.rule);
  const stack = resolveStack(input.workspace.stack, app.default_stack);
  const { layers, warnings: layerWarnings } = await attachedLayers(q, stack);
  const warnings = [...out.warnings, ...layerWarnings];
  let litePack: LitePack | null = null;
  if (out.lite) {
    if (deps.embedder) await assertEmbeddingConfigMatches(q, deps.embedder);
    litePack = await buildLitePack({ q, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, { app, taskDescription: input.task_description, stack });
    warnings.push(...litePack.warnings);
    if (litePack.degraded) deps.metrics?.degradedPack();
  }
  return { decision: out.decision, clarifying_questions: out.clarifying_questions, guidance: out.guidance, lite_pack: litePack, attached_layers: layers, warnings };
}
