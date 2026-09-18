export interface FeatureCount { status: string; current_phase: string; framework: string; track: string | null; count: number }
export interface GateCheckStat { check: string; blocker_count: number; warning_count: number }
export interface FlowCount { from_phase: string; to_phase: string; result: 'pass' | 'fail'; count: number }
export interface ProposalStatusCount { status: 'pending' | 'approved' | 'rejected'; count: number }
export interface KnowledgeCount { kind: string; memory_type: string | null; count: number }

export interface Overview {
  features: FeatureCount[];
  checks: GateCheckStat[];
  proposals: ProposalStatusCount[];
  knowledge: KnowledgeCount[];
}

export interface AppSummary {
  id: string;
  slug: string;
  name: string;
  features: FeatureCount[];
}

export interface FeatureSummary {
  feature_id: string;
  slug: string;
  intent: string;
  framework: string;
  track: string | null;
  current_phase: string;
  status: string;
  external_ref: string | null;
  trigger_ref: string | null;
  updated_at: string;
}

export interface Finding { check: string; severity: 'blocker' | 'warning'; location: string | null; message: string }

export interface TransitionEntry {
  id: string;
  from_phase: string;
  to_phase: string;
  direction: 'forward' | 'backward';
  result: 'pass' | 'fail';
  findings: Finding[];
  human_approved: boolean;
  reason: string | null;
  created_at: string;
}

export interface FeatureDetail {
  feature: {
    feature_id: string;
    slug: string;
    app_id: string;
    framework: string;
    track: string | null;
    current_phase: string;
    status: string;
    blocked_reason: string | null;
    updated_at: string;
  };
  transitions: TransitionEntry[];
}

export interface Proposal {
  id: string;
  app_id: string;
  feature_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  created_by: string;
}

export interface RoutingEvent {
  id: string;
  app_id: string;
  app_slug: string;
  external_ref: string | null;
  trigger_ref: string | null;
  task_description: string;
  intent: string;
  framework: string;
  lite: boolean;
  route_count: number;
  first_routed_at: string;
  last_routed_at: string;
  feature_id: string | null;
  feature_slug: string | null;
  feature_status: string | null;
  feature_phase: string | null;
  commit_count: number;
  decision: { track: string | null; rule: string; reasons: string[] };
  workspace: { paths_touched?: string[] | null } | null;
}

export interface RoutingSummary { intent: string; count: number }

export interface Commit {
  id: string;
  sha: string;
  branch: string | null;
  message: string;
  files_changed: string[];
  committed_at: string | null;
  created_at: string;
}
