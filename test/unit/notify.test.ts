import { describe, it, expect, vi } from 'vitest';
import { approvalMessage, createNotifier } from '../../src/notify.js';

const event = { approval_id: 'ap_1', app: 'checkout', feature: 'add-csv', from_phase: 'specify', to_phase: 'implement', requested_by: 'dana' };

describe('notifier', () => {
  it('is off without a webhook url', () => {
    expect(createNotifier({ webhookUrl: null, publicUrl: null })).toBeUndefined();
  });

  it('formats a message with a link to the approvals page', () => {
    expect(approvalMessage(event, 'https://sdd.example/')).toBe('Approval needed: checkout / add-csv wants to move specify -> implement (requested by dana). Review it: https://sdd.example/admin/#/approvals');
    expect(approvalMessage(event, null)).not.toMatch(/Review it/);
  });

  it('posts a chat-compatible payload and swallows delivery failures', async () => {
    const calls: { url: string; body: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response('ok'); });
    createNotifier({ webhookUrl: 'https://hooks.example/x', publicUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch })!.approvalRequested(event);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe('https://hooks.example/x');
    expect(calls[0]!.body.text).toBe(calls[0]!.body.content);
    const warn = vi.fn();
    const failing = vi.fn(async () => { throw new Error('down'); });
    expect(() => createNotifier({ webhookUrl: 'https://hooks.example/x', publicUrl: null, logger: { warn } as never, fetchImpl: failing as unknown as typeof fetch })!.approvalRequested(event)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
