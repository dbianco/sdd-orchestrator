import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context, deny, emit, projectDir, projectRelative, readInput, run } from '../hooks/lib/io.mjs';
import { currentBranch, readBranchState, readConfig, sddToolName, stateFromToolResult, writeBranchState } from '../hooks/lib/state.mjs';

describe('io helpers', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.CLAUDE_PROJECT_DIR; });

  it('reads the JSON the host pipes to stdin, defaulting to an empty object', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from('{"cwd":"/x"}')]), configurable: true });
    expect(await readInput()).toEqual({ cwd: '/x' });
    Object.defineProperty(process, 'stdin', { value: Readable.from([]), configurable: true });
    expect(await readInput()).toEqual({});
    Object.defineProperty(process, 'stdin', original);
  });

  it('resolves the project directory from the environment, the input or the working directory', () => {
    process.env.CLAUDE_PROJECT_DIR = '/env';
    expect(projectDir({ cwd: '/input' })).toBe('/env');
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(projectDir({ cwd: '/input' })).toBe('/input');
    expect(projectDir({})).toBe(process.cwd());
  });

  it('makes paths project-relative, and null when they lie outside the project', () => {
    expect(projectRelative('/p', '/p/src/a.ts')).toBe('src/a.ts');
    expect(projectRelative('/p', 'src/a.ts')).toBe('src/a.ts');
    expect(projectRelative('/p', '/elsewhere/a.ts')).toBeNull();
    expect(projectRelative('/p', '../a.ts')).toBeNull();
  });

  it('writes hook output as JSON on stdout', () => {
    const out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    emit({ a: 1 });
    deny('no');
    context('SessionStart', 'hello');
    expect(out.map((o) => JSON.parse(o))).toEqual([
      { a: 1 },
      { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } },
      { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hello' } },
    ]);
  });

  it('never lets a failing hook block the session', async () => {
    const err = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true; });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    run(async () => { throw new Error('boom'); });
    run(async () => { throw 'plain'; });
    run(async () => undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(err.join('')).toContain('sdd hook: boom');
    expect(err.join('')).toContain('sdd hook: plain');
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('state helpers', () => {
  afterEach(() => { delete process.env.SDD_ENFORCEMENT; });

  it('reads the current branch, and falls back outside a repository', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'sdd-git-'));
    execFileSync('git', ['init', '-q', '-b', 'feature/x'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.x', 'commit', '-q', '--allow-empty', '-m', 'i'], { cwd: repo });
    expect(currentBranch(repo)).toBe('feature/x');
    expect(currentBranch(await mkdtemp(join(tmpdir(), 'sdd-nogit-')))).toBe('_');
  });

  it('reads the repository config with defaults, a personal override and invalid values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdd-cfg-'));
    expect(await readConfig(dir)).toBeNull();
    await mkdir(join(dir, '.sdd'));
    await writeFile(join(dir, '.sdd', 'config.json'), '{ nope');
    expect(await readConfig(dir)).toBeNull();
    await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ app: 'a' }));
    expect(await readConfig(dir)).toEqual({ app: 'a', enforcement: 'block' });
    await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ app: 'a', enforcement: 'warn' }));
    expect((await readConfig(dir)).enforcement).toBe('warn');
    process.env.SDD_ENFORCEMENT = 'off';
    expect((await readConfig(dir)).enforcement).toBe('off');
    process.env.SDD_ENFORCEMENT = 'nonsense';
    expect((await readConfig(dir)).enforcement).toBe('warn');
    await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ app: 'a', enforcement: 'weird' }));
    expect((await readConfig(dir)).enforcement).toBe('block');
  });

  it('stores and clears per-branch state, tolerating a missing or corrupt state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdd-state-'));
    expect(await readBranchState(dir, 'main')).toBeNull();
    await writeBranchState(dir, 'main', { feature_id: 'f_1' });
    expect(await readBranchState(dir, 'main')).toMatchObject({ feature_id: 'f_1' });
    await writeBranchState(dir, 'other', { routing_id: 'r_1' });
    await writeBranchState(dir, 'main', null);
    expect(await readBranchState(dir, 'main')).toBeNull();
    expect(await readBranchState(dir, 'other')).toMatchObject({ routing_id: 'r_1' });
    await writeFile(join(dir, '.sdd', 'state.json'), '{ corrupt');
    expect(await readBranchState(dir, 'other')).toBeNull();
    await writeFile(join(dir, '.sdd', 'state.json'), '{}');
    await writeBranchState(dir, 'x', { a: 1 }); // a file without a branches map is repaired
    expect(await readBranchState(dir, 'x')).toMatchObject({ a: 1 });
  });

  it('only recognises sdd tool names and ignores results it cannot use', () => {
    expect(sddToolName('mcp__sdd__route_task')).toBe('route_task');
    expect(sddToolName('mcp__plugin_sdd_sdd__start_feature')).toBe('start_feature');
    expect(sddToolName('Bash')).toBeNull();
    expect(sddToolName(undefined)).toBeNull();
    const prev = { routing_id: 'r_1' };
    expect(stateFromToolResult('Bash', {}, prev)).toBe(prev);
    expect(stateFromToolResult('mcp__sdd__route_task', null, prev)).toBe(prev);
    expect(stateFromToolResult('mcp__sdd__search_memory', { chunks: [] }, prev)).toBe(prev);
    expect(stateFromToolResult('mcp__sdd__start_feature', { feature: {} }, prev)).toBe(prev);
    expect(stateFromToolResult('mcp__sdd__get_feature_status', { feature_id: 'f_1', status: 'archived' }, prev)).toBeNull();
    expect(stateFromToolResult('mcp__sdd__route_task', { routing_id: 'r_2', decision: null, lite_pack: null }, null)).toMatchObject({ routing_id: 'r_2', intent: null, lite: false });
  });
});
