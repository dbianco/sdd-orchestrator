import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { createHttpApp } from '../../../src/mcp/http.js';
import { createLogger } from '../../../src/logging.js';
import { createMetrics } from '../../../src/metrics.js';
import { createToken } from '../../../src/store/tokens.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const run = promisify(execFile);
const script = resolve('scripts/sdd-ci-evidence.mjs');
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('scripts/sdd-ci-evidence.mjs', () => {
  let server: Server;
  let origin: string;
  let secret: string;
  let fid: string;
  let repo: string;

  beforeAll(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    const { registry, hooks } = createMetrics();
    const app = createHttpApp({ pool, embedder, tokenBudget: 6000, logger: createLogger('silent'), metrics: hooks, registry }, {
      databaseUrl: 'unused', embedding: { provider: 'fake', model: 'fake-1024', ollamaUrl: 'unused' }, listen: { host: '127.0.0.1', port: 0 },
      allowedHosts: ['127.0.0.1'], tokenBudget: 6000, adminToken: null, authMode: 'warn',
    });
    origin = await new Promise((r) => { server = app.listen(0, '127.0.0.1', () => { const a = server.address(); r(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`); }); });
    secret = (await createToken(pool, { actor: 'ci', name: 'n', scopes: ['ci'], app_ids: null, expires_at: null }, 't')).secret;
    fid = (await startFeature({ pool, embedder, tokenBudget: 6000 }, { app: 'checkout', actor: 'd', task_description: 'CSV', decision })).feature_id;
    repo = await mkdtemp(join(tmpdir(), 'sdd-ci-'));
    const g = (...args: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo });
    await g('init', '-q', '-b', 'feature/csv');
    await g('commit', '-q', '--allow-empty', '-m', 'no trailer');
    await writeFile(join(repo, 'evidence.json'), JSON.stringify({ tests: { command: 'npm test', passed: 3, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 } }));
  });
  afterAll(async () => { server.close(); await closeTestPool(); });

  const env = (token: string) => ({ ...process.env, SDD_URL: origin, SDD_CI_TOKEN: token, SDD_APP: 'checkout', GITHUB_HEAD_REF: '', GITHUB_REF_NAME: '' });
  const exec = (token: string) => run('node', [script, '--evidence', 'evidence.json', '--run-url', 'https://ci.example/1'], { cwd: repo, env: env(token) });
  const commitWithTrailer = () => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', `add csv\n\nSDD-Ref: ${fid}`], { cwd: repo });

  it('exits 0 and reports nothing when HEAD has no SDD-Ref trailer', async () => {
    const { stdout } = await exec(secret);
    expect(stdout).toContain('no SDD-Ref trailer on HEAD');
    expect((await (await getTestPool()).query('SELECT count(*)::int AS n FROM ci_evidence')).rows[0].n).toBe(0);
  });

  it('posts evidence for the trailer feature and HEAD commit', async () => {
    await commitWithTrailer();
    const { stdout } = await exec(secret);
    expect(JSON.parse(stdout)).toMatchObject({ ci_evidence_id: expect.stringMatching(/^ce_/) });
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
    const row = (await (await getTestPool()).query('SELECT feature_id, commit_sha, branch, run_url FROM ci_evidence')).rows[0];
    expect(row).toEqual({ feature_id: fid, commit_sha: head, branch: 'feature/csv', run_url: 'https://ci.example/1' });
  });

  it('exits 1 with the server message on a bad token', async () => {
    await expect(exec('sdd_wrong')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('401') });
  });
});
