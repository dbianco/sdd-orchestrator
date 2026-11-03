import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { cli } from '../../helpers/cli.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { seedPacks } from '../../helpers/seedPacks.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { insertProposal } from '../../../src/store/proposals.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const decision: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const spec = '## Why\nx\n\n## What Changes\ny\n';

describe.skipIf(!url)('sdd-admin run in-process: knowledge, proposals, approvals, eval', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('ingests, deprecates and reindexes knowledge', async () => {
    await cli(['app', 'register', 'checkout', '--name', 'Checkout']);
    const r = (await cli(['ingest', `${fixtures}mini-framework`])).json<{ created: string[] }>();
    expect(r.created).toHaveLength(3);
    expect((await cli(['ingest', `${fixtures}does-not-exist`])).stderr).toContain('pack.yaml');
    expect((await cli(['deprecate', 'mini.guide.proposals', '--reason', 'obsolete'])).json()).toMatchObject({ status: 'deprecated' });
    expect((await cli(['deprecate-framework', 'mini', '--version', '1.0.0', '--reason', 'unused'])).json()).toMatchObject({ name: 'mini', version: '1.0.0', deprecated: 1 });
    expect((await cli(['deprecate-framework', 'mini', '--reason', 'all'])).json()).toMatchObject({ version: null });
    expect((await cli(['reindex'])).json()).toMatchObject({ chunks: expect.any(Number) });
  });

  it('ingests a directory of packs, reporting the ones that fail with a nonzero exit code', async () => {
    const ok = await cli(['ingest-all', fixtures]);
    expect(ok.code).toBe(0);
    expect(ok.json<{ ingested: unknown[]; failed: unknown[] }>()).toMatchObject({ failed: [] });

    const dir = await mkdtemp(join(tmpdir(), 'sdd-batch-'));
    await cp(`${fixtures}mini-company`, join(dir, 'good'), { recursive: true });
    await cp(`${fixtures}mini-company`, join(dir, 'bad'), { recursive: true });
    await writeFile(join(dir, 'bad', 'pack.yaml'), 'name: [unterminated');
    const mixed = await cli(['ingest-all', dir]);
    expect(mixed.code).toBe(1);
    const out = mixed.json<{ ingested: unknown[]; failed: { dir: string }[] }>();
    expect(out.ingested).toHaveLength(1);
    expect(out.failed).toHaveLength(1);
  });

  it('lists, approves and rejects memory proposals', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    const deps = { pool, embedder, tokenBudget: 6000 };
    const fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: 'CSV export', decision })).feature_id;
    const appId = (await pool.query<{ id: string }>(`SELECT id FROM apps WHERE slug = 'checkout'`)).rows[0]!.id;
    const payload = (title: string) => ({ kind: 'app_memory', memory_type: 'decision', title, body: `${title} body`, stack_tags: [], links: [] });
    const a = (await insertProposal(pool, { app_id: appId, feature_id: fid, payload: payload('Use streaming'), supersedes: null }, 'agent')).id;
    const b = (await insertProposal(pool, { app_id: appId, feature_id: fid, payload: payload('Use buffering'), supersedes: null }, 'agent')).id;

    expect((await cli(['proposals', 'list'])).json<{ proposals: { id: string }[] }>().proposals.map((p) => p.id)).toEqual([a, b]);
    expect((await cli(['proposals', 'list', '--status', 'bogus'])).code).toBe(1);
    expect((await cli(['proposals', 'approve', a, '--actor', 'erin'])).json()).toMatchObject({ title: 'Use streaming' });
    expect((await cli(['proposals', 'approve', a])).code).toBe(1); // already reviewed
    expect((await cli(['proposals', 'reject', b, '--reason', 'duplicate', '--actor', 'erin'])).json()).toMatchObject({ status: 'rejected', review_reason: 'duplicate' });
    expect((await cli(['proposals', 'list', '--status', 'approved'])).json<{ proposals: unknown[] }>().proposals).toHaveLength(1);
  });

  it('lists, shows, approves and rejects approval requests', async () => {
    const pool = await getTestPool();
    await seedAll(pool);
    const deps = { pool, embedder, tokenBudget: 6000, authMode: 'warn' as const };
    const request = async (task: string, body = spec) => {
      const fid = (await startFeature(deps, { app: 'checkout', actor: 'dana', task_description: task, decision })).feature_id;
      return (await advancePhase(deps, { feature_id: fid, actor: 'dana', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': body } })).approval_id!;
    };
    const long = `${spec}${'line\n'.repeat(60)}`;
    const a = await request('one', long);
    const b = await request('two');

    expect((await cli(['approvals', 'list', '--app', 'checkout'])).json<{ approvals: { id: string }[] }>().approvals.map((x) => x.id)).toEqual([a, b]);
    expect((await cli(['approvals', 'list'])).json<{ approvals: unknown[] }>().approvals).toHaveLength(2);
    expect((await cli(['approvals', 'list', '--app', 'ghost'])).code).toBe(1);
    const short = (await cli(['approvals', 'show', a])).json<{ artifacts: { truncated: boolean; content: string }[] }>();
    expect(short.artifacts[0]).toMatchObject({ truncated: true });
    expect(short.artifacts[0]!.content.split('\n')).toHaveLength(40);
    const full = (await cli(['approvals', 'show', a, '--full'])).json<{ artifacts: { truncated: boolean; content: string }[] }>();
    expect(full.artifacts[0]).toMatchObject({ truncated: false, content: long });
    expect((await cli(['approvals', 'show', 'ap_nope'])).stderr).toContain('no approval request');
    expect((await cli(['approvals', 'approve', a, '--comment', 'ok', '--actor', 'erin'])).json()).toMatchObject({ approval: { status: 'approved' }, feature: { current_phase: 'implement' } });
    expect((await cli(['approvals', 'reject', b, '--reason', 'unclear', '--actor', 'erin'])).json()).toMatchObject({ approval: { status: 'rejected' } });
    expect((await cli(['approvals', 'approve', a])).code).toBe(1);
    expect((await cli(['approvals', 'list', '--status', 'approved'])).json<{ approvals: unknown[] }>().approvals).toHaveLength(1);
  });

  it('evaluates retrieval and fails below the thresholds', async () => {
    await seedPacks(await getTestPool());
    const ok = await cli(['eval', 'packs/evals/seed.yaml', '--k', '4']);
    expect(ok.code).toBe(0);
    expect(ok.json()).toMatchObject({ k: 4, cases: expect.any(Array) });
    const strict = await cli(['eval', 'packs/evals/seed.yaml', '--min-recall', '1.01']);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toMatch(/recall .* \(min 1.01\)/);
    expect((await cli(['eval', 'packs/evals/seed.yaml', '--min-mrr', '1.01'])).code).toBe(1);
  });
});
