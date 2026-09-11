import { Command } from 'commander';
import { reindexAll } from '../../ingest/reindex.js';
import { openCli, print } from '../context.js';

export function reindexCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('reindex').description('Re-embed every chunk with the configured model'))
    .action(async (o: { actor: string }) => {
      const ctx = await openCli({ needEmbedder: true });
      try { print(await reindexAll({ pool: ctx.pool, embedder: ctx.embedder! }, o.actor)); } finally { await ctx.close(); }
    });
}
