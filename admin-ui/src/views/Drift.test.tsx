import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drift } from './Drift';

const entry = {
  feature_id: 'f_1', slug: 'refund-policy-page', app: 'demo', archived_at: '2026-10-30T00:00:00.000Z', level: 'likely', unspecced_commits: 1, other_feature_commits: 1, last_changed_at: '2026-11-02T00:00:00.000Z',
  files: [{ file: 'src/legal/refunds.tsx', commits: [{ sha: 'd4e5f6a7b8c9', message: 'fix: refund policy typo', at: '2026-11-02T00:00:00.000Z', feature_slug: null }] }],
};
const review = { ...entry, feature_id: 'f_2', slug: 'old-banner', level: 'review', unspecced_commits: 0, other_feature_commits: 2, files: [{ file: 'src/banner.ts', commits: [{ sha: 'abc1234def', message: 'feat: new banner', at: '2026-11-01T00:00:00.000Z', feature_slug: 'new-banner' }] }] };

describe('Drift', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists likely-stale specs first with the commits that changed their files', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ drift: [review, entry] }) }); }));
    render(<Drift app="demo" />);
    expect(await screen.findByText('refund-policy-page')).toBeInTheDocument();
    expect(calls).toContain('/admin/api/drift?app=demo');
    expect(screen.getByText('1 likely stale, 1 to review. Archived specs whose files changed again.')).toBeInTheDocument();
    const names = screen.getAllByRole('row').slice(1).map((r) => r.querySelector('button.link')?.textContent);
    expect(names).toEqual(['refund-policy-page', 'old-banner']);
    fireEvent.click(screen.getAllByText('1 file(s)')[0]!);
    expect(screen.getByText('src/legal/refunds.tsx')).toBeInTheDocument();
    expect(screen.getByText(/no feature, no spec/)).toBeInTheDocument();
    expect(screen.getByText('likely stale')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ drift: [] }) })));
    render(<Drift />);
    expect(await screen.findByText('No drift found.')).toBeInTheDocument();
  });
});
