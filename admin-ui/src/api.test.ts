import { describe, it, expect, vi, afterEach } from 'vitest';
import { getOverview } from './api';

describe('getOverview', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the overview endpoint and returns parsed JSON', async () => {
    const payload = { features: [], checks: [], proposals: [], knowledge: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const result = await getOverview();
    expect(fetch).toHaveBeenCalledWith('/admin/api/overview');
    expect(result).toEqual(payload);
  });

  it('appends the app query param when given', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    await getOverview('checkout');
    expect(fetch).toHaveBeenCalledWith('/admin/api/overview?app=checkout');
  });

  it('throws ApiError on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }));
    await expect(getOverview()).rejects.toThrow('/admin/api/overview responded 503');
  });
});
