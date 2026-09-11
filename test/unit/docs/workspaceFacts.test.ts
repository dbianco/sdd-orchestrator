import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../docs/verification/workspace-facts.sh', import.meta.url));

async function repo(commits: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wf-'));
  await run('git', ['init', '-q'], { cwd: dir });
  await run('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await run('git', ['config', 'user.name', 't'], { cwd: dir });
  for (let i = 0; i < commits; i++) {
    await writeFile(join(dir, `f${i}.txt`), String(i));
    await run('git', ['add', '.'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', `c${i}`], { cwd: dir });
  }
  return dir;
}

describe('workspace-facts.sh', () => {
  it('reports greenfield for a young repo without a spec library', async () => {
    const dir = await repo(3);
    const { stdout } = await run('bash', [script], { cwd: dir });
    expect(JSON.parse(stdout)).toEqual({ has_spec_library: false, is_greenfield: true, repositories: 1, host: expect.any(String) });
  });
  it('detects a spec library and honours the config greenfield flag', async () => {
    const dir = await repo(25);
    await mkdir(join(dir, 'openspec'));
    const { stdout } = await run('bash', [script], { cwd: dir });
    expect(JSON.parse(stdout)).toMatchObject({ has_spec_library: true, is_greenfield: false });
    await mkdir(join(dir, '.sdd'));
    await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ greenfield: true }));
    const { stdout: forced } = await run('bash', [script], { cwd: dir });
    expect(JSON.parse(forced).is_greenfield).toBe(true);
  });
  it('accepts a repositories count and a host name', async () => {
    const dir = await repo(1);
    const { stdout } = await run('bash', [script, '--repositories', '2', '--host', 'cursor'], { cwd: dir });
    expect(JSON.parse(stdout)).toMatchObject({ repositories: 2, host: 'cursor' });
  });
});
