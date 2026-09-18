import type { AppSummary, Commit, FeatureDetail, FeatureSummary, FlowCount, Overview, Proposal, RoutingEvent, RoutingSummary } from './types';

export class ApiError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(`${path} responded ${res.status}`);
  return (await res.json()) as T;
}

export function getOverview(app?: string): Promise<Overview> {
  return get<Overview>(`/admin/api/overview${app ? `?app=${encodeURIComponent(app)}` : ''}`);
}

export function getApps(): Promise<{ apps: AppSummary[] }> {
  return get<{ apps: AppSummary[] }>('/admin/api/apps');
}

export function getAppFeatures(app: string): Promise<{ features: FeatureSummary[] }> {
  return get<{ features: FeatureSummary[] }>(`/admin/api/apps/${encodeURIComponent(app)}/features`);
}

export function getFeatureDetail(featureId: string): Promise<FeatureDetail> {
  return get<FeatureDetail>(`/admin/api/features/${encodeURIComponent(featureId)}`);
}

export function getFlow(app?: string): Promise<{ flow: FlowCount[] }> {
  return get<{ flow: FlowCount[] }>(`/admin/api/flow${app ? `?app=${encodeURIComponent(app)}` : ''}`);
}

export function getProposals(status?: string): Promise<{ proposals: Proposal[] }> {
  return get<{ proposals: Proposal[] }>(`/admin/api/proposals${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

export interface RoutingParams { app?: string; from?: string; to?: string }

export function getRouting(params: RoutingParams = {}): Promise<{ events: RoutingEvent[]; summary: RoutingSummary[] }> {
  const qs = new URLSearchParams();
  if (params.app) qs.set('app', params.app);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const s = qs.toString();
  return get<{ events: RoutingEvent[]; summary: RoutingSummary[] }>(`/admin/api/routing${s ? `?${s}` : ''}`);
}

export function getRoutingDetail(id: string): Promise<{ event: RoutingEvent; commits: Commit[] }> {
  return get<{ event: RoutingEvent; commits: Commit[] }>(`/admin/api/routing/${encodeURIComponent(id)}`);
}
