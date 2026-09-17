import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureDetail } from './FeatureDetail';

describe('FeatureDetail', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the feature header and its transition timeline, and calls onBack', async () => {
    const payload = {
      feature: { feature_id: 'f_1', slug: 'add-csv', app_id: 'a_1', framework: 'mini', track: 'default', current_phase: 'verify', status: 'active', blocked_reason: null, updated_at: '2026-09-17T00:00:00.000Z' },
      transitions: [{ id: 't_1', from_phase: 'specify', to_phase: 'implement', direction: 'forward', result: 'pass', findings: [], human_approved: true, reason: null, created_at: '2026-09-17T00:00:00.000Z' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const onBack = vi.fn();
    render(<FeatureDetail featureId="f_1" onBack={onBack} />);
    expect(await screen.findByText('add-csv')).toBeInTheDocument();
    expect(screen.getByText('specify')).toBeInTheDocument();
    fireEvent.click(screen.getByText('← Back'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
