import { Command } from 'commander';
import { approveProposal } from '../../services/approveProposal.js';
import { listProposals, reviewProposal } from '../../store/proposals.js';
import { openCli, print } from '../context.js';

export function proposalsCommand(actorOption: (c: Command) => Command): Command {
  const cmd = new Command('proposals').description('Review agent proposals');
  cmd.command('list').option('--status <s>', 'pending, approved or rejected', 'pending').action(async (o: { status: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print({ proposals: await listProposals(ctx.pool, o.status as 'pending') }); } finally { await ctx.close(); }
  });
  actorOption(cmd.command('approve <id>')).action(async (id: string, o: { actor: string }) => {
    const ctx = await openCli({ needEmbedder: true });
    try { print(await approveProposal({ pool: ctx.pool, embedder: ctx.embedder! }, id, o.actor)); } finally { await ctx.close(); }
  });
  actorOption(cmd.command('reject <id>').requiredOption('--reason <text>')).action(async (id: string, o: { reason: string; actor: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print(await reviewProposal(ctx.pool, id, 'rejected', o.actor, o.reason)); } finally { await ctx.close(); }
  });
  return cmd;
}
