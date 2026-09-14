import { Command } from 'commander';
import { ingestPack, type IngestReport } from '../../ingest/ingest.js';
import { loadPack, packDirs } from '../../ingest/load.js';
import { openCli, print } from '../context.js';

export function ingestAllCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(
    new Command('ingest-all')
      .argument('[dir]', 'root directory to scan for packs (recursively)', 'packs')
      .description('Validate and ingest every pack under a directory; keeps going and reports failures instead of stopping at the first one'),
  ).action(async (dir: string, o: { actor: string }) => {
    const ctx = await openCli({ needEmbedder: true });
    try {
      const ingested: IngestReport[] = [];
      const failed: { dir: string; error: string }[] = [];
      for (const packDir of await packDirs(dir)) {
        try {
          const pack = await loadPack(packDir);
          ingested.push(await ingestPack({ pool: ctx.pool, embedder: ctx.embedder! }, pack, o.actor));
        } catch (e) {
          failed.push({ dir: packDir, error: e instanceof Error ? e.message : String(e) });
        }
      }
      print({ ingested, failed });
      if (failed.length > 0) process.exitCode = 1;
    } finally { await ctx.close(); }
  });
}
