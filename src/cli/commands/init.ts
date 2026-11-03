import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { ingestPack } from '../../ingest/ingest.js';
import { loadPack, packDirs } from '../../ingest/load.js';
import { createApp, getAppBySlug } from '../../store/apps.js';
import { createToken } from '../../store/tokens.js';
import { openCli } from '../context.js';
import { seedDemo } from './demo.js';

const BUNDLED_PACKS = fileURLToPath(new URL('../../../packs', import.meta.url));
const say = (line = ''): void => { process.stdout.write(`${line}\n`); };

/** Writes .sdd/config.json and ignores the state file; never overwrites an existing config. */
export async function writeRepoConfig(repoDir: string, app: string, enforcement: 'block' | 'warn'): Promise<'created' | 'kept'> {
  const dir = join(repoDir, '.sdd');
  const file = join(dir, 'config.json');
  const exists = await stat(file).then(() => true, () => false);
  if (!exists) {
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${JSON.stringify({ app, enforcement }, null, 2)}\n`);
  }
  const ignore = join(repoDir, '.gitignore');
  const current = await readFile(ignore, 'utf8').catch(() => '');
  if (!current.split('\n').includes('.sdd/state.json')) await appendFile(ignore, `${current && !current.endsWith('\n') ? '\n' : ''}.sdd/state.json\n`);
  return exists ? 'kept' : 'created';
}

export function initCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(
    new Command('init')
      .description('One-step setup: migrate the database, register your app, ingest the framework packs and issue you a token')
      .option('--app <slug>', 'app slug (defaults to the current directory name)')
      .option('--name <name>', 'display name (defaults to the slug)')
      .option('--packs <dir>', 'packs directory', BUNDLED_PACKS)
      .option('--url <url>', 'public URL of the server', 'http://localhost:8080')
      .option('--advisory', 'write .sdd/config.json with enforcement "warn" so hooks explain instead of blocking', false)
      .option('--write-config', 'create .sdd/config.json and a .gitignore entry in the current directory', false)
      .option('--demo', 'also create a "demo" app with sample data to explore the admin UI', false)
      .option('--skip-packs', 'do not ingest packs', false),
  ).action(async (o: { app?: string; name?: string; packs: string; url: string; advisory: boolean; writeConfig: boolean; skipPacks: boolean; demo: boolean; actor: string }) => {
    const slug = (o.app ?? basename(process.cwd())).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-app';
    const env = process.env;
    if (!o.skipPacks && (env.SDD_EMBEDDING_PROVIDER ?? 'voyage') === 'voyage' && !env.VOYAGE_API_KEY) {
      env.SDD_EMBEDDING_PROVIDER = 'fake';
      say('! No VOYAGE_API_KEY: using placeholder embeddings so setup works offline. Context search will not be meaningful');
      say('  until you set VOYAGE_API_KEY (or SDD_EMBEDDING_PROVIDER=ollama) and run `sdd-admin reindex`.');
      say();
    }
    const ctx = await openCli({ needEmbedder: !o.skipPacks });
    try {
      say('1/4 Database ready (migrations applied).');
      const existing = await getAppBySlug(ctx.pool, slug);
      if (existing) say(`2/4 App "${slug}" already registered.`);
      else { await createApp(ctx.pool, { slug, name: o.name ?? slug, compliance: false }, o.actor); say(`2/4 Registered app "${slug}".`); }

      if (o.skipPacks) say('3/4 Skipped pack ingestion.');
      else {
        let created = 0;
        let failed = 0;
        for (const dir of await packDirs(o.packs)) {
          try { created += (await ingestPack({ pool: ctx.pool, embedder: ctx.embedder! }, await loadPack(dir), o.actor)).created.length; } catch (e) {
            failed += 1;
            say(`   ! ${dir}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        say(`3/4 Packs ingested (${created} new knowledge items${failed ? `, ${failed} pack(s) failed` : ''}).`);
      }

      if (o.demo) {
        try { const d = await seedDemo(ctx.pool, 'demo', o.actor); say(`    Demo data: app "demo" with ${d.features} sample features. Remove it with: sdd-admin demo reset`); }
        catch (e) { say(`    Demo data skipped: ${e instanceof Error ? e.message : String(e)}`); }
      }
      const app = await getAppBySlug(ctx.pool, slug);
      const { secret } = await createToken(ctx.pool, { actor: o.actor, name: `${o.actor} (sdd-admin init)`, scopes: ['host', 'approver'], app_ids: app ? [app.id] : null, expires_at: null }, o.actor);
      say('4/4 Issued you a personal token (host + approver). It is shown only once.');
      say();
      let repoNote = '';
      if (o.writeConfig) repoNote = (await writeRepoConfig(process.cwd(), slug, o.advisory ? 'warn' : 'block')) === 'created' ? 'Wrote .sdd/config.json and ignored .sdd/state.json.' : '.sdd/config.json already exists; left unchanged.';
      say('Next steps');
      say('----------');
      say('  export SDD_URL=' + o.url);
      say('  export SDD_TOKEN=' + secret);
      say('  claude plugin marketplace add dbianco/sdd-orchestrator');
      say('  claude plugin install sdd@sdd-orchestrator');
      say();
      if (repoNote) say(repoNote);
      else {
        say(`In your repository, create .sdd/config.json (or rerun with --write-config):`);
        say(`  { "app": "${slug}", "enforcement": "${o.advisory ? 'warn' : 'block'}" }`);
      }
      say();
      say(`Then start the server and open the admin UI at ${o.url}/admin. In Claude Code run /sdd:route to route your first task.`);
      if (!o.advisory) say('Tip: add --advisory (enforcement "warn") to try the workflow without edits being blocked.');
    } finally { await ctx.close(); }
  });
}
