import { Command } from 'commander';
import { ingestPack } from '../../ingest/ingest.js';
import { loadPack } from '../../ingest/load.js';
import { openCli, print } from '../context.js';

export function ingestCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('ingest').argument('<dir>').description('Validate and ingest a pack directory'))
    .action(async (dir: string, o: { actor: string }) => {
      const ctx = await openCli({ needEmbedder: true });
      try {
        const pack = await loadPack(dir);
        print(await ingestPack({ pool: ctx.pool, embedder: ctx.embedder! }, pack, o.actor));
      } finally { await ctx.close(); }
    });
}
