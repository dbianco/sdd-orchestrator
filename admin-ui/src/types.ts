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
