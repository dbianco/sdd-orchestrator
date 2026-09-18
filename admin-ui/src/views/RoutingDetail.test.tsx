import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoutingDetail } from './RoutingDetail';

const payload = {
  event: {
    id: 'r_1', app_id: 'a_1', app_slug: 'checkout', external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix the date picker', intent: 'trivial', framework: 'none',
    lite: true, route_count: 2, first_routed_at: '2026-09-18T10:00:00.000Z', last_routed_at: '2026-09-18T12:00:00.000Z', feature_id: null, feature_slug: null,
    feature_status: null, feature_phase: null, commit_count: 1, decision: { track: null, rule: '4-trivial', reasons: ['host set intent trivial'] }, workspace: { paths_touched: ['src/dates.ts'] },
  },
  commits: [{ id: 'cm_1', sha: 'abc1234def', branch: 'main', message: 'fix: date picker\n\nDetails', files_changed: ['src/dates.ts', 'src/dates.test.ts'], committed_at: '2026-09-18T11:00:00.000Z', created_at: '2026-09-18T11:01:00.000Z' }],
};

describe('RoutingDetail', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the decision, workspace paths, and commits with expandable files, and calls onBack', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const onBack = vi.fn();
    render(<RoutingDetail routingId="r_1" onBack={onBack} />);
    expect(await screen.findByText('Fix the date picker')).toBeInTheDocument();
    expect(screen.getByText('host set intent trivial')).toBeInTheDocument();
    expect(screen.getByText('src/dates.ts')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('fix: date picker')).toBeInTheDocument();
    fireEvent.click(screen.getByText('2 file(s)'));
    expect(screen.getByText('src/dates.test.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('← Back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows an empty commits state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...payload, commits: [] }) }));
    render(<RoutingDetail routingId="r_1" onBack={() => undefined} />);
    expect(await screen.findByText('No commits reported yet.')).toBeInTheDocument();
  });
});
