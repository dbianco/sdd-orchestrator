import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOKS = resolve('hosts/claude-code/hooks');
let dir;

function hook(name, input) {
  const r = spawnSync('node', [join(HOOKS, name)], { input: JSON.stringify({ cwd: dir, ...input }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' }).trim();
const feature = (over = {}) => ({ feature_id: 'f_1', current_phase: 'specify', phase_alias: 'proposal', status: 'active', blocked_reason: null, pending_approval: null, ...over });
const sddResult = (tool, result) => hook('post-sdd-tool.mjs', { hook_event_name: 'PostToolUse', tool_name: `mcp__plugin_sdd_sdd__${tool}`, tool_input: {}, tool_response: JSON.stringify(result) });
const edit = (file) => hook('pre-edit.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, file), content: 'x' } });
const bash = (name, command) => hook(name, { hook_event_name: name.startsWith('pre') ? 'PreToolUse' : 'PostToolUse', tool_name: 'Bash', tool_input: { command } });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdd-hooks-'));
  git('init', '-q', '-b', 'feature/csv');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  await mkdir(join(dir, '.sdd'));
  await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ app: 'checkout' }));
});

describe('sdd hooks', () => {
  it('do nothing in a repository without .sdd/config.json', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'sdd-bare-'));
    const r = spawnSync('node', [join(HOOKS, 'pre-edit.mjs')], { input: JSON.stringify({ cwd: bare, tool_input: { file_path: join(bare, 'src/a.ts') } }), env: { ...process.env, CLAUDE_PROJECT_DIR: bare }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('walk a feature from routing to implement, blocking code edits until then', async () => {
    expect(hook('session-start.mjs', { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext).toMatch(/nothing is routed/);
    expect(edit('src/a.ts').hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/route_task/) });
    expect(edit('openspec/changes/csv/proposal.md')).toBeNull();

    sddResult('route_task', { routing_id: 'r_1', decision: { intent: 'feature', framework: 'openspec' }, lite_pack: null });
    expect(edit('src/a.ts').hookSpecificOutput.permissionDecisionReason).toMatch(/start_feature/);

    sddResult('start_feature', { feature_id: 'f_1', routing_id: 'r_1', feature: feature() });
    expect(edit('src/a.ts').hookSpecificOutput.permissionDecisionReason).toMatch(/advance_phase/);

    sddResult('advance_phase', { result: 'awaiting_approval', approval_id: 'ap_1', feature: feature({ pending_approval: { approval_id: 'ap_1', to: 'implement' } }) });
    expect(edit('src/a.ts').hookSpecificOutput.permissionDecisionReason).toMatch(/ap_1/);
    expect(hook('session-start.mjs', { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext).toMatch(/waits for approval ap_1/);

    sddResult('get_feature_status', { ...feature({ current_phase: 'implement', phase_alias: 'apply' }), transitions: [] });
    expect(edit('src/a.ts')).toBeNull();
    const state = JSON.parse(await readFile(join(dir, '.sdd', 'state.json'), 'utf8'));
    expect(state.branches['feature/csv']).toMatchObject({ routing_id: 'r_1', feature_id: 'f_1', current_phase: 'implement', pending_approval: null });

    sddResult('advance_phase', { result: 'pass', feature: feature({ status: 'archived', current_phase: 'integrate' }) });
    expect(JSON.parse(await readFile(join(dir, '.sdd', 'state.json'), 'utf8')).branches).toEqual({});
  });

  it('never let the agent change .sdd/, by edit or shell', () => {
    sddResult('route_task', { routing_id: 'r_2', decision: { intent: 'trivial', framework: 'none' }, lite_pack: { rendered: 'x' } });
    expect(edit('src/a.ts')).toBeNull();
    expect(edit('.sdd/state.json').hookSpecificOutput.permissionDecision).toBe('deny');
    expect(bash('pre-bash.mjs', 'rm -rf .sdd/state.json').hookSpecificOutput.permissionDecision).toBe('deny');
    expect(bash('pre-bash.mjs', 'echo {} > .sdd/state.json').hookSpecificOutput.permissionDecision).toBe('deny');
    expect(bash('pre-bash.mjs', 'npm test 2>&1 | tail')).toBeNull();
  });

  it('check shell redirections against the edit rules and warn instead in warn mode', async () => {
    expect(bash('pre-bash.mjs', 'echo x > src/a.ts').hookSpecificOutput.permissionDecision).toBe('deny');
    await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ app: 'checkout', enforcement: 'warn' }));
    const warned = edit('src/a.ts').hookSpecificOutput;
    expect(warned).toMatchObject({ hookEventName: 'PreToolUse', additionalContext: expect.stringMatching(/^SDD warning: .*route_task/) });
    expect(warned.permissionDecision).toBeUndefined();
  });

  it('ask for record_commit after git commit, and for the trailer when it is missing', () => {
    sddResult('start_feature', { feature_id: 'f_1', routing_id: 'r_1', feature: feature({ current_phase: 'implement' }) });
    git('commit', '-q', '--allow-empty', '-m', 'add export');
    const sha = git('rev-parse', 'HEAD');
    const ctx = bash('post-bash.mjs', 'git commit -m "add export"').hookSpecificOutput.additionalContext;
    expect(ctx).toContain(`sha "${sha}"`);
    expect(ctx).toContain('feature_id "f_1"');
    expect(ctx).toContain('"SDD-Ref: f_1" trailer');
    git('commit', '-q', '--allow-empty', '-m', 'more\n\nSDD-Ref: f_1');
    expect(bash('post-bash.mjs', 'git commit -m more').hookSpecificOutput.additionalContext).not.toContain('trailer');
    expect(bash('post-bash.mjs', 'git status')).toBeNull();
  });
});
