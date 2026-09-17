import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Proposals } from './Proposals';

describe('Proposals', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists proposals with their status', async () => {
    const payload = { proposals: [{ id: 'p_1', app_id: 'a_1', feature_id: 'f_1', status: 'pending', created_at: '2026-09-17T00:00:00.000Z', created_by: 'agent' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    render(<Proposals />);
    expect(await screen.findByText('p_1')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows an empty state when there are no proposals yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ proposals: [] }) }));
    render(<Proposals />);
    expect(await screen.findByText('No proposals yet.')).toBeInTheDocument();
  });
});
