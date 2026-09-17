import type { AppSummary, FeatureDetail, FeatureSummary, FlowCount, Overview, Proposal } from './types';

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
