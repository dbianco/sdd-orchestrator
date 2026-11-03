import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MyWeek } from './MyWeek';

const week = {
  actor: 'dana', days: 7, actors: ['dana', 'erin'],
  shipped: [{ feature_id: 'f_1', slug: 'refund-page', at: '2026-11-01T10:00:00.000Z' }],
  worked_on: [{ feature_id: 'f_2', slug: 'add-csv', status: 'active', current_phase: 'verify' }],
  transitions: { passed: 4, failed: 2 },
  caught: [{ check: 'requirement_coverage', count: 2, example: 'FR-003 is not covered' }],
  approvals: { decided: 1, approved: 1, rejected: 0, requested: 2, avg_wait_hours: 3 },
};

describe('MyWeek', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows what the gates caught, with the fix, and switches person', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(url);
      const body = url.startsWith('/admin/api/gate-hints') ? { hints: { requirement_coverage: { title: 'Requirement not covered by evidence', fix: 'Add the id to evidence.implements.' } } } : week;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }));
    render(<MyWeek app="checkout" />);
    expect(await screen.findByText('Requirement not covered by evidence')).toBeInTheDocument();
    expect(screen.getByText('Add the id to evidence.implements.')).toBeInTheDocument();
    expect(screen.getByText('refund-page')).toBeInTheDocument();
    expect(screen.getByText(/waited 3h on average/)).toBeInTheDocument();
    expect(calls).toContain('/admin/api/week?app=checkout&days=7');
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'erin' } });
    await waitFor(() => expect(calls).toContain('/admin/api/week?app=checkout&actor=erin&days=7'));
  });

  it('shows an empty state when nothing was recorded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...week, transitions: { passed: 0, failed: 0 }, shipped: [], worked_on: [], caught: [], approvals: { decided: 0, approved: 0, rejected: 0, requested: 0, avg_wait_hours: null } }) })));
    render(<MyWeek />);
    expect(await screen.findByText(/Nothing recorded for dana/)).toBeInTheDocument();
  });
});
