import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
