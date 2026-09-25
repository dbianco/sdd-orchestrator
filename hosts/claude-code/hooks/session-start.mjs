#!/usr/bin/env node
import { context, projectDir, readInput, run } from './lib/io.mjs';
import { currentBranch, readBranchState, readConfig } from './lib/state.mjs';

run(async () => {
  const input = await readInput();
  const dir = projectDir(input);
  const config = await readConfig(dir);
  if (!config) return;
  const branch = currentBranch(dir);
  const s = await readBranchState(dir, branch);
  const lines = [`This repository follows the SDD Orchestrator (app "${config.app}", edit enforcement "${config.enforcement}"). Follow the sdd-workflow skill.`];
  if (s?.feature_id) {
    const phase = s.phase_alias && s.phase_alias !== s.current_phase ? `${s.current_phase} (${s.phase_alias})` : s.current_phase;
    lines.push(`Branch ${branch}: feature ${s.feature_id} is in ${phase}, status ${s.status}.`);
    if (s.status === 'blocked') lines.push(`It is blocked${s.blocked_reason ? `: ${s.blocked_reason}` : ''}; a person must unblock it.`);
    if (s.pending_approval) lines.push(`It waits for approval ${s.pending_approval.approval_id}; do not change code until a reviewer decides.`);
    lines.push('Call get_context for its current pack before continuing.');
  } else if (s?.routing_id) {
    lines.push(`Branch ${branch}: ${s.intent ?? 'routed'} work is routed (${s.routing_id})${s.intent === 'trivial' || s.intent === 'spike' ? '' : ' but no feature is started'}.`);
  } else {
    lines.push(`Branch ${branch}: nothing is routed. Call route_task before editing code.`);
  }
  context('SessionStart', lines.join('\n'));
});
