import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppsFeatures } from './AppsFeatures';
import { Work } from './Work';
import { RoutingDetail } from './RoutingDetail';
import { typeBadge } from './badge';
import { stubDownload, stubFetch } from '../testUtils';

const feature = (over: Record<string, unknown> = {}) => ({ feature_id: 'f_1', slug: 'add-csv', intent: 'Add CSV export', framework: 'openspec', track: 'default', current_phase: 'verify', status: 'active', external_ref: 'YAL-9', trigger_ref: null, updated_at: '2026-11-01T00:00:00.000Z', ...over });
const rtmRow = (over: Record<string, unknown> = {}) => ({ feature_id: 'f_1', slug: 'add-csv', external_ref: 'YAL-9', req_id: 'FR-001', covered: true, files_changed: [], tests_passed: 7, tests_failed: 0, evidence_source: 'ci', spec_approved_by: 'dana', verify_approved_by: null, archived_at: null, ...over });
const event = (over: Record<string, unknown> = {}) => ({
  id: 'r_1', app_id: 'a_1', app_slug: 'checkout', external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix the date picker', intent: 'trivial', framework: 'none', lite: true, route_count: 1,
  first_routed_at: '2026-11-01T10:00:00.000Z', last_routed_at: '2026-11-01T12:00:00.000Z', feature_id: null, feature_slug: null, feature_status: null, feature_phase: null, commit_count: 0,
  decision: { track: null, rule: '4-trivial', reasons: [] }, workspace: null, ...over,
});
const detail = { feature: { feature_id: 'f_1', slug: 'add-csv', app_id: 'a_1', framework: 'openspec', track: null, current_phase: 'verify', status: 'active', blocked_reason: null, updated_at: '2026-11-01T00:00:00.000Z' }, transitions: [], requirements: [] };

describe('badge', () => {
  it('describes each kind of routed work', () => {
    expect(typeBadge(event({ feature_id: 'f_1' }) as never)).toBe('feature');
    expect(typeBadge(event() as never)).toBe('lite');
    expect(typeBadge(event({ lite: false, intent: 'feature' }) as never)).toBe('feature · not started');
    expect(typeBadge(event({ lite: false, intent: 'product' }) as never)).toBe('product · not started');
    expect(typeBadge(event({ lite: false, intent: 'incident' }) as never)).toBe('incident');
  });
});

