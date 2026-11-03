import { Command, Option } from 'commander';
import { featurePrComment } from '../../reports/prComment.js';
import { requireFeature } from '../../store/features.js';
import { requireApp } from '../../store/apps.js';
import { rtmCsv, rtmRows } from '../../store/rtm.js';
import { openCli, print } from '../context.js';

export function exportCommand(): Command {
  const cmd = new Command('export').description('Export reports');
  cmd.command('rtm <app>').description('Requirement traceability matrix for one app')
    .addOption(new Option('--format <f>', 'csv or json').choices(['csv', 'json']).default('csv'))
    .action(async (slug: string, o: { format: 'csv' | 'json' }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const rows = await rtmRows(ctx.pool, (await requireApp(ctx.pool, slug)).id);
        if (o.format === 'json') print({ app: slug, rows });
        else process.stdout.write(rtmCsv(rows));
      } finally { await ctx.close(); }
    });
  cmd.command('pr-comment <feature>').description('Markdown summary of one feature (traceability, blockers with fixes) to paste into a pull request')
    .action(async (featureId: string) => {
      const ctx = await openCli({ needEmbedder: false });
      try { await requireFeature(ctx.pool, featureId); process.stdout.write(await featurePrComment(ctx.pool, featureId)); } finally { await ctx.close(); }
    });
  return cmd;
}
