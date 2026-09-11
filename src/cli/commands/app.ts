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
        if (o.budget !== undefined) {
          const n = Number(o.budget);
          if (!Number.isInteger(n) || n <= 0) throw new Error(`--budget must be a positive integer, got "${o.budget}"`);
          patch.token_budget = n;
        }
        if (o.minSimilarity !== undefined) {
          const n = Number(o.minSimilarity);
          if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`--min-similarity must be between 0 and 1, got "${o.minSimilarity}"`);
          patch.min_similarity = n;
        }
        print(await updateApp(ctx.pool, slug, patch, o.actor));
      } finally { await ctx.close(); }
    });

  actorOption(app.command('set-policy <slug> <file>').requiredOption('--reason <text>'))
    .action(async (slug: string, file: string, o: { reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const row = await requireApp(ctx.pool, slug);
        let policy;
        try { policy = PolicySchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
        catch (e) { throw new Error(`policy file "${file}" is invalid: ${e instanceof Error ? e.message : String(e)}`); }
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
