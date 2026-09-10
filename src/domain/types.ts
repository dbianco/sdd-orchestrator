export const PHASES = ['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn'] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseOrArchived = Phase | 'archived';

export const INTENTS = ['feature', 'product', 'spike', 'trivial', 'incident', 'remediation', 'refactor'] as const;
export type Intent = (typeof INTENTS)[number];

export type Confidence = 'high' | 'medium';
export type Size = 'small' | 'medium' | 'large' | 'unknown';
export type Severity = 'blocker' | 'warning';
export type FeatureStatus = 'active' | 'blocked' | 'archived';
export type KnowledgeKind = 'framework_pack' | 'standard' | 'stack_guide' | 'app_memory';
export type MemoryType = 'adr' | 'decision' | 'constraint' | 'incident';
export type Tier = 'always_on' | 'retrieved';
export type Scope = 'app' | 'company' | string[];

export interface Workspace {
  stack?: string[] | null;
  intent?: Intent | 'auto' | null;
  is_greenfield?: boolean | null;
  has_spec_library?: boolean | null;
  estimated_files?: number | null;
  paths_touched?: string[] | null;
  repositories?: number | null;
  new_subsystem?: boolean | null;
  host?: string | null;
}

export interface PathRule { glob: string; framework: string }
export interface Policy {
  framework: string | null;
  path_rules: PathRule[];
  risk_paths: string[];
}

export interface PhaseMapping {
  alias?: string;
  command?: string;
  template?: string;
}
export type PhaseEntry = PhaseMapping | 'skipped';

export interface GateCheckDecl {
  name: string;
  params?: Record<string, unknown>;
  severity?: Severity;
}
export interface GateDecl {
  transition: string;
  artifacts: string[];
  checks: GateCheckDecl[];
}
export interface TrackDecl {
  spec_review?: 'required' | 'deferred';
  phases: Record<Phase, PhaseEntry>;
  gates: GateDecl[];
}

export interface Decision {
  intent: Intent;
  framework: string;
  track: string | null;
  confidence: Confidence;
  rule: string;
  reasons: string[];
  high_risk: boolean;
  policy_version: number | null;
  framework_pack_version: string | null;
}

export interface Finding {
  check: string;
  severity: Severity;
  location: string | null;
  message: string;
}

export interface VerifyEvidence {
  tests: { command: string; passed: number; failed: number };
  lint: 'pass' | 'fail';
  security: { status: 'pass' | 'fail' | 'skipped'; new_high: number; skipped_reason?: string | null };
  files_changed?: string[];
  implements?: string[];
  existing_tests_modified?: number;
  characterization_tests?: string[];
}

export interface AttachedLayer {
  pack_name: string;
  pack_version: string;
  kind: KnowledgeKind;
}
