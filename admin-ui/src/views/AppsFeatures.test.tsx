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
      if (url === '/admin/api/features/f_1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          feature: { feature_id: 'f_1', slug: 'add-csv', app_id: 'a_1', framework: 'mini', track: 'default', current_phase: 'verify', status: 'active', blocked_reason: null, updated_at: '2026-09-17T00:00:00.000Z' },
          transitions: [], requirements: [],
        }) });
      }
      if (url === '/admin/api/apps/checkout/rtm') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ app: 'checkout', rows: [
          { feature_id: 'f_1', slug: 'add-csv', external_ref: 'YAL-9', req_id: 'FR-001', covered: true, files_changed: ['src/a.ts'], tests_passed: 7, tests_failed: 0, evidence_source: 'host', spec_approved_by: 'dana', verify_approved_by: null, archived_at: null },
          { feature_id: 'f_1', slug: 'add-csv', external_ref: 'YAL-9', req_id: 'FR-002', covered: false, files_changed: [], tests_passed: 7, tests_failed: 0, evidence_source: 'host', spec_approved_by: 'dana', verify_approved_by: null, archived_at: null },
        ] }) });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AppsFeatures />);
    expect(await screen.findByText('checkout')).toBeInTheDocument();
    fireEvent.click(screen.getByText('checkout'));
    expect((await screen.findAllByText('add-csv')).length).toBeGreaterThan(0);
    expect(await screen.findByText('FR-002')).toBeInTheDocument();
    expect(screen.getByText('uncovered')).toBeInTheDocument();
    expect(screen.getAllByText('7 passed, 0 failed')).toHaveLength(2);
    // Detail drill-down itself is covered by FeatureDetail.test.tsx; here we only confirm the
    // click navigates to the feature detail view (awaited so FeatureDetail's fetch settles
    // inside act() before the test ends).
    fireEvent.click(screen.getAllByText('add-csv')[0]!);
    expect(await screen.findByText('No transitions recorded yet.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no apps yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ apps: [] }) }));
    render(<AppsFeatures />);
    expect(await screen.findByText('No apps yet.')).toBeInTheDocument();
  });
});
