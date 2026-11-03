import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { embedder } from '../helpers/seed.js';
import { seedDemo } from '../../src/cli/commands/demo.js';
import { createHttpApp, type HttpDeps } from '../../src/mcp/http.js';
import { createLogger } from '../../src/logging.js';
import { createMetrics } from '../../src/metrics.js';
import { createApp } from '../../src/store/apps.js';
import { createToken } from '../../src/store/tokens.js';
import { PR_COMMENT_MARKER } from '../../src/reports/prComment.js';
import type { Config } from '../../src/config.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const config: Config = {
  databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' }, listen: { host: '127.0.0.1', port: 0 },
  allowedHosts: ['127.0.0.1'], tokenBudget: 6000, adminToken: null, authMode: 'warn',
};

describe.skipIf(!url)('GET /api/ci/pr-comment', () => {
  let deps: HttpDeps;
  let server: Server | null = null;
  let origin = '';
  let ci: string;
  let csv: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool);
    const { registry, hooks } = createMetrics();
    deps = { pool, embedder, tokenBudget: 6000, logger: createLogger('silent'), metrics: hooks, registry };
    await seedDemo(pool, 'demo', 'test');
    csv = (await pool.query<{ id: string }>(`SELECT id FROM features WHERE slug = 'add-csv-export'`)).rows[0]!.id;
    ci = (await createToken(pool, { actor: 'demo-ci', name: 'ci', scopes: ['ci'], app_ids: null, expires_at: null }, 'test')).secret;
    origin = await new Promise<string>((resolve) => {
      server = createHttpApp(deps, config).listen(0, '127.0.0.1', () => { const a = server!.address(); resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`); });
    });
  });
  afterEach(() => { server?.close(); server = null; });
  afterAll(closeTestPool);

  const get = (query: string, token?: string) => fetch(`${origin}/api/ci/pr-comment?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  it('renders traceability, the blocking finding and its fix', async () => {
    const r = await get(`app=demo&feature_id=${csv}`, ci);
    expect(r.status).toBe(200);
    const { markdown } = await r.json() as { markdown: string };
    expect(markdown.startsWith(PR_COMMENT_MARKER)).toBe(true);
    expect(markdown).toContain('`add-csv-export`');
    expect(markdown).toMatch(/\*\*\d of 3 requirements covered by evidence\.\*\*/);
    expect(markdown).toContain('| FR-003 |');
    expect(markdown).toMatch(/Blocking `verify` → `integrate`/);
    expect(markdown).toMatch(/`requirement_coverage` \(FR-003\)/);
    expect(markdown).toMatch(/_Fix:_ Add the requirement id to evidence\.implements/);
  });

  it('shows a pending approval', async () => {
    const saved = (await deps.pool.query<{ id: string }>(`SELECT id FROM features WHERE slug = 'saved-cards'`)).rows[0]!.id;
    const { markdown } = await (await get(`app=demo&feature_id=${saved}`, ci)).json() as { markdown: string };
    expect(markdown).toMatch(/Waiting for approval\*\* of `specify` → `implement`/);
  });

  it('answers 401, 403, 404 and 400 for the usual mistakes', async () => {
    const host = (await createToken(deps.pool, { actor: 'dana', name: 'h', scopes: ['host'], app_ids: null, expires_at: null }, 'test')).secret;
    const other = await createApp(deps.pool, { slug: 'billing', name: 'Billing' }, 'test');
    const billingCi = (await createToken(deps.pool, { actor: 'b-ci', name: 'b', scopes: ['ci'], app_ids: [other.id], expires_at: null }, 'test')).secret;
    expect((await get(`app=demo&feature_id=${csv}`)).status).toBe(401);
    expect((await get(`app=demo&feature_id=${csv}`, host)).status).toBe(403);
    expect((await get(`app=demo&feature_id=${csv}`, billingCi)).status).toBe(403);
    expect((await get(`app=billing&feature_id=${csv}`, ci)).status).toBe(403);
    expect((await get('app=demo&feature_id=f_nope', ci)).status).toBe(404);
    expect((await get('app=demo', ci)).status).toBe(400);
    expect((await get(`app=ghost&feature_id=${csv}`, ci)).status).toBe(404);
  });

  it('the script prints the summary in --dry-run and skips commits without an SDD-Ref', async () => {
    // Async on purpose: the server under test runs in this process and must keep serving while the script runs.
    const run = (args: string[]) => promisify(execFile)('node', [`${process.cwd()}/scripts/sdd-pr-comment.mjs`, ...args], { env: { ...process.env, SDD_URL: origin, SDD_CI_TOKEN: ci, SDD_APP: 'demo' } });
    const out = await run(['--feature', csv, '--dry-run']);
    expect(out.stdout).toContain(PR_COMMENT_MARKER);
    expect(out.stdout).toContain('Open in the admin UI');
    const skipped = await run(['--dry-run']); // HEAD of this repository carries no SDD-Ref trailer
    expect(skipped.stdout).toMatch(/nothing to post/);
  });
});
