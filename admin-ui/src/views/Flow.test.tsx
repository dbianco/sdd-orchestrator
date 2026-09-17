import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Flow } from './Flow';

describe('Flow', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders a phase-by-phase matrix summing counts across pass/fail for the same edge', async () => {
    const payload = { flow: [
      { from_phase: 'verify', to_phase: 'integrate', result: 'pass', count: 15 },
      { from_phase: 'verify', to_phase: 'integrate', result: 'fail', count: 8 },
    ] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    render(<Flow />);
    expect(await screen.findByText('23')).toBeInTheDocument();
  });

  it('shows an empty state when there are no transitions yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ flow: [] }) }));
    render(<Flow />);
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
  });
});
