import { z } from 'zod';
import { INTENTS, PHASES } from '../domain/types.js';

export const PhaseSchema = z.enum(PHASES);
export const ActorSchema = z.string().min(1).describe('Display identity of the person or agent making the call; attribution only');
export const ScopeSchema = z.union([z.literal('app'), z.literal('company'), z.array(z.string().min(1))])
  .describe('"app" = company items plus this app; "company" = company items only; ["slug", ...] = company items plus the listed apps');

export const WorkspaceShape = z.object({
  stack: z.array(z.string()).nullable().optional(),
  intent: z.enum([...INTENTS, 'auto']).nullable().optional(),
  is_greenfield: z.boolean().nullable().optional(),
  has_spec_library: z.boolean().nullable().optional(),
  estimated_files: z.number().int().nonnegative().nullable().optional(),
  paths_touched: z.array(z.string()).nullable().optional(),
  repositories: z.number().int().nonnegative().nullable().optional(),
  new_subsystem: z.boolean().nullable().optional(),
  host: z.string().nullable().optional(),
}).describe('Workspace facts derived by the host (see docs/verification/workspace-facts.sh); null means unknown');

export const DecisionShape = z.object({
  intent: z.enum(INTENTS),
  framework: z.string(),
  track: z.string().nullable(),
  confidence: z.enum(['high', 'medium']),
  rule: z.string(),
  reasons: z.array(z.string()),
  high_risk: z.boolean(),
  policy_version: z.number().int().nullable(),
  framework_pack_version: z.string().nullable(),
});

export const FeatureStateShape = z.object({
  feature_id: z.string(), app: z.string(), slug: z.string(), intent: z.string(), framework: z.string(), framework_pack_version: z.string(),
  track: z.string().nullable(), current_phase: z.string(), phase_alias: z.string(), status: z.string(), blocked_reason: z.string().nullable(),
  high_risk: z.boolean(), failed_cycles: z.number().int(), external_ref: z.string().nullable(), trigger_ref: z.string().nullable(),
  allowed_targets: z.object({ forward: z.array(z.string()), backward: z.array(z.string()) }),
});

export const WarningsShape = z.array(z.string());
export const FindingShape = z.object({ check: z.string(), severity: z.enum(['blocker', 'warning']), location: z.string().nullable(), message: z.string() });
export const AttachedLayerShape = z.object({ pack_name: z.string(), pack_version: z.string(), kind: z.string() });
export const LitePackShape = z.object({ rendered: z.string(), token_count: z.number().int(), budget: z.number().int(), degraded: z.boolean(), over_budget: z.boolean(), items: z.array(z.object({ stable_id: z.string(), version: z.number().int() })) });
