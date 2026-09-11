import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdtemp } from 'node:fs/promises';
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
});
