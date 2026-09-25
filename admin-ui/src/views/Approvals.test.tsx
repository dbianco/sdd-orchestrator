import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Approvals } from './Approvals';

const approval = {
  id: 'ap_1', feature_id: 'f_1', transition_id: 't_1', from_phase: 'specify', to_phase: 'implement', status: 'pending', requested_by: 'dana',
  decided_by: null, decided_at: null, comment: null, created_at: '2026-09-25T00:00:00.000Z', app: 'checkout', feature_slug: 'add-csv', framework: 'openspec', track: 'default',
};
const detail = {
  approval, feature: { feature_id: 'f_1', slug: 'add-csv', framework: 'openspec', track: 'default', high_risk: false },
  findings: [], evidence: null, artifacts: [{ name: 'proposal.md', byte_length: 12, content: '## Why\nCSV\n' }], requirements: ['FR-001'],
};

function stub(me: { actor: string; canApprove: boolean }, posts: { url: string; body: unknown }[] = []) {
  let pending = [approval];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      pending = [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    const body = url === '/admin/api/me' ? me : url === '/admin/api/approvals' ? { approvals: pending } : url === '/admin/api/approvals/ap_1' ? detail : null;
    if (!body) throw new Error(`unexpected fetch: ${url}`);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }));
}

describe('Approvals', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists pending requests and shows one with its artifacts and requirements', async () => {
    stub({ actor: 'erin', canApprove: true });
    render(<Approvals />);
    fireEvent.click(await screen.findByText('add-csv'));
    expect(await screen.findByText('FR-001')).toBeInTheDocument();
    expect(screen.getByText('proposal.md (12 bytes)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('disables decisions for a read-only login', async () => {
    stub({ actor: 'admin-token', canApprove: false });
    render(<Approvals />);
    fireEvent.click(await screen.findByText('add-csv'));
    expect(await screen.findByText(/read-only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('rejects with a reason and returns to a refreshed list', async () => {
    const posts: { url: string; body: unknown }[] = [];
    stub({ actor: 'erin', canApprove: true }, posts);
    render(<Approvals />);
    fireEvent.click(await screen.findByText('add-csv'));
    fireEvent.change(await screen.findByLabelText('Reason for rejecting'), { target: { value: 'criteria contradict' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Nothing waits for approval.')).toBeInTheDocument();
    await waitFor(() => expect(posts).toEqual([{ url: '/admin/api/approvals/ap_1/reject', body: { reason: 'criteria contradict' } }]));
  });
});
