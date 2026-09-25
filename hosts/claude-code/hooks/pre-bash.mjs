#!/usr/bin/env node
import { context, deny, projectDir, projectRelative, readInput, run } from './lib/io.mjs';
import { bashWriteTargets, decideEdit } from './lib/decide.mjs';
import { currentBranch, readBranchState, readConfig } from './lib/state.mjs';

const TOUCHES_SDD = /\b(?:rm|mv|cp|touch|truncate|ln|sed\s+-i|perl\s+-i)\b[^;&|]*\.sdd\//;

run(async () => {
  const input = await readInput();
  const dir = projectDir(input);
  const config = await readConfig(dir);
  if (!config) return;
  const command = input.tool_input?.command ?? '';
  if (TOUCHES_SDD.test(command)) { deny('.sdd/ is maintained by the sdd hooks from server responses; do not change it from the shell.'); return; }
  const branch = currentBranch(dir);
  const state = await readBranchState(dir, branch);
  for (const target of bashWriteTargets(command)) {
    const relPath = projectRelative(dir, target);
    if (!relPath) continue;
    const d = decideEdit({ state, config, relPath, branch });
    if (!d.allow) { deny(d.reason); return; }
    if (d.warning) { context('PreToolUse', `SDD warning: ${d.warning}`); return; }
  }
});
