import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { parse } from 'yaml';
import { EvalFileSchema, runEval } from '../../eval/run.js';
import { openCli, print } from '../context.js';

export function evalCommand(): Command {
  return new Command('eval').description('Measure retrieval against golden cases: recall@k and mean reciprocal rank')
    .argument('<cases.yaml>')
    .option('--k <n>', 'results per query', '8')
    .option('--min-recall <x>', 'exit 1 when mean recall is lower', '0')
    .option('--min-mrr <x>', 'exit 1 when mean reciprocal rank is lower', '0')
    .action(async (file: string, o: { k: string; minRecall: string; minMrr: string }) => {
      const cases = EvalFileSchema.parse(parse(await readFile(file, 'utf8')));
      const ctx = await openCli({ needEmbedder: true });
      try {
        const report = await runEval({ q: ctx.pool, embedder: ctx.embedder }, cases, { k: Number(o.k) });
        print(report);
        if (report.recall < Number(o.minRecall) || report.mrr < Number(o.minMrr)) {
          process.stderr.write(`recall ${report.recall.toFixed(3)} (min ${o.minRecall}), mrr ${report.mrr.toFixed(3)} (min ${o.minMrr})\n`);
          process.exitCode = 1;
        }
      } finally { await ctx.close(); }
    });
}
