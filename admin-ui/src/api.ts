import type { Approval, ApprovalDetail, AppSummary, Commit, Me, FeatureDetail, FeatureSummary, FlowCount, Overview, Proposal, RoutingEvent, RoutingSummary, RtmRow } from './types';

export class ApiError extends Error {}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
    throw new ApiError(detail ?? `${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

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

export function getRtm(app: string): Promise<{ app: string; rows: RtmRow[] }> {
  return get<{ app: string; rows: RtmRow[] }>(`/admin/api/apps/${encodeURIComponent(app)}/rtm`);
}

export function getMe(): Promise<Me> {
  return get<Me>('/admin/api/me');
}

export function getApprovals(): Promise<{ approvals: Approval[] }> {
  return get<{ approvals: Approval[] }>('/admin/api/approvals');
}

export function getApproval(id: string): Promise<ApprovalDetail> {
  return get<ApprovalDetail>(`/admin/api/approvals/${encodeURIComponent(id)}`);
}

export function approveApproval(id: string, comment?: string): Promise<unknown> {
  return post(`/admin/api/approvals/${encodeURIComponent(id)}/approve`, comment ? { comment } : {});
}

export function rejectApproval(id: string, reason: string): Promise<unknown> {
  return post(`/admin/api/approvals/${encodeURIComponent(id)}/reject`, { reason });
}
