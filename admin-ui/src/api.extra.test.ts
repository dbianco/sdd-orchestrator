import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from './api';

const ok = (body: unknown = {}) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

describe('api client', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('builds query strings for every filtered endpoint', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(url); return ok({ hints: {} }); }));
    await api.getOverview('a b');
    await api.getOverview();
    await api.getFlow('x');
    await api.getFlow();
    await api.getProposals('pending');
    await api.getProposals();
    await api.getApprovals('x');
    await api.getMetrics('x');
    await api.getMetrics();
    await api.getWeek({ app: 'x', actor: 'dana', days: 30 });
    await api.getWeek();
    await api.getCycle('x');
    await api.getCycle();
    await api.getDrift('x');
    await api.getDrift();
    await api.getRightSizing('x');
    await api.getRightSizing();
    await api.getRouting({ app: 'x', from: '2026-01-01', to: '2026-02-01' });
    await api.getRouting();
    await api.getAppFeatures('x y');
    await api.getFeatureDetail('f 1');
    await api.getRoutingDetail('r/1');
    await api.getRtm('x');
    await api.getApproval('ap 1');
    await api.getMe();
    await api.getApps();
    expect(calls).toEqual([
      '/admin/api/overview?app=a%20b', '/admin/api/overview', '/admin/api/flow?app=x', '/admin/api/flow', '/admin/api/proposals?status=pending', '/admin/api/proposals',
      '/admin/api/approvals?app=x', '/admin/api/metrics?app=x', '/admin/api/metrics', '/admin/api/week?app=x&actor=dana&days=30', '/admin/api/week',
      '/admin/api/cycle?app=x', '/admin/api/cycle', '/admin/api/drift?app=x', '/admin/api/drift', '/admin/api/rightsizing?app=x', '/admin/api/rightsizing',
      '/admin/api/routing?app=x&from=2026-01-01&to=2026-02-01', '/admin/api/routing', '/admin/api/apps/x%20y/features', '/admin/api/features/f%201', '/admin/api/routing/r%2F1',
      '/admin/api/apps/x/rtm', '/admin/api/approvals/ap%201', '/admin/api/me', '/admin/api/apps',
    ]);
  });

  it('posts decisions as JSON and surfaces the server message on failure', async () => {
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => { posts.push({ url, body: JSON.parse(String(init?.body)) }); return ok(); }));
    await api.approveApproval('ap_1', 'fine');
    await api.approveApproval('ap_1');
    await api.rejectApproval('ap_1', 'no');
    await api.approveProposal('p_1');
    await api.rejectProposal('p_1', 'dup');
    expect(posts).toEqual([
      { url: '/admin/api/approvals/ap_1/approve', body: { comment: 'fine' } }, { url: '/admin/api/approvals/ap_1/approve', body: {} },
      { url: '/admin/api/approvals/ap_1/reject', body: { reason: 'no' } }, { url: '/admin/api/proposals/p_1/approve', body: {} }, { url: '/admin/api/proposals/p_1/reject', body: { reason: 'dup' } },
    ]);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'already approved' }) })));
    await expect(api.approveApproval('ap_1')).rejects.toThrow('already approved');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('not json')) })));
    await expect(api.rejectApproval('ap_1', 'x')).rejects.toThrow('/admin/api/approvals/ap_1/reject responded 500');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })));
    await expect(api.getMe()).rejects.toThrow('/admin/api/me responded 404');
  });
});
