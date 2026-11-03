import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Overview } from './Overview';
import { Flow } from './Flow';
import { FeatureDetail } from './FeatureDetail';
import { Findings } from './Findings';
import { RequirementList, RtmTable } from './Requirements';
import { stubFetch } from '../testUtils';

const overview = (over: Record<string, unknown> = {}) => ({
  features: [{ status: 'blocked', current_phase: 'plan', framework: 'x', track: null, count: 2 }, { status: 'active', current_phase: 'plan', framework: 'x', track: null, count: 1 }, { status: 'weird', current_phase: 'verify', framework: 'x', track: null, count: 1 }],
  checks: [{ check: 'a', blocker_count: 3, warning_count: 0 }, { check: 'b', blocker_count: 0, warning_count: 4 }], proposals: [{ status: 'pending', count: 1 }], knowledge: [{ kind: 'standard', memory_type: null, count: 2 }, { kind: 'standard', memory_type: 'adr', count: 3 }], ...over,
});

describe('Overview variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the reviewer to proposals and pluralises the banner', async () => {
    stubFetch((url) => (url.startsWith('/admin/api/overview') ? overview() : { error: 'none' }));
    const onNavigate = vi.fn();
    render(<Overview app="checkout" onNavigate={onNavigate} />);
    expect(await screen.findByText(/1 memory proposal is waiting for review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposals' }));
    expect(onNavigate).toHaveBeenCalledWith('proposals');
    expect(screen.getByText('5')).toBeInTheDocument(); // knowledge items of one kind are summed
  });

  it('pluralises many proposals, hides the banner without any, and orders unknown statuses last', async () => {
    stubFetch((url) => (url.startsWith('/admin/api/overview') ? overview({ proposals: [{ status: 'pending', count: 4 }] }) : {}));
    const { unmount } = render(<Overview onNavigate={() => undefined} />);
    expect(await screen.findByText(/4 memory proposals are waiting for review/)).toBeInTheDocument();
    const labels = Array.from(document.querySelectorAll('.tile-label')).map((n) => n.textContent);
    expect(labels).toEqual(['active', 'blocked', 'weird']);
    unmount();
    vi.unstubAllGlobals();
    stubFetch((url) => (url.startsWith('/admin/api/overview') ? overview({ proposals: [] }) : {}));
    render(<Overview onNavigate={() => undefined} />);
    await screen.findByText('Checks with the most blockers');
    expect(screen.queryByText(/waiting for review/)).toBeNull();
  });

  it('shows an error with a retry', async () => {
    stubFetch(() => { throw new Error('x'); });
    render(<Overview />);
    expect(await screen.findByText(/Could not load the overview/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  });

  it('describes cycle time with no finished work, no rework headline numbers and backward moves', async () => {
    const cycle = {
      features: 2, archived: 0, median_cycle_hours: null, median_spec_hours: 0.5, median_build_hours: 100, spec_share: null, phase_median_hours: { specify: 0.5, learn: 100 },
      rework: { features_with_rework: 0, median_rework_hours: null, failed_attempts: 0, backward_moves: 3 },
      by_track: [{ framework: 'bmad', track: null, features: 2, archived: 0, median_cycle_hours: null, median_spec_hours: 0.5, median_build_hours: 100, spec_share: null, avg_failed_attempts: 0 }],
    };
    stubFetch((url) => (url.startsWith('/admin/api/cycle') ? cycle : overview()));
    render(<Overview />);
    expect(await screen.findByText('Where does the time go?')).toBeInTheDocument();
    expect(screen.getByText('No feature needed rework after a failed gate.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/3 backward move\(s\)/)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders the value card with a low first-pass week and no approvals waiting', async () => {
    const metrics = { weeks: [{ week: '2026-10-26', total: 0, passed: 0 }, { week: '2026-11-02', total: 10, passed: 2 }], first_pass_rate: null, caught: { failed_transitions: 0, features: 0 }, approvals: { decided: 0, pending: 0, avg_hours: null, median_hours: null, oldest_pending_hours: null } };
    stubFetch((url) => (url.startsWith('/admin/api/metrics') ? metrics : overview()));
    render(<Overview />);
    expect(await screen.findByText('Is the process paying off?')).toBeInTheDocument();
    expect(document.querySelectorAll('.spark > span.low')).toHaveLength(2);
  });

  it('reports plural right-sizing with an unknown time to archive', async () => {
    const sizing = { thresholds: { max_files: 3, max_requirements: 2 }, archived_full_track: 3, tiny: 2, share: null, entries: [{ feature_id: 'f_1', slug: 'a', framework: 'x', track: null, files: 1, requirements: 0, cycle_hours: null }] };
    stubFetch((url) => (url.startsWith('/admin/api/rightsizing') ? sizing : overview()));
    render(<Overview />);
    expect(await screen.findByText('Right-sizing the process')).toBeInTheDocument();
  });
});

describe('Flow variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('colours failing edges and reports the worst one', async () => {
    stubFetch(() => ({ flow: [
      { from_phase: 'verify', to_phase: 'integrate', result: 'fail', count: 5 }, { from_phase: 'verify', to_phase: 'integrate', result: 'pass', count: 5 }, { from_phase: 'plan', to_phase: 'tasks', result: 'pass', count: 2 },
    ] }));
    render(<Flow app="x" />);
    expect(await screen.findByText(/Most failures: verify → integrate \(5\)/)).toBeInTheDocument();
  });

  it('omits the worst-edge sentence when nothing failed, and shows errors with a retry', async () => {
    stubFetch(() => ({ flow: [{ from_phase: 'plan', to_phase: 'tasks', result: 'pass', count: 2 }] }));
    const { unmount } = render(<Flow />);
    expect(await screen.findByText('2 transitions, 0% blocked by a gate.')).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    stubFetch(() => { throw new Error('x'); });
    render(<Flow />);
    expect(await screen.findByText(/Could not load flow data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  });
});

describe('FeatureDetail variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows a blocked feature with every transition flag, and findings without a message or location', async () => {
    stubFetch((url) => (url === '/admin/api/gate-hints' ? { hints: { verify_evidence: { title: 'Evidence', fix: 'Fix it' } } } : {
      feature: { feature_id: 'f_1', slug: 'x', app_id: 'a', framework: 'openspec', track: 'hotfix', current_phase: 'plan', status: 'blocked', blocked_reason: 'three failed cycles', updated_at: '2026-11-01T00:00:00.000Z' },
      transitions: [
        { id: 't1', from_phase: 'implement', to_phase: 'plan', direction: 'backward', result: 'pass', findings: [], human_approved: true, reason: 'spec was wrong', created_at: '2026-11-01T00:00:00.000Z' },
        { id: 't2', from_phase: 'plan', to_phase: 'tasks', result: 'fail', findings: [{ check: 'verify_evidence', severity: 'blocker', location: 'tests.failed', message: '' }, { check: 'other', severity: 'warning', location: null, message: 'm' }], human_approved: false, reason: null, created_at: '2026-11-01T01:00:00.000Z' },
      ],
      requirements: [{ id: 'R1', covered: true }, { id: 'R2', covered: false }, { id: 'R3', covered: null }],
    }));
    render(<FeatureDetail featureId="f_1" onBack={() => undefined} />);
    expect(await screen.findByText('three failed cycles')).toBeInTheDocument();
    expect(screen.getByText('openspec:hotfix')).toBeInTheDocument();
    expect(screen.getByText('backward')).toBeInTheDocument();
    expect(screen.getByText('human approved')).toBeInTheDocument();
    expect(screen.getByText('spec was wrong')).toBeInTheDocument();
    expect(await screen.findByText('Fix it', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('covered')).toBeInTheDocument();
    expect(screen.getByText('uncovered')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    stubFetch(() => { throw new Error('x'); });
    render(<FeatureDetail featureId="f_9" onBack={() => undefined} />);
    expect(await screen.findByText(/Could not load feature f_9/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  });
});

describe('Findings hints', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders findings even when the hints cannot be loaded', async () => {
    stubFetch(() => { throw new Error('no hints'); });
    render(<Findings findings={[{ check: 'c', severity: 'blocker', location: null, message: 'bad' }]} />);
    await waitFor(() => expect(screen.getByText(/bad/)).toBeInTheDocument());
    expect(screen.queryByText('Fix it')).toBeNull();
  });
});

describe('Requirements', () => {
  it('shows empty lists and tolerates missing evidence columns', () => {
    const { container } = render(<><RequirementList requirements={[]} /><RtmTable rows={[]} onOpenFeature={() => undefined} /></>);
    expect(container.textContent).toContain('No requirements captured.');
    expect(container.textContent).toContain('No requirements captured in this app yet');
  });

  it('renders every coverage state in the matrix', () => {
    const base = { feature_id: 'f', slug: 's', external_ref: null, files_changed: [], tests_passed: null, tests_failed: null, evidence_source: null, spec_approved_by: null, verify_approved_by: null, archived_at: null };
    render(<RtmTable onOpenFeature={() => undefined} rows={[{ ...base, req_id: 'A', covered: true }, { ...base, req_id: 'B', covered: false, tests_passed: 4, tests_failed: null, evidence_source: 'host' }, { ...base, req_id: 'C', covered: null }]} />);
    expect(screen.getByText('4 passed, 0 failed')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 requirements covered by evidence.')).toBeInTheDocument();
  });
});
