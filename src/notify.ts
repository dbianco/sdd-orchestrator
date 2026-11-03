import type { Logger } from './logging.js';

export interface ApprovalRequestedEvent { approval_id: string; app: string; feature: string; from_phase: string; to_phase: string; requested_by: string }
export interface Notifier { approvalRequested(e: ApprovalRequestedEvent): void }

export function approvalMessage(e: ApprovalRequestedEvent, publicUrl: string | null): string {
  const link = publicUrl ? ` Review it: ${publicUrl.replace(/\/+$/, '')}/admin/#/approvals` : '';
  return `Approval needed: ${e.app} / ${e.feature} wants to move ${e.from_phase} -> ${e.to_phase} (requested by ${e.requested_by}).${link}`;
}

/** Posts a chat-style JSON message ({text, content}: works with Slack, Teams and Discord incoming webhooks). Never throws, never blocks the caller. */
export function createNotifier(opts: { webhookUrl: string | null; publicUrl: string | null; logger?: Logger; fetchImpl?: typeof fetch }): Notifier | undefined {
  if (!opts.webhookUrl) return undefined;
  const send = opts.fetchImpl ?? fetch;
  return {
    approvalRequested(e) {
      const text = approvalMessage(e, opts.publicUrl);
      void send(opts.webhookUrl!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(3000) })
        .then((r) => { if (!r.ok) opts.logger?.warn({ status: r.status }, 'approval notification was not accepted'); })
        .catch((err: unknown) => opts.logger?.warn({ err }, 'approval notification failed'));
    },
  };
}
