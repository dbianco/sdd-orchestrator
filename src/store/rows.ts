import type { Decision, Finding, KnowledgeKind, MemoryType, Phase, Tier, Workspace } from '../domain/types.js';

interface Audit { created_at: Date; updated_at: Date; created_by: string }

export interface AppRow extends Audit {
  id: string; slug: string; name: string; default_stack: string[]; compliance: boolean;
  token_budget: number | null; min_similarity: number | null; stop_conditions: string[];
}
export interface PolicyRow extends Audit {
  id: string; app_id: string; version: number; policy: { framework: string | null; path_rules: { glob: string; framework: string }[]; risk_paths: string[] }; reason: string;
}
export interface FrameworkRow extends Audit {
  id: string; name: string; pack_version: string; tracks: Record<string, unknown>; gate_library_version: string; status: 'active' | 'deprecated';
}
export interface EmbeddingConfigRow extends Audit {
  id: 'singleton'; provider: string; model: string; dimension: number; reindexed_at: Date | null;
}
export interface FeatureRow extends Audit {
  id: string; app_id: string; slug: string; intent: string; framework: string; framework_pack_version: string; track: string | null;
  current_phase: Phase; status: 'active' | 'blocked' | 'archived'; blocked_reason: string | null; high_risk: boolean; failed_cycles: number;
  policy_version: number | null; policy_override_reason: string | null; source_task: string; external_ref: string | null; trigger_ref: string | null;
  decision: Decision; workspace: Workspace | null;
}
export interface ContextPackRow extends Audit {
  id: string; feature_id: string; phase: Phase; scope: unknown; focus: string | null; items: { stable_id: string; version: number }[];
  rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean;
}
export interface TransitionRow extends Audit {
  id: string; feature_id: string; from_phase: string; to_phase: string; direction: 'forward' | 'backward'; result: 'pass' | 'fail';
  findings: Finding[]; evidence: unknown | null; pack_id: string | null; artifact_hashes: Record<string, string>; human_approved: boolean; reason: string | null;
}
export interface ArtifactRow extends Audit {
  id: string; transition_id: string; name: string; sha256: string; byte_length: number; content: string | null;
}
export interface KnowledgeItemRow extends Audit {
  id: string; stable_id: string; version: number; kind: KnowledgeKind; tier: Tier; framework: string | null; app_id: string | null;
  memory_type: MemoryType | null; human_id: string | null; stack_tags: string[]; phase_tags: string[]; title: string; body: string;
  front_matter: Record<string, unknown>; pack_name: string; pack_version: string | null; status: 'active' | 'deprecated';
  superseded_by: string | null; deprecation_reason: string | null; source_path: string | null; source_hash: string | null;
  source_url: string | null; license: string | null;
}
export interface ChunkRow extends Audit {
  id: string; item_id: string; ordinal: number; heading_path: string; text: string; embedding_model: string; token_count: number; tokenizer: string;
}
export interface ProposalRow extends Audit {
  id: string; app_id: string; feature_id: string; payload: Record<string, unknown>; supersedes: string | null;
  status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; review_reason: string | null;
}
