#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { context, projectDir, readInput, run } from './lib/io.mjs';
import { currentBranch, readBranchState, readConfig } from './lib/state.mjs';

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

run(async () => {
  const input = await readInput();
  const dir = projectDir(input);
  const config = await readConfig(dir);
  if (!config || !/\bgit\s+commit\b/.test(input.tool_input?.command ?? '')) return;
  const sha = git(dir, 'rev-parse', 'HEAD');
  const trailer = git(dir, 'log', '-1', '--format=%(trailers:key=SDD-Ref,valueonly)');
  const s = await readBranchState(dir, currentBranch(dir));
  const anchor = s?.feature_id ? `feature_id "${s.feature_id}"` : s?.routing_id ? `routing_id "${s.routing_id}"` : null;
  const lines = anchor
    ? [`Commit ${sha} was created. Call record_commit with app "${config.app}", sha "${sha}", the commit message, files_changed (git show --name-only ${sha}) and ${anchor}.`]
    : [`Commit ${sha} was created, but nothing is routed on this branch. Call route_task for this work, then record_commit with the returned routing_id.`];
  const ref = s?.feature_id ?? s?.routing_id;
  if (ref && !trailer) lines.push(`The commit has no "SDD-Ref: ${ref}" trailer; add it to later commits so CI can attribute its evidence.`);
  context('PostToolUse', lines.join('\n'));
});