describe('AppsFeatures interactions', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const routes = (over: Record<string, unknown> = {}) => (url: string) => {
    const table: Record<string, unknown> = {
      '/admin/api/apps': { apps: [{ id: 'a_1', slug: 'checkout', name: 'C', features: [{ count: 2 }, { count: 1 }] }, { id: 'a_2', slug: 'empty', name: 'E', features: [] }] },
      '/admin/api/apps/checkout/features': { features: [feature(), feature({ feature_id: 'f_2', slug: 'fix-pay', status: 'blocked', track: null, external_ref: null, current_phase: 'plan' }), feature({ feature_id: 'f_3', slug: 'old', status: 'archived', framework: 'bmad' })] },
      '/admin/api/apps/checkout/rtm': { rows: [rtmRow(), rtmRow({ req_id: 'FR-002', covered: false, tests_passed: null, evidence_source: null, spec_approved_by: null, external_ref: null }), rtmRow({ req_id: 'FR-003', covered: null, tests_failed: null })] },
      '/admin/api/apps/empty/features': { features: [] },
      '/admin/api/apps/empty/rtm': { rows: [] },
      '/admin/api/features/f_1': detail,
      ...over,
    };
    if (!(url in table)) throw new Error(`unexpected ${url}`);
    return table[url];
  };

  it('sorts, filters, exports and opens features from both tables', async () => {
    stubFetch(routes());
    stubDownload();
    render(<AppsFeatures />);
    fireEvent.click(await screen.findByRole('button', { name: /^checkout/ }));
    await screen.findByText('fix-pay');
    for (const btn of Array.from(document.querySelectorAll('button.sort'))) { fireEvent.click(btn); fireEvent.click(btn); }
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'zzz' } });
    expect(screen.getByText('No features match')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: 'fix' } });
    expect(within(screen.getAllByRole('table')[0]!).queryByText('add-csv')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search features'), { target: { value: '' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: 'Blocked' }));
    expect(within(screen.getAllByRole('table')[0]!).queryByText('add-csv')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: 'All' }));
    for (const b of screen.getAllByRole('button', { name: 'Export CSV' })) fireEvent.click(b);
    expect(screen.getByText('1 of 3 requirements covered by evidence.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'add-csv' }).at(-1)!); // from the traceability table
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('← Back'));
    expect(await screen.findByText('fix-pay')).toBeInTheDocument();
  });

  it('shows empty and error states', async () => {
    stubFetch(routes());
    render(<AppsFeatures />);
    fireEvent.click(await screen.findByRole('button', { name: /^empty/ }));
    expect(await screen.findByText('No features in this app yet')).toBeInTheDocument();
    expect(await screen.findByText('No requirements captured in this app yet')).toBeInTheDocument();
    vi.unstubAllGlobals();
    stubFetch((url) => { if (url.endsWith('/checkout/features')) throw new Error('nope'); return routes()(url); });
    fireEvent.click(screen.getByRole('button', { name: /^checkout/ }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });

  it('shows failures of the apps, features and traceability requests with a retry', async () => {
    const failing = (url: string) => { if (url.endsWith('/rtm')) throw new Error('rtm down'); if (url.endsWith('/features')) throw new Error('features down'); return routes()(url); };
    stubFetch(failing);
    render(<AppsFeatures app="checkout" />); // project chosen in the sidebar: no app list
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByText(/responded 500/)).toHaveLength(2);
    expect(screen.queryByText('Apps', { selector: 'h3' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    vi.unstubAllGlobals();
    stubFetch(() => { throw new Error('apps down'); });
    render(<AppsFeatures />);
    expect(await screen.findByText(/Could not load apps: .*responded 500/)).toBeInTheDocument();
  });

  it('prompts to select an app when none is chosen', async () => {
    stubFetch(routes());
    render(<AppsFeatures />);
    expect(await screen.findByText('Select an app')).toBeInTheDocument();
  });
});

describe('Work interactions', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const events = [
    event(), event({ id: 'r_2', task_description: 'Plan reports', intent: 'feature', lite: false, framework: 'openspec', external_ref: null, decision: { track: 'default', rule: 'r', reasons: [] }, last_routed_at: '2026-11-02T00:00:00.000Z' }),
    event({ id: 'r_3', task_description: 'Add export', feature_id: 'f_1', feature_slug: 'add-csv', feature_status: 'active', feature_phase: 'verify', lite: false, framework: 'spec-kit', commit_count: 4, intent: 'feature' }),
  ];
  const routes = (url: string) => {
    if (url === '/admin/api/apps') return { apps: [{ id: 'a_1', slug: 'checkout', name: 'C', features: [] }] };
    if (url.startsWith('/admin/api/routing/')) return { event: events[2], commits: [] };
    if (url.startsWith('/admin/api/routing')) return { events, summary: [{ intent: 'trivial', count: 1 }] };
    if (url === '/admin/api/features/f_1') return detail;
    throw new Error(`unexpected ${url}`);
  };

  it('sorts every column, searches, exports and applies quick date ranges', async () => {
    const calls = stubFetch(routes);
    stubDownload();
    render(<Work />);
    await screen.findByText('Plan reports');
    for (const btn of Array.from(document.querySelectorAll('button.sort'))) { fireEvent.click(btn); fireEvent.click(btn); }
    fireEvent.change(screen.getByLabelText('Search work'), { target: { value: 'nothing-matches' } });
    expect(screen.getByText('Nothing matches your search.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search work'), { target: { value: 'export' } });
    expect(screen.getByText('Add export')).toBeInTheDocument();
    expect(screen.queryByText('Plan reports')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(calls.some((c) => /\/admin\/api\/routing\?from=\d{4}-\d{2}-\d{2}$/.test(c))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Any time' }));
    await waitFor(() => expect(calls.filter((c) => c === '/admin/api/routing').length).toBeGreaterThanOrEqual(2));
  });

  it('hides its own app picker when a project is chosen in the sidebar, and scopes the request', async () => {
    const calls = stubFetch(routes);
    render(<Work app="checkout" />);
    await screen.findByText('Plan reports');
    expect(screen.queryByLabelText('App')).toBeNull();
    expect(calls).toContain('/admin/api/routing?app=checkout');
  });

  it('shows an error with a retry, and opens a routed task and its feature', async () => {
    stubFetch(() => { throw new Error('routing down'); });
    render(<Work />);
    expect(await screen.findByText(/Could not load routed work: .*responded 500/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    stubFetch(routes);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(await screen.findByText('Add export'));
    fireEvent.click(await screen.findByRole('button', { name: 'add-csv' }));
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
  });

  it('opens a row with the keyboard', async () => {
    stubFetch(routes);
    render(<Work />);
    const row = (await screen.findByText('Add export')).closest('tr')!;
    fireEvent.keyDown(row, { key: 'Tab' });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByText('No commits reported yet.')).toBeInTheDocument();
  });
});

describe('RoutingDetail variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows a load error with a retry', async () => {
    stubFetch(() => { throw new Error('gone'); });
    render(<RoutingDetail routingId="r_9" onBack={() => undefined} />);
    expect(await screen.findByText(/Could not load routing r_9: .*responded 500/)).toBeInTheDocument();
  });

  it('renders a feature-backed routing without a ticket, branch or commit date', async () => {
    stubFetch((url) => url.startsWith('/admin/api/features/') ? detail : ({
      event: event({ external_ref: null, feature_id: 'f_1', feature_slug: 'add-csv', feature_status: 'active', feature_phase: 'verify', framework: 'openspec', decision: { track: 'hotfix', rule: 'r', reasons: ['why'] }, workspace: { paths_touched: [] } }),
      commits: [{ id: 'c1', sha: 'abcdef123456', branch: null, message: 'msg', files_changed: [], committed_at: null, created_at: '2026-11-01T00:00:00.000Z' }],
    }));
    render(<RoutingDetail routingId="r_1" onBack={() => undefined} />);
    expect(await screen.findByText(/no ticket/)).toBeInTheDocument();
    expect(screen.getByText('openspec:hotfix', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Paths touched')).toBeNull();
    fireEvent.click(screen.getByText('0 file(s)'));
    fireEvent.click(screen.getByRole('button', { name: 'add-csv' }));
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
  });
});
