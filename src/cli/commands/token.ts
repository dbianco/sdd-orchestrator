import { Command } from 'commander';
import { SCOPES, type Scope } from '../../auth/tokens.js';
import { requireApp } from '../../store/apps.js';
import { listApps } from '../../store/apps.js';
import { createToken, listTokens, revokeToken, updateTokenApps } from '../../store/tokens.js';
import type { ApiTokenRow } from '../../store/rows.js';
import { fail, openCli, print } from '../context.js';

function parseScopes(v: string): Scope[] {
  const scopes = v.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (scopes.length === 0 || unknown.length > 0) fail(`--scope must be a comma-separated list of ${SCOPES.join(', ')}; got "${v}"`);
  return [...new Set(scopes)] as Scope[];
}

function parseExpiry(v: string | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d+)d$/.exec(v);
  if (!m || Number(m[1]) < 1) fail(`--expires must look like 90d; got "${v}"`);
  return new Date(Date.now() + Number(m![1]) * 86_400_000);
}

// Readable output: show app slugs next to the opaque ids (null means every app).
async function withSlugs(pool: Parameters<typeof listApps>[0], rows: ApiTokenRow[]): Promise<(ApiTokenRow & { app_slugs: string[] | null })[]> {
  const slugs = new Map((await listApps(pool)).map((a) => [a.id, a.slug]));
  return rows.map((r) => ({ ...r, app_slugs: r.app_ids ? r.app_ids.map((id) => slugs.get(id) ?? id) : null }));
}

export function tokenCommand(actorOption: (c: Command) => Command): Command {
  const cmd = new Command('token').description('Issue, list and revoke API tokens');
  actorOption(cmd.command('create')
    .requiredOption('--for <actor>', 'person or pipeline the token identifies')
    .requiredOption('--scope <list>', `comma-separated: ${SCOPES.join(', ')}`)
    .requiredOption('--name <text>', 'where the token is used, e.g. "dana laptop"')
    .option('--app <slug...>', 'restrict the token to these apps')
    .option('--expires <days>', 'lifetime such as 90d'))
    .action(async (o: { for: string; scope: string; name: string; app?: string[]; expires?: string; actor: string }) => {
      const scopes = parseScopes(o.scope);
      const expires = parseExpiry(o.expires);
      const ctx = await openCli({ needEmbedder: false });
      try {
        const appIds = o.app ? await Promise.all(o.app.map(async (slug) => (await requireApp(ctx.pool, slug)).id)) : null;
        const { row, secret } = await createToken(ctx.pool, { actor: o.for, name: o.name, scopes, app_ids: appIds, expires_at: expires }, o.actor);
        print({ token: (await withSlugs(ctx.pool, [row]))[0], secret, notice: 'Store the secret now; it is not stored and will not be shown again.' });
      } finally { await ctx.close(); }
    });
  cmd.command('list').option('--for <actor>').action(async (o: { for?: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print({ tokens: await withSlugs(ctx.pool, await listTokens(ctx.pool, { actor: o.for })) }); } finally { await ctx.close(); }
  });
  cmd.command('update <id>').description('Change which apps an existing token covers, keeping its secret')
    .option('--add-app <slug...>', 'add these apps to the token')
    .option('--app <slug...>', 'replace the token\'s apps with exactly these')
    .action(async (id: string, o: { addApp?: string[]; app?: string[] }) => {
      if (!o.addApp && !o.app) fail('give --add-app <slug...> to widen the token or --app <slug...> to replace its apps');
      if (o.addApp && o.app) fail('use either --add-app or --app, not both');
      const ctx = await openCli({ needEmbedder: false });
      try {
        const toIds = async (slugs: string[]) => Promise.all(slugs.map(async (slug) => (await requireApp(ctx.pool, slug)).id));
        const row = await updateTokenApps(ctx.pool, id, o.app ? { set: await toIds(o.app) } : { add: await toIds(o.addApp!) });
        print({ token: (await withSlugs(ctx.pool, [row]))[0], notice: 'The secret is unchanged. Running sessions pick up the new scope on their next call.' });
      } finally { await ctx.close(); }
    });
  actorOption(cmd.command('revoke <id>').requiredOption('--reason <text>')).action(async (id: string, o: { reason: string; actor: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print(await revokeToken(ctx.pool, id, o.reason, o.actor)); } finally { await ctx.close(); }
  });
  return cmd;
}
