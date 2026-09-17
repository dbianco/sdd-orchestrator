import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppsFeatures } from './AppsFeatures';

describe('AppsFeatures', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists apps, then that app\'s features once selected, then a feature detail placeholder', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/admin/api/apps') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ apps: [{ id: 'a_1', slug: 'checkout', name: 'Checkout', features: [{ status: 'active', current_phase: 'verify', framework: 'mini', track: 'default', count: 2 }] }] }) });
      }
      if (url === '/admin/api/apps/checkout/features') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: [{ feature_id: 'f_1', slug: 'add-csv', intent: 'feature', framework: 'mini', track: 'default', current_phase: 'verify', status: 'active', external_ref: null, trigger_ref: null, updated_at: '2026-09-17T00:00:00.000Z' }] }) });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AppsFeatures />);
    expect(await screen.findByText('checkout')).toBeInTheDocument();
    fireEvent.click(screen.getByText('checkout'));
    expect(await screen.findByText('add-csv')).toBeInTheDocument();
    // Detail drill-down itself is covered by FeatureDetail.test.tsx; here we only confirm the
    // click navigates away from the features table.
    fireEvent.click(screen.getByText('add-csv'));
    expect(screen.queryByText('add-csv')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no apps yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ apps: [] }) }));
    render(<AppsFeatures />);
    expect(await screen.findByText('No apps yet.')).toBeInTheDocument();
  });
});
