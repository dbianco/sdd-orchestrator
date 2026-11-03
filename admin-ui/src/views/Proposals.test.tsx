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

  it('filters to the selected project', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve(url === '/admin/api/apps'
      ? { apps: [{ id: 'a_1', slug: 'checkout', name: 'C', features: [] }] }
      : { proposals: [
        { id: 'p_mine', app_id: 'a_1', feature_id: 'f_1', status: 'pending', created_at: '2026-09-17T00:00:00.000Z', created_by: 'agent' },
        { id: 'p_other', app_id: 'a_2', feature_id: 'f_2', status: 'pending', created_at: '2026-09-17T00:00:00.000Z', created_by: 'agent' }] }) })));
    render(<Proposals app="checkout" />);
    expect(await screen.findByText('p_mine')).toBeInTheDocument();
    expect(screen.queryByText('p_other')).toBeNull();
  });
});
