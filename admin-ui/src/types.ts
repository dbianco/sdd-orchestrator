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
  requirements: RequirementStatus[];
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

export interface RequirementStatus { id: string; covered: boolean | null }

export interface RtmRow {
  feature_id: string; slug: string; external_ref: string | null; req_id: string; covered: boolean | null;
  files_changed: string[]; tests_passed: number | null; tests_failed: number | null; evidence_source: 'ci' | 'host' | null;
  spec_approved_by: string | null; verify_approved_by: string | null; archived_at: string | null;
}

export interface Me { actor: string; canApprove: boolean }

export interface Approval {
  id: string; feature_id: string; transition_id: string; from_phase: string; to_phase: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded'; requested_by: string; decided_by: string | null; decided_at: string | null;
  comment: string | null; created_at: string; app: string; feature_slug: string; framework: string; track: string | null;
}

export interface ApprovalDetail {
  approval: Omit<Approval, 'app' | 'feature_slug' | 'framework' | 'track'>;
  feature: { feature_id: string; slug: string; framework: string; track: string | null; high_risk: boolean };
  findings: Finding[];
  evidence: Record<string, unknown> | null;
  artifacts: { name: string; byte_length: number; content: string | null }[];
  requirements: string[] | null;
}
