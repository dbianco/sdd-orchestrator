import { Command, Option } from 'commander';
import { approveRequest, rejectRequest } from '../../services/decideApproval.js';
import { requireApp } from '../../store/apps.js';
import { getApproval, listApprovals, type ApprovalStatus } from '../../store/approvals.js';
import { DomainError } from '../../errors.js';
import { openCli, print } from '../context.js';

const HEAD_LINES = 40;

export function approvalsCommand(actorOption: (c: Command) => Command): Command {
  const cmd = new Command('approvals').description('Review transitions waiting for a person');
  cmd.command('list').option('--app <slug>')
    .addOption(new Option('--status <s>').choices(['pending', 'approved', 'rejected', 'superseded']).default('pending'))
    .action(async (o: { app?: string; status: ApprovalStatus }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const appId = o.app ? (await requireApp(ctx.pool, o.app)).id : null;
        print({ approvals: await listApprovals(ctx.pool, { appId, status: o.status }) });
      } finally { await ctx.close(); }
    });
  cmd.command('show <id>').option('--full', 'print every artifact in full').action(async (id: string, o: { full?: boolean }) => {
    const ctx = await openCli({ needEmbedder: false });
    try {
      const approval = await getApproval(ctx.pool, id);
      if (!approval) throw new DomainError('APPROVAL_NOT_FOUND', `no approval request with id "${id}"`, { approval_id: id });
      const t = (await ctx.pool.query('SELECT findings, evidence, created_by, created_at FROM phase_transitions WHERE id = $1', [approval.transition_id])).rows[0];
      const artifacts = (await ctx.pool.query<{ name: string; byte_length: number; content: string | null }>(
        'SELECT name, byte_length, content FROM feature_artifacts WHERE transition_id = $1 ORDER BY name', [approval.transition_id],
      )).rows.map((a) => ({
        name: a.name, byte_length: a.byte_length,
        content: a.content === null ? null : o.full ? a.content : a.content.split('\n').slice(0, HEAD_LINES).join('\n'),
        truncated: !o.full && a.content !== null && a.content.split('\n').length > HEAD_LINES,
      }));
      print({ approval, findings: t.findings, evidence: t.evidence, artifacts });
    } finally { await ctx.close(); }
  });
  actorOption(cmd.command('approve <id>').option('--comment <text>')).action(async (id: string, o: { comment?: string; actor: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print(await approveRequest({ pool: ctx.pool, embedder: null, tokenBudget: ctx.config.tokenBudget, authMode: ctx.config.authMode }, { approval_id: id, actor: o.actor, comment: o.comment ?? null, apps: null })); } finally { await ctx.close(); }
  });
  actorOption(cmd.command('reject <id>').requiredOption('--reason <text>')).action(async (id: string, o: { reason: string; actor: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print(await rejectRequest({ pool: ctx.pool, embedder: null, tokenBudget: ctx.config.tokenBudget, authMode: ctx.config.authMode }, { approval_id: id, actor: o.actor, reason: o.reason, apps: null })); } finally { await ctx.close(); }
  });
  return cmd;
}
