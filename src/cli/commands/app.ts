import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { addStopCondition, createApp, listApps, requireApp, updateApp } from '../../store/apps.js';
import { appendPolicy, PolicySchema } from '../../store/policies.js';
import { openCli, print } from '../context.js';

export function appCommand(actorOption: (c: Command) => Command): Command {
  const app = new Command('app').description('Manage apps');

  actorOption(app.command('register <slug>').requiredOption('--name <name>').option('--compliance', 'app is under compliance', false))
    .action(async (slug: string, o: { name: string; compliance: boolean; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print(await createApp(ctx.pool, { slug, name: o.name, compliance: o.compliance }, o.actor)); } finally { await ctx.close(); }
    });

  actorOption(app.command('update <slug>').option('--stack <list>', 'comma-separated default stack').option('--budget <n>', 'token budget').option('--min-similarity <x>', 'similarity floor'))
    .action(async (slug: string, o: { stack?: string; budget?: string; minSimilarity?: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const patch: Parameters<typeof updateApp>[2] = {};
        if (o.stack !== undefined) patch.default_stack = o.stack.split(',').map((s) => s.trim()).filter(Boolean);
        if (o.budget !== undefined) patch.token_budget = Number(o.budget);
        if (o.minSimilarity !== undefined) patch.min_similarity = Number(o.minSimilarity);
        print(await updateApp(ctx.pool, slug, patch, o.actor));
      } finally { await ctx.close(); }
    });

  actorOption(app.command('set-policy <slug> <file>').requiredOption('--reason <text>'))
    .action(async (slug: string, file: string, o: { reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const row = await requireApp(ctx.pool, slug);
        const policy = PolicySchema.parse(JSON.parse(await readFile(file, 'utf8')));
        print(await appendPolicy(ctx.pool, row.id, policy, o.reason, o.actor));
      } finally { await ctx.close(); }
    });

  actorOption(app.command('add-stop-condition <slug> <text>'))
    .action(async (slug: string, text: string, o: { actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print(await addStopCondition(ctx.pool, slug, text, o.actor)); } finally { await ctx.close(); }
    });

  app.command('list').action(async () => {
    const ctx = await openCli({ needEmbedder: false });
    try { print({ apps: await listApps(ctx.pool) }); } finally { await ctx.close(); }
  });

  return app;
}
