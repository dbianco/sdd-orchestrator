import { vi } from 'vitest';
import { runCli } from '../../src/cli/program.js';

class ExitSignal extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

export interface CliResult { code: number; stdout: string; stderr: string; json: <T = Record<string, unknown>>() => T }

/**
 * Runs sdd-admin in this process so its code is measured by coverage: output is captured, process.exit becomes an
 * exception, and the environment (and working directory) are restored afterwards.
 */
export async function cli(args: string[], opts: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<CliResult> {
  const url = process.env.SDD_TEST_DATABASE_URL;
  const env = { SDD_DATABASE_URL: url, SDD_EMBEDDING_PROVIDER: 'fake', ...opts.env };
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  // init may switch the provider itself when no key is set; restore whatever it left behind
  for (const k of ['SDD_EMBEDDING_PROVIDER']) if (!saved.has(k)) saved.set(k, process.env[k]);
  const cwd = process.cwd();
  if (opts.cwd) process.chdir(opts.cwd);
  let stdout = '';
  let stderr = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(((c: string | Uint8Array) => { stdout += String(c); return true; }) as never);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(((c: string | Uint8Array) => { stderr += String(c); return true; }) as never);
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ExitSignal(code ?? 0); }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  let code: number | undefined;
  try {
    await runCli(['node', 'sdd-admin', ...args]);
  } catch (e) {
    if (e instanceof ExitSignal) code = e.code; else throw e;
  } finally {
    out.mockRestore(); err.mockRestore(); exit.mockRestore();
    code ??= Number(process.exitCode ?? 0);
    process.exitCode = previousExitCode;
    if (opts.cwd) process.chdir(cwd);
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return {
    code, stdout, stderr,
    json: <T = Record<string, unknown>>() => JSON.parse(stdout.trim().split('\n').pop()!) as T,
  };
}
