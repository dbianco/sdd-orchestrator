import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Approvals } from './Approvals';
import { Drift } from './Drift';
import { MyWeek } from './MyWeek';
import { Proposals } from './Proposals';
import { stubDownload, stubFetch } from '../testUtils';

const proposal = (over: Record<string, unknown> = {}) => ({ id: 'p_1', app_id: 'a_1', feature_id: 'f_1', status: 'pending', created_at: '2026-11-01T00:00:00.000Z', created_by: 'agent', payload: { kind: 'app_memory', memory_type: 'decision', title: 'Stream exports', body: 'Rows stream.', links: ['https://x/adr'] }, ...over });

describe('Proposals review', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const routes = (list: unknown[], me: unknown = { actor: 'erin', canApprove: true }, post?: (url: string) => unknown) => (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { if (post) return post(url); return {}; }
    if (url === '/admin/api/me') return me;
    if (url === '/admin/api/apps') return { apps: [{ id: 'a_1', slug: 'checkout', name: 'C', features: [] }] };
    return { proposals: list };
  };

  it('sorts, filters by status, exports and shows reviewed proposals read-only', async () => {
    stubFetch(routes([proposal(), proposal({ id: 'p_2', status: 'approved', reviewed_by: 'erin', review_reason: 'good', payload: { title: 'Policy pages' }, created_at: '2026-10-01T00:00:00.000Z' }), proposal({ id: 'p_3', status: 'rejected', payload: undefined })]));
    stubDownload();
    render(<Proposals />);
    await screen.findByText('Stream exports');
    for (const btn of Array.from(document.querySelectorAll('button.sort'))) { fireEvent.click(btn); fireEvent.click(btn); }
    fireEvent.click(screen.getByRole('button', { name: 'Approved (1)' }));
    expect(screen.queryByText('Stream exports')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rejected (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByText('This server version does not send the proposal text.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approved (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByText(/Reviewed by erin: good/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept into knowledge base' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pending (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('https://x/adr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  });

  it('shows the server message when a rejection fails', async () => {
    stubFetch(routes([proposal()], undefined, () => { throw new Error('Embedding provider down'); }));
    render(<Proposals />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept into knowledge base' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: '  duplicate  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(await screen.findByText('Embedding provider down')).toBeInTheDocument();
  });

  it('shows the server message when a decision fails, then a toast when it succeeds', async () => {
    let attempt = 0;
    stubFetch((url, init) => {
      if (init?.method === 'POST') { attempt += 1; if (attempt === 1) throw new Error('boom'); return {}; }
      return routes([proposal()])(url, init);
    });
    render(<Proposals />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept into knowledge base' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Accept into knowledge base' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept into knowledge base' }));
    expect(await screen.findByText(/Approved “Stream exports”/)).toBeInTheDocument();
  });

  it('confirms a rejection', async () => {
    stubFetch(routes([proposal()]));
    render(<Proposals />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    await waitFor(() => expect(screen.getByLabelText('Reason for rejecting')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: 'dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(await screen.findByText(/Rejected “Stream exports”/)).toBeInTheDocument();
  });

  it('scopes to a project, and explains an empty project and an empty status', async () => {
    stubFetch(routes([proposal({ app_id: 'a_other' })]));
    render(<Proposals app="checkout" />);
    expect(await screen.findByText('Nothing proposed for checkout.')).toBeInTheDocument();
    vi.unstubAllGlobals();
    stubFetch(routes([proposal()]));
    render(<Proposals />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Rejected (0)' }))[0]!);
    expect(screen.getAllByText('Nothing in this status.')).not.toHaveLength(0);
  });

  it('shows a load error with a retry', async () => {
    stubFetch(() => { throw new Error('x'); });
    render(<Proposals />);
    expect(await screen.findByText(/Could not load proposals/)).toBeInTheDocument();
  });
});

describe('Approvals decisions', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const row = { id: 'ap_1', feature_id: 'f_1', transition_id: 't_1', from_phase: 'specify', to_phase: 'implement', status: 'pending', requested_by: 'dana', decided_by: null, decided_at: null, comment: null, created_at: '2026-11-03T00:00:00.000Z', app: 'checkout', feature_slug: 'add-csv', framework: 'openspec', track: null };
  const detail = (over: Record<string, unknown> = {}) => ({
    approval: row, feature: { feature_id: 'f_1', slug: 'add-csv', framework: 'openspec', track: 'default', high_risk: true },
    findings: [{ check: 'measurable_criteria', severity: 'warning', location: null, message: 'vague' }], evidence: { tests: { passed: 3 } },
    artifacts: [{ name: 'a.md', byte_length: 10, content: 'A' }, { name: 'b.md', byte_length: 99999, content: null }], requirements: [], ...over,
  });
  const routes = (d: unknown, me: unknown = { actor: 'erin', canApprove: true }, post?: () => unknown) => (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return post ? post() : {};
    if (url === '/admin/api/me') return me;
    if (url === '/admin/api/gate-hints') return { hints: {} };
    if (url.startsWith('/admin/api/approvals/')) return d;
    return { approvals: [row] };
  };

  it('shows everything a reviewer needs, then approves with a comment and confirms', async () => {
    const calls = stubFetch(routes(detail()));
    render(<Approvals />);
    fireEvent.click(await screen.findByText('add-csv'));
    expect(await screen.findByText('high risk')).toBeInTheDocument();
    expect(screen.getByText('No requirement ids found.')).toBeInTheDocument();
    expect(screen.getByText(/only its hash was recorded/)).toBeInTheDocument();
    expect(screen.getByText(/"passed": 3/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Comment (optional)'), { target: { value: ' ship it ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approved add-csv')).toBeInTheDocument();
    expect(calls).toContain('POST /admin/api/approvals/ap_1/approve');
  });

  it('shows the server error when a decision fails and lets the reviewer try again', async () => {
    stubFetch(routes(detail({ findings: [], evidence: null, requirements: null, artifacts: [] }), undefined, () => { throw new Error('stale'); }));
    render(<Approvals />);
    fireEvent.click(await screen.findByText('add-csv'));
    expect(await screen.findByText('No artifacts submitted.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('stale');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('goes back to the list and hides decisions for a request that is already decided', async () => {
    stubFetch(routes(detail({ approval: { ...row, status: 'approved' } })));
    render(<Approvals />);
    fireEvent.click(await screen.findByText('add-csv'));
    await screen.findByText('high risk');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByText(/Back/));
    expect(await screen.findByText('Approvals')).toBeInTheDocument();
  });

  it('opens a row with Enter and shows load errors with a retry', async () => {
    stubFetch(routes(detail()));
    render(<Approvals />);
    const tr = (await screen.findByText('add-csv')).closest('tr')!;
    fireEvent.keyDown(tr, { key: 'a' });
    fireEvent.keyDown(tr, { key: 'Enter' });
    expect(await screen.findByText('high risk')).toBeInTheDocument();
    vi.unstubAllGlobals();
    stubFetch((url) => { if (url === '/admin/api/approvals/ap_1') throw new Error('gone'); return routes(detail())(url); });
    fireEvent.click(screen.getByText(/Back/));
    fireEvent.click((await screen.findByText('add-csv')).closest('tr')!);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  });

  it('retries the list when loading fails', async () => {
    stubFetch(() => { throw new Error('down'); });
    render(<Approvals />);
    expect(await screen.findByText(/Could not load approvals/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  });
});

describe('MyWeek variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const week = (over: Record<string, unknown> = {}) => ({
    actor: 'dana', days: 7, actors: ['dana'], shipped: [], worked_on: [{ feature_id: 'f_1', slug: 'done-already', status: 'archived', current_phase: 'archived' }], transitions: { passed: 1, failed: 0 },
    caught: [], approvals: { decided: 0, approved: 0, rejected: 0, requested: 1, avg_wait_hours: null }, ...over,
  });

  it('switches the period, handles quiet weeks and unknown checks', async () => {
    const calls = stubFetch((url) => (url.startsWith('/admin/api/gate-hints') ? { hints: {} } : week()));
    render(<MyWeek />);
    expect(await screen.findByText('No gate blockers. Clean run.')).toBeInTheDocument();
    expect(screen.getByText('Nothing archived in this period.')).toBeInTheDocument();
    expect(screen.getByText('Nothing open.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    await waitFor(() => expect(calls).toContain('/admin/api/week?days=30'));
  });

  it('names a check without a hint by its id, and shows an error with a retry', async () => {
    stubFetch((url) => (url.startsWith('/admin/api/gate-hints') ? { hints: {} } : week({ caught: [{ check: 'custom_check', count: 2, example: null }] })));
    render(<MyWeek />);
    expect(await screen.findByText('custom_check')).toBeInTheDocument();
    vi.unstubAllGlobals();
    stubFetch(() => { throw new Error('down'); });
    render(<MyWeek app="x" />);
    expect(await screen.findAllByText(/Could not load your activity/)).not.toHaveLength(0);
  });
});

describe('Drift variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const entry = (over: Record<string, unknown> = {}) => ({
    feature_id: 'f_1', slug: 'refund', app: 'demo', archived_at: '2026-10-30T00:00:00.000Z', level: 'likely', unspecced_commits: 1, other_feature_commits: 0, last_changed_at: '2026-11-02T00:00:00.000Z',
    files: [{ file: 'a.ts', commits: [{ sha: 'abcdef1234', message: 'fix', at: '2026-11-02T00:00:00.000Z', feature_slug: null }] }], ...over,
  });

  it('sorts, exports and opens the feature, and goes back', async () => {
    stubFetch((url) => (url.startsWith('/admin/api/features/') ? { feature: { feature_id: 'f_1', slug: 'refund', app_id: 'a', framework: 'x', track: null, current_phase: 'archived', status: 'archived', blocked_reason: null, updated_at: '2026-11-01T00:00:00.000Z' }, transitions: [], requirements: [] } : { drift: [entry(), entry({ feature_id: 'f_2', slug: 'banner', level: 'review', unspecced_commits: 0, other_feature_commits: 2 })] }));
    stubDownload();
    render(<Drift />);
    await screen.findByText('banner');
    for (const btn of Array.from(document.querySelectorAll('button.sort'))) { fireEvent.click(btn); fireEvent.click(btn); }
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'refund' }));
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('← Back'));
    expect(await screen.findByText('banner')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    stubFetch(() => { throw new Error('x'); });
    render(<Drift app="demo" />);
    expect(await screen.findByText(/Could not load the drift report/)).toBeInTheDocument();
  });
});
