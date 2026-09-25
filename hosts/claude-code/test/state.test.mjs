import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToolResponse, readBranchState, stateFromToolResult, writeBranchState } from '../hooks/lib/state.mjs';

const feature = { feature_id: 'f_1', current_phase: 'specify', status: 'active', blocked_reason: null, pending_approval: null, phase_alias: 'proposal' };

describe('parseToolResponse', () => {
  it('parses the JSON string Claude Code passes, and accepts objects', () => {
    expect(parseToolResponse('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolResponse({ a: 1 })).toEqual({ a: 1 });
    expect(parseToolResponse('not json')).toBeNull();
  });
});

describe('stateFromToolResult', () => {
  it('reads routing from route_task, for a plugin-bundled or project server', () => {
    const r = { routing_id: 'r_1', decision: { intent: 'trivial', framework: 'none' }, lite_pack: { rendered: 'x' } };
    for (const name of ['mcp__sdd__route_task', 'mcp__plugin_sdd_sdd__route_task']) {
      expect(stateFromToolResult(name, r, null)).toMatchObject({ routing_id: 'r_1', intent: 'trivial', lite: true });
    }
  });
  it('reads feature state from start_feature, advance_phase, get_context and get_feature_status', () => {
    expect(stateFromToolResult('mcp__sdd__start_feature', { feature_id: 'f_1', routing_id: 'r_1', feature }, null)).toMatchObject({ routing_id: 'r_1', feature_id: 'f_1', current_phase: 'specify' });
    const pending = { ...feature, pending_approval: { approval_id: 'ap_1', to: 'implement' } };
    expect(stateFromToolResult('mcp__sdd__advance_phase', { result: 'awaiting_approval', feature: pending }, { routing_id: 'r_1' })).toMatchObject({ routing_id: 'r_1', pending_approval: { approval_id: 'ap_1' } });
    expect(stateFromToolResult('mcp__sdd__get_context', { feature: { ...feature, current_phase: 'implement' } }, null)).toMatchObject({ current_phase: 'implement' });
    expect(stateFromToolResult('mcp__sdd__get_feature_status', { ...feature, current_phase: 'verify', transitions: [] }, null)).toMatchObject({ current_phase: 'verify' });
  });
  it('clears the branch when the feature is archived and ignores other tools', () => {
    expect(stateFromToolResult('mcp__sdd__advance_phase', { feature: { ...feature, status: 'archived' } }, { feature_id: 'f_1' })).toBeNull();
    expect(stateFromToolResult('mcp__sdd__search_memory', { chunks: [] }, { feature_id: 'f_1' })).toEqual({ feature_id: 'f_1' });
    expect(stateFromToolResult('mcp__other__route_task', { routing_id: 'r_9' }, null)).toBeNull();
  });
});

describe('branch state file', () => {
  it('keeps one entry per branch and removes an entry set to null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdd-state-'));
    await writeBranchState(dir, 'main', { routing_id: 'r_1' });
    await writeBranchState(dir, 'feature/x', { feature_id: 'f_2' });
    expect(await readBranchState(dir, 'main')).toMatchObject({ routing_id: 'r_1' });
    await writeBranchState(dir, 'main', null);
    expect(await readBranchState(dir, 'main')).toBeNull();
    expect(JSON.parse(await readFile(join(dir, '.sdd', 'state.json'), 'utf8')).branches).toHaveProperty('feature/x');
  });
});
