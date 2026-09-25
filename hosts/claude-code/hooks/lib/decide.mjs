// Edit rules for the sdd plugin: which files the agent may change in the current branch state.

const SPEC_PREFIXES = ['openspec/', 'specs/', '.specify/', '_bmad-output/', '.kiro/specs/', '.sdlc/'];
const SPEC_PHASES = new Set(['specify', 'plan', 'tasks']);

export function isSpecPath(relPath) {
  if (SPEC_PREFIXES.some((p) => relPath.startsWith(p))) return true;
  return relPath.startsWith('docs/') && relPath.endsWith('.md');
}

function verdict(config, reason) {
  return config.enforcement === 'warn' ? { allow: true, warning: reason } : { allow: false, reason };
}

export function decideEdit({ state, config, relPath, branch }) {
  if (relPath === '.sdd' || relPath.startsWith('.sdd/')) {
    return { allow: false, reason: '.sdd/ is maintained by the sdd hooks from server responses; do not edit it.' };
  }
  if (config.enforcement === 'off' || isSpecPath(relPath)) return { allow: true };
  if (state?.feature_id) {
    const f = state.feature_id;
    if (state.status === 'blocked') {
      return verdict(config, `Feature ${f} is blocked${state.blocked_reason ? `: ${state.blocked_reason}` : ''}. A person must unblock it with a backward move before code changes.`);
    }
    if (state.pending_approval) {
      return verdict(config, `Feature ${f} waits for approval ${state.pending_approval.approval_id}. Ask a reviewer to approve it, then poll get_feature_status; do not change code meanwhile.`);
    }
    if (SPEC_PHASES.has(state.current_phase)) {
      return verdict(config, `Feature ${f} is in ${state.current_phase}; code changes start in implement. Write the spec artifacts (${relPath} is not one) and call advance_phase.`);
    }
    return { allow: true };
  }
  if (state?.routing_id) {
    if (state.intent === 'trivial' || state.intent === 'spike') return { allow: true };
    return verdict(config, `Work is routed on ${branch} (${state.routing_id}) but no feature is started. Call start_feature with the accepted decision before editing ${relPath}.`);
  }
  return verdict(config, `No SDD work is routed on ${branch}. Call route_task (and start_feature unless it is trivial) before editing ${relPath}.`);
}

const TARGET = String.raw`("[^"]+"|'[^']+'|[^\s;&|<>]+)`;
const REDIRECT = new RegExp(String.raw`(?:^|[^0-9&>])>>?\s*` + TARGET, 'g');
const TEE = new RegExp(String.raw`\btee\s+(?:(?:-a|--append)\s+)*` + TARGET, 'g');

// Best effort: plain redirections and tee only; scripts, sed -i and package managers are not detected.
export function bashWriteTargets(command) {
  const found = [];
  for (const re of [REDIRECT, TEE]) {
    for (const m of command.matchAll(re)) found.push({ at: m.index, target: m[1].replace(/^["']|["']$/g, '') });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.target)
    .filter((t) => !t.startsWith('&') && t !== '/dev/null' && !t.startsWith('/dev/'));
}
