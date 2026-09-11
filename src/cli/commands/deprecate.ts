import { Command } from 'commander';
import { deprecateFramework } from '../../store/frameworks.js';
import { deprecateItem } from '../../store/knowledge.js';
import { openCli, print } from '../context.js';

export function deprecateCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('deprecate').argument('<stable_id>').option('--successor <id>').requiredOption('--reason <text>'))
    .action(async (stableId: string, o: { successor?: string; reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print(await deprecateItem(ctx.pool, stableId, o.successor ?? null, o.reason, o.actor)); } finally { await ctx.close(); }
    });
}

export function deprecateFrameworkCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('deprecate-framework').argument('<name>').option('--version <v>').requiredOption('--reason <text>'))
    .action(async (name: string, o: { version?: string; reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print({ name, version: o.version ?? null, deprecated: await deprecateFramework(ctx.pool, name, o.version ?? null, o.reason, o.actor) }); } finally { await ctx.close(); }
    });
}
