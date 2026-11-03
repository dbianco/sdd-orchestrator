import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

const approval = (status: string) => ({ id: `ap_${status}`, status });

function stubApi(extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = url.split('?')[0]!;
    const body: Record<string, unknown> = {
      '/admin/api/apps': { apps: [{ id: 'a_1', slug: 'checkout', name: 'C', features: [] }, { id: 'a_2', slug: 'billing', name: 'B', features: [] }] },
      '/admin/api/approvals': { approvals: [approval('pending'), approval('pending'), approval('approved')] },
      '/admin/api/me': { actor: 'erin', canApprove: true },
      '/admin/api/week': { actor: 'erin', days: 7, actors: ['erin'], shipped: [], worked_on: [], transitions: { passed: 0, failed: 0 }, caught: [], approvals: { decided: 0, approved: 0, rejected: 0, requested: 0, avg_wait_hours: null } },
      ...extra,
    };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body[path] ?? { flow: [], features: [], checks: [], proposals: [], knowledge: [], weeks: [], by_track: [], events: [], summary: [], drift: [], entries: [] }) });
  }));
}

describe('App shell', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } window.location.hash = '/overview'; });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme'); });

  it('shows the pending-approvals count and who is signed in', async () => {
    stubApi();
    render(<App />);
    expect(await screen.findByTitle('2 waiting for approval')).toHaveTextContent('2');
    expect(await screen.findByText('erin')).toBeInTheDocument();
  });

  it('drives navigation, project and theme from the command palette', async () => {
    stubApi();
    render(<App />);
    await screen.findByLabelText('Project');
    const palette = async (query: string) => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      fireEvent.change(await screen.findByLabelText('Search commands'), { target: { value: query } });
      fireEvent.keyDown(screen.getByLabelText('Search commands'), { key: 'Enter' });
    };
    await palette('go to flow');
    await waitFor(() => expect(window.location.hash).toBe('#/flow'));
    await palette('project: billing');
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('billing'));
    expect(localStorage.getItem('sdd-app')).toBe('billing');
    await palette('all projects');
    await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe(''));
    expect(localStorage.getItem('sdd-app')).toBeNull();
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.length;
    await palette('refresh');
    await waitFor(() => expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls.length).toBeGreaterThan(calls));
    await palette('toggle');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeTruthy());
  });

  it('toggles the theme relative to the system preference and remembers it', async () => {
    stubApi();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Theme/ }));
    expect(document.documentElement.dataset.theme).toBe('light'); // the system is dark, so the first toggle goes light
    expect(localStorage.getItem('sdd-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /Theme/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('works when browser storage is unavailable', async () => {
    stubApi();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'checkout' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Theme/ }));
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument();
  });

  it('forgets a remembered project that no longer exists, and follows the browser hash', async () => {
    stubApi();
    localStorage.setItem('sdd-app', 'ghost');
    render(<App />);
    await waitFor(() => expect(localStorage.getItem('sdd-app')).toBeNull());
    act(() => { window.location.hash = '/work'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('region', { name: 'About Work' })).toBeInTheDocument();
    act(() => { window.location.hash = '/nonsense'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('region', { name: 'About Overview' })).toBeInTheDocument();
  });

  it('renders every section from the tab bar', async () => {
    stubApi();
    render(<App />);
    for (const name of ['My week', 'Apps & Features', 'Work', 'Approvals', 'Proposals', 'Flow', 'Spec drift', 'Overview']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
      await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-current', 'page'));
    }
  });
});
