import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Work } from './Work';

const event = {
  id: 'r_1', app_id: 'a_1', app_slug: 'checkout', external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix the date picker', intent: 'trivial', framework: 'none',
  lite: true, route_count: 2, first_routed_at: '2026-09-18T10:00:00.000Z', last_routed_at: '2026-09-18T12:00:00.000Z', feature_id: null, feature_slug: null,
  feature_status: null, feature_phase: null, commit_count: 1, decision: { track: null, rule: '4-trivial', reasons: ['host set intent trivial'] }, workspace: null,
};
const featureEvent = { ...event, id: 'r_2', external_ref: null, task_description: 'Add CSV export', intent: 'feature', framework: 'mini', lite: false, feature_id: 'f_1', feature_slug: 'add-csv-export', feature_status: 'active', feature_phase: 'specify', commit_count: 0 };
const unstarted = { ...event, id: 'r_3', external_ref: null, task_description: 'Plan the reports page', intent: 'feature', framework: 'mini', lite: false, commit_count: 0 };

function stubFetch(calls: string[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    calls.push(url);
    if (url === '/admin/api/apps') return Promise.resolve({ ok: true, json: () => Promise.resolve({ apps: [{ id: 'a_1', slug: 'checkout', name: 'Checkout', features: [] }] }) });
    if (url.startsWith('/admin/api/routing')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [event, featureEvent, unstarted], summary: [{ intent: 'trivial', count: 1 }, { intent: 'feature', count: 2 }] }) });
    throw new Error(`unexpected fetch: ${url}`);
  }));
}

describe('Work', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders summary tiles and routed work with type badges', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    expect(await screen.findByText('Fix the date picker')).toBeInTheDocument();
    expect(screen.getByText('YAL-1')).toBeInTheDocument();
    expect(screen.getByText('lite')).toBeInTheDocument();
    // 'feature' appears both as the summary tile label and as the linked feature's badge.
    expect(screen.getAllByText('feature')).toHaveLength(2);
    expect(screen.getByText('feature · not started')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(calls).toContain('/admin/api/routing');
  });

  it('applies app and date filters as query params and blocks an inverted range', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    await screen.findByText('Fix the date picker');
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'checkout' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls).toContain('/admin/api/routing?app=checkout&from=2026-09-01&to=2026-09-30'));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText('From must be on or before To.')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/admin/api/apps') return Promise.resolve({ ok: true, json: () => Promise.resolve({ apps: [] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [], summary: [] }) });
    }));
    render(<Work />);
    expect(await screen.findByText('No routed work in this range.')).toBeInTheDocument();
  });

  it('opens the detail placeholder on row click', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    fireEvent.click(await screen.findByText('Add CSV export'));
    expect(await screen.findByText('Routing detail coming soon.')).toBeInTheDocument();
  });
});
