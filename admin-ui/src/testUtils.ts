import { vi } from 'vitest';

export type Handler = (url: string, init?: RequestInit) => unknown | Promise<unknown>;

/** Stubs fetch with a handler that returns a body, or throws to simulate a failed request. */
export function stubFetch(handler: Handler, calls: string[] = []): string[] {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(init?.method === 'POST' ? `POST ${url}` : url);
    try {
      const body = await handler(url, init);
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    } catch (e) {
      return { ok: false, status: 500, json: () => Promise.resolve({ error: e instanceof Error ? e.message : String(e) }) };
    }
  }));
  return calls;
}

export function stubDownload(): void {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
}
