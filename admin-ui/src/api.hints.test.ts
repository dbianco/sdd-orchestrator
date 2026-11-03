import { describe, it, expect, vi, afterEach } from 'vitest';

describe('getGateHints', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('fetches once, caches the result and treats a missing hints field as empty', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ hints: { a: { title: 'A', fix: 'fix' } } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { getGateHints } = await import('./api');
    expect(await getGateHints()).toEqual({ a: { title: 'A', fix: 'fix' } });
    await getGateHints();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    expect(await (await import('./api')).getGateHints()).toEqual({});
  });

  it('falls back to no hints when an older server answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })));
    const { getGateHints } = await import('./api');
    expect(await getGateHints()).toEqual({});
  });
});
