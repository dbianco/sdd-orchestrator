import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { cli } from '../../helpers/cli.js';
import { writeRepoConfig } from '../../../src/cli/commands/init.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const tmp = () => mkdtemp(join(tmpdir(), 'sdd-cli-'));

describe.skipIf(!url)('sdd-admin run in-process: apps, tokens, init, demo, doctor, exports', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('registers, configures and lists apps, and rejects invalid values', async () => {
    expect((await cli(['app', 'register', 'checkout', '--name', 'Checkout', '--compliance', '--actor', 'daniel'])).json()).toMatchObject({ slug: 'checkout', compliance: true, created_by: 'daniel' });
    expect((await cli(['app', 'update', 'checkout', '--stack', 'typescript, react', '--budget', '5000', '--min-similarity', '0.4'])).json()).toMatchObject({ default_stack: ['typescript', 'react'], token_budget: 5000 });
    const badBudget = await cli(['app', 'update', 'checkout', '--budget', '0']);
    expect(badBudget.code).toBe(1);
    expect(badBudget.stderr).toContain('--budget must be a positive integer');
    expect((await cli(['app', 'update', 'checkout', '--min-similarity', '2'])).stderr).toContain('--min-similarity must be between 0 and 1');

    const dir = await tmp();
    await writeFile(join(dir, 'policy.json'), JSON.stringify({ framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: [] }));
    expect((await cli(['app', 'set-policy', 'checkout', join(dir, 'policy.json'), '--reason', 'PCI'])).json()).toMatchObject({ version: 1 });
    await writeFile(join(dir, 'bad.json'), '{ nope');
    const bad = await cli(['app', 'set-policy', 'checkout', join(dir, 'bad.json'), '--reason', 'x']);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('is invalid');
    expect((await cli(['app', 'add-stop-condition', 'checkout', 'Never change tax rounding'])).json()).toMatchObject({ stop_conditions: ['Never change tax rounding'] });
    expect((await cli(['app', 'list'])).json<{ apps: { slug: string }[] }>().apps.map((a) => a.slug)).toEqual(['checkout']);
  });

  it('issues, widens, lists and revokes tokens, validating every option', async () => {
    await cli(['app', 'register', 'checkout', '--name', 'Checkout']);
    await cli(['app', 'register', 'billing', '--name', 'Billing']);
    expect((await cli(['token', 'create', '--for', 'x', '--scope', 'root', '--name', 'n'])).stderr).toContain('--scope');
    expect((await cli(['token', 'create', '--for', 'x', '--scope', ' ', '--name', 'n'])).code).toBe(1);
    expect((await cli(['token', 'create', '--for', 'x', '--scope', 'host', '--name', 'n', '--expires', '90'])).stderr).toContain('--expires');
    expect((await cli(['token', 'create', '--for', 'x', '--scope', 'host', '--name', 'n', '--app', 'nope'])).code).toBe(1);

    const created = (await cli(['token', 'create', '--for', 'bob', '--scope', 'host,host,approver', '--name', 'laptop', '--app', 'checkout', '--expires', '30d'])).json<{ token: { id: string; scopes: string[]; app_slugs: string[]; expires_at: string }; secret: string }>();
    expect(created.token).toMatchObject({ scopes: ['host', 'approver'], app_slugs: ['checkout'] });
    expect(new Date(created.token.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const id = created.token.id;
    expect((await cli(['token', 'update', id, '--add-app', 'billing'])).json<{ token: { app_slugs: string[] } }>().token.app_slugs).toEqual(['checkout', 'billing']);
    expect((await cli(['token', 'update', id, '--app', 'billing'])).json<{ token: { app_slugs: string[] } }>().token.app_slugs).toEqual(['billing']);
    expect((await cli(['token', 'update', id])).stderr).toContain('--add-app');
    expect((await cli(['token', 'update', id, '--app', 'billing', '--add-app', 'checkout'])).stderr).toContain('either --add-app or --app');
    const all = (await cli(['token', 'create', '--for', 'ci', '--scope', 'ci', '--name', 'pipe'])).json<{ token: { app_slugs: null } }>();
    expect(all.token.app_slugs).toBeNull();
    const listed = (await cli(['token', 'list'])).json<{ tokens: unknown[] }>();
    expect(listed.tokens).toHaveLength(2);
    expect((await cli(['token', 'list', '--for', 'bob'])).json<{ tokens: unknown[] }>().tokens).toHaveLength(1);
    expect((await cli(['token', 'revoke', id, '--reason', 'lost'])).json()).toMatchObject({ id });
    expect((await cli(['token', 'update', id, '--add-app', 'checkout'])).stderr).toContain('revoked');
  });

  it('init: sets everything up, is idempotent, reports failing packs and falls back to placeholder embeddings', async () => {
    const repo = await tmp();
    const first = await cli(['init', '--app', 'My App', '--packs', `${fixtures}mini-framework`, '--advisory', '--write-config', '--demo', '--actor', 'dana', '--url', 'http://sdd.example:9'], { cwd: repo });
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('Registered app "my-app"');
    expect(first.stdout).toContain('Demo data: app "demo" with 5 sample features');
    expect(first.stdout).toContain('export SDD_URL=http://sdd.example:9');
    expect(first.stdout).toMatch(/export SDD_TOKEN=sdd_/);
    expect(first.stdout).toContain('Wrote .sdd/config.json');
    expect(JSON.parse(await readFile(join(repo, '.sdd', 'config.json'), 'utf8'))).toEqual({ app: 'my-app', enforcement: 'warn' });

    const second = await cli(['init', '--app', 'My App', '--packs', `${fixtures}mini-framework`, '--write-config', '--demo'], { cwd: repo });
    expect(second.stdout).toContain('already registered');
    expect(second.stdout).toContain('already exists; left unchanged');
    expect(second.stdout).toContain('Demo data skipped');
    expect(second.stdout).toContain('Tip: add --advisory');

    const skipped = await cli(['init', '--app', 'plain', '--skip-packs'], { cwd: repo });
    expect(skipped.stdout).toContain('Skipped pack ingestion');
    expect(skipped.stdout).toContain('{ "app": "plain", "enforcement": "block" }');

    const broken = await tmp();
    await mkdir(join(broken, 'bad'));
    await writeFile(join(broken, 'bad', 'pack.yaml'), 'name: [unterminated');
    const failing = await cli(['init', '--app', 'f1', '--packs', broken]);
    expect(failing.stdout).toContain('1 pack(s) failed');

    const offline = await cli(['init', '--app', 'f2', '--packs', `${fixtures}mini-framework`], { env: { SDD_EMBEDDING_PROVIDER: undefined, VOYAGE_API_KEY: undefined } });
    expect(offline.stdout).toContain('No VOYAGE_API_KEY: using placeholder embeddings');
    expect(process.env.SDD_EMBEDDING_PROVIDER).not.toBe('fake-leaked-from-init');
  });

  it('init defaults the app name to the working directory', async () => {
    const repo = join(await tmp(), 'Cool_Service!');
    await mkdir(repo);
    expect((await cli(['init', '--skip-packs'], { cwd: repo })).stdout).toContain('Registered app "cool-service"');
  });

  it('writeRepoConfig keeps an existing config and appends the ignore line once', async () => {
    const repo = await tmp();
    await writeFile(join(repo, '.gitignore'), 'node_modules');
    expect(await writeRepoConfig(repo, 'a', 'block')).toBe('created');
    expect(await writeRepoConfig(repo, 'a', 'warn')).toBe('kept');
    expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('node_modules\n.sdd/state.json\n');
    expect(JSON.parse(await readFile(join(repo, '.sdd', 'config.json'), 'utf8')).enforcement).toBe('block');
  });

  it('demo: seeds once, resets only what it created', async () => {
    expect((await cli(['demo', 'seed'])).json()).toMatchObject({ app: 'demo', features: 5 });
    expect((await cli(['demo', 'seed'])).stderr).toContain('already exists');
    await cli(['app', 'register', 'checkout', '--name', 'Checkout']);
    expect((await cli(['demo', 'reset', '--app', 'checkout'])).stderr).toContain('refusing');
    expect((await cli(['demo', 'reset', '--app', 'ghost'])).json()).toEqual({ app: 'ghost', removed: false });
    expect((await cli(['demo', 'reset'])).json()).toEqual({ app: 'demo', removed: true });
    expect((await cli(['demo', 'seed', '--app', 'sample'])).json()).toMatchObject({ app: 'sample' });
  });

  it('doctor: prints a report, supports --json and exits 1 on failure', async () => {
    const ok = await cli(['doctor']);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('✓ Database: reachable');
    expect(ok.stdout).toContain('! Embedding provider');
    expect((await cli(['doctor', '--json'])).json<{ checks: { name: string }[] }>().checks.map((c) => c.name)).toContain('pgvector');
    const pool = await getTestPool();
    await pool.query(`INSERT INTO embedding_config (id, provider, model, dimension, created_by) VALUES ('singleton', 'voyage', 'voyage-3', 1024, 't')`);
    const mismatch = await cli(['doctor']);
    expect(mismatch.code).toBe(1);
    expect(mismatch.stdout).toContain('✗ Index matches provider');
    const noConfig = await cli(['doctor'], { env: { SDD_DATABASE_URL: undefined } });
    expect(noConfig.code).toBe(1);
    expect(noConfig.stdout).toContain('SDD_DATABASE_URL is not set');
  });

  it('exports the traceability matrix, a pull-request comment and the drift report', async () => {
    await cli(['demo', 'seed']);
    expect((await cli(['export', 'rtm', 'demo'])).stdout.split('\n')[0]).toContain('feature_id');
    expect((await cli(['export', 'rtm', 'demo', '--format', 'json'])).json<{ rows: unknown[] }>().rows.length).toBeGreaterThan(0);
    expect((await cli(['export', 'rtm', 'ghost'])).code).toBe(1);
    const featureId = (await (await getTestPool()).query<{ id: string }>(`SELECT id FROM features WHERE slug = 'add-csv-export'`)).rows[0]!.id;
    const comment = await cli(['export', 'pr-comment', featureId]);
    expect(comment.stdout).toContain('<!-- sdd-orchestrator:summary -->');
    expect(comment.stdout).toContain('requirement_coverage');
    expect((await cli(['export', 'pr-comment', 'f_nope'])).code).toBe(1);
    expect((await cli(['export', 'drift'])).json<{ drift: { slug: string }[] }>().drift.map((d) => d.slug)).toEqual(['refund-policy-page']);
    expect((await cli(['export', 'drift', 'demo'])).json<{ drift: unknown[] }>().drift).toHaveLength(1);
    expect((await cli(['export', 'drift', 'ghost'])).code).toBe(1);
  });
});
