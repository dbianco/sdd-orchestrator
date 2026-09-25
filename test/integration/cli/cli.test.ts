import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdtemp, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const run = promisify(execFile);

async function admin(...args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run('npx', ['tsx', 'src/cli/index.ts', ...args], {
    env: { ...process.env, SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'fake' }, cwd: process.cwd(),
  });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

describe.skipIf(!url)('sdd-admin', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('registers and configures apps', async () => {
    expect(await admin('app', 'register', 'checkout', '--name', 'Checkout', '--compliance', '--actor', 'daniel')).toMatchObject({ slug: 'checkout', compliance: true, created_by: 'daniel' });
    expect(await admin('app', 'update', 'checkout', '--stack', 'typescript,react', '--budget', '5000', '--min-similarity', '0.4')).toMatchObject({ default_stack: ['typescript', 'react'], token_budget: 5000 });
    const dir = await mkdtemp(join(tmpdir(), 'sdd-'));
    await writeFile(join(dir, 'policy.json'), JSON.stringify({ framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: ['**/webhooks/**'] }));
    expect(await admin('app', 'set-policy', 'checkout', join(dir, 'policy.json'), '--reason', 'PCI')).toMatchObject({ version: 1, reason: 'PCI' });
    expect(await admin('app', 'add-stop-condition', 'checkout', 'Never change tax rounding')).toMatchObject({ stop_conditions: ['Never change tax rounding'] });
    const list = await admin('app', 'list') as { apps: { slug: string; policy_version: number }[] };
    expect(list.apps).toEqual([expect.objectContaining({ slug: 'checkout', policy_version: 1 })]);
  });

  it('ingests, deprecates and reindexes', async () => {
    const r = await admin('ingest', `${fixtures}mini-framework`) as { created: string[] };
    expect(r.created).toHaveLength(3);
    expect(await admin('deprecate', 'mini.guide.proposals', '--reason', 'obsolete')).toMatchObject({ stable_id: 'mini.guide.proposals', status: 'deprecated' });
    expect(await admin('deprecate-framework', 'mini', '--version', '1.0.0', '--reason', 'unused')).toMatchObject({ deprecated: 1 });
    expect(await admin('reindex')).toMatchObject({ chunks: expect.any(Number) });
  });

  it('fails with exit code 1 and a message on an invalid pack', async () => {
    await expect(admin('ingest', `${fixtures}does-not-exist`)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('pack.yaml') });
  });

  it('ingests every pack under a directory in one call', async () => {
    const r = await admin('ingest-all', fixtures) as { ingested: { pack: string; created: string[] }[]; failed: unknown[] };
    expect(r.failed).toEqual([]);
    expect(r.ingested.map((p) => p.pack).sort()).toEqual(['mini', 'mini-company']);
    expect(r.ingested.find((p) => p.pack === 'mini')?.created).toHaveLength(3);
  });

  it('keeps ingesting after one pack fails and reports it, with a nonzero exit code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdd-batch-'));
    await cp(`${fixtures}mini-company`, join(dir, 'good'), { recursive: true });
    await mkdir(join(dir, 'broken'));
    await writeFile(join(dir, 'broken', 'pack.yaml'), 'name: broken\nkind: standard\nversion: not-a-semver\n');
    const err = await admin('ingest-all', dir).catch((e: Error & { code?: number; stdout?: string }) => e);
    expect(err).toMatchObject({ code: 1 });
    const body = JSON.parse((err as { stdout: string }).stdout.trim().split('\n').pop()!) as { ingested: { pack: string }[]; failed: { dir: string; error: string }[] };
    expect(body.ingested.map((p) => p.pack)).toEqual(['mini-company']);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]).toMatchObject({ dir: join(dir, 'broken') });
  });

  it('rejects invalid app update values instead of silently persisting them', async () => {
    await admin('app', 'register', 'checkout', '--name', 'Checkout', '--actor', 'daniel');
    await expect(admin('app', 'update', 'checkout', '--min-similarity', 'abc')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('--min-similarity') });
    await expect(admin('app', 'update', 'checkout', '--budget', '-9')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('--budget') });
  });

  it('rejects an invalid proposals --status value instead of reporting a false all-clear', async () => {
    await expect(admin('proposals', 'list', '--status', 'bogus')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('--status') });
  });

  it('rejects a policy file with a typo\'d key instead of installing a silently-empty policy', async () => {
    await admin('app', 'register', 'checkout', '--name', 'Checkout', '--actor', 'daniel');
    const dir = await mkdtemp(join(tmpdir(), 'sdd-'));
    const file = join(dir, 'typo-policy.json');
    await writeFile(file, JSON.stringify({ path_rule: [{ glob: '**/payments/**', framework: 'bmad' }] }));
    await expect(admin('app', 'set-policy', 'checkout', file, '--reason', 'PCI')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(file) });
  });

  it('exports an empty traceability matrix as CSV and JSON', async () => {
    await admin('app', 'register', 'checkout', '--name', 'Checkout');
    const { stdout } = await run('npx', ['tsx', 'src/cli/index.ts', 'export', 'rtm', 'checkout'], { env: { ...process.env, SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'fake' }, cwd: process.cwd() });
    expect(stdout).toBe('feature_id,slug,external_ref,req_id,covered,files_changed,tests_passed,tests_failed,evidence_source,spec_approved_by,verify_approved_by,archived_at\n');
    expect(await admin('export', 'rtm', 'checkout', '--format', 'json')).toEqual({ app: 'checkout', rows: [] });
    await expect(admin('export', 'rtm', 'nope')).rejects.toMatchObject({ code: 1 });
  });

  it('creates, lists and revokes tokens; the secret is shown once and never listed', async () => {
    await admin('app', 'register', 'checkout', '--name', 'Checkout');
    const created = await admin('token', 'create', '--for', 'dana', '--scope', 'host,approver', '--name', 'dana laptop', '--app', 'checkout', '--expires', '90d', '--actor', 'root') as { token: { id: string; scopes: string[]; app_ids: string[]; expires_at: string; created_by: string }; secret: string };
    expect(created.secret).toMatch(/^sdd_/);
    expect(created.token).toMatchObject({ scopes: ['host', 'approver'], created_by: 'root' });
    expect(created.token.app_ids).toHaveLength(1);
    expect(new Date(created.token.expires_at).getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    const listed = await admin('token', 'list', '--for', 'dana') as { tokens: Record<string, unknown>[] };
    expect(listed.tokens).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(JSON.stringify(listed)).not.toContain('token_hash');
    expect(await admin('token', 'revoke', created.token.id, '--reason', 'lost')).toMatchObject({ id: created.token.id, revoked_reason: expect.stringContaining('lost') });
    await expect(admin('token', 'create', '--for', 'x', '--scope', 'root', '--name', 'n')).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('--scope') });
    await expect(admin('token', 'create', '--for', 'x', '--scope', 'ci', '--name', 'n', '--app', 'nope')).rejects.toMatchObject({ code: 1 });
  });
});
