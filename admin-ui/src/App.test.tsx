import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the tab navigation and switches between tabs', async () => {
    const emptyPayload = { flow: [], features: [], checks: [], proposals: [], knowledge: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(emptyPayload) }));
    render(<App />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
  });

  it('scopes every view to the project chosen in the sidebar', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(url);
      const body = url === '/admin/api/apps' ? { apps: [{ id: 'a_1', slug: 'checkout', name: 'Checkout', features: [] }] } : { flow: [], features: [], checks: [], proposals: [], knowledge: [], approvals: [], events: [], summary: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }));
    try { localStorage.removeItem('sdd-app'); } catch { /* ignore */ }
    window.location.hash = '/overview';
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'checkout' } });
    await waitFor(() => expect(calls).toContain('/admin/api/overview?app=checkout'));
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    await waitFor(() => expect(calls).toContain('/admin/api/flow?app=checkout'));
    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    await waitFor(() => expect(calls).toContain('/admin/api/routing?app=checkout'));
    expect(screen.queryByLabelText('App')).toBeNull();
    try { localStorage.removeItem('sdd-app'); } catch { /* ignore */ }
  });
});
