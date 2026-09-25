// Branch state cache for the sdd plugin, written only from sdd tool results.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SDD_TOOL = /^mcp__(?:plugin_sdd_)?sdd__([a-z_]+)$/;
const FEATURE_TOOLS = new Set(['start_feature', 'advance_phase', 'get_context', 'get_feature_status']);

export function sddToolName(toolName) {
  return SDD_TOOL.exec(toolName ?? '')?.[1] ?? null;
}

export function parseToolResponse(response) {
  if (response && typeof response === 'object') return response;
  if (typeof response !== 'string') return null;
  try { return JSON.parse(response); } catch { return null; }
}

export function currentBranch(cwd) {
  try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || '_'; } catch { return '_'; }
}

export async function readConfig(projectDir) {
  try {
    const c = JSON.parse(await readFile(join(projectDir, '.sdd', 'config.json'), 'utf8'));
    return { enforcement: 'block', ...c };
  } catch { return null; }
}

async function readAll(projectDir) {
  try { return JSON.parse(await readFile(join(projectDir, '.sdd', 'state.json'), 'utf8')); } catch { return { branches: {} }; }
}

export async function readBranchState(projectDir, branch) {
  return (await readAll(projectDir)).branches?.[branch] ?? null;
}

export async function writeBranchState(projectDir, branch, value) {
  const all = await readAll(projectDir);
  all.branches ??= {};
  if (value === null) delete all.branches[branch];
  else all.branches[branch] = { ...value, updated_at: new Date().toISOString() };
  await mkdir(join(projectDir, '.sdd'), { recursive: true });
  const tmp = join(projectDir, '.sdd', `state.json.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify(all, null, 2)}\n`);
  await rename(tmp, join(projectDir, '.sdd', 'state.json'));
}

// New state for the branch after an sdd tool returned `result`; null clears the branch.
export function stateFromToolResult(toolName, result, prev) {
  const tool = sddToolName(toolName);
  if (!tool || !result) return prev;
  if (tool === 'route_task') {
    return { ...prev, routing_id: result.routing_id, intent: result.decision?.intent ?? null, lite: result.lite_pack != null };
  }
  if (!FEATURE_TOOLS.has(tool)) return prev;
  const f = tool === 'get_feature_status' ? result : result.feature;
  if (!f?.feature_id) return prev;
  if (f.status === 'archived') return null;
  return {
    ...prev,
    ...(result.routing_id ? { routing_id: result.routing_id } : {}),
    feature_id: f.feature_id, current_phase: f.current_phase, phase_alias: f.phase_alias ?? null, status: f.status,
    blocked_reason: f.blocked_reason ?? null, pending_approval: f.pending_approval ?? null,
  };
}
