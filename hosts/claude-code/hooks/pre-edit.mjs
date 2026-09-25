#!/usr/bin/env node
import { context, deny, projectDir, projectRelative, readInput, run } from './lib/io.mjs';
import { decideEdit } from './lib/decide.mjs';
import { currentBranch, readBranchState, readConfig } from './lib/state.mjs';

run(async () => {
  const input = await readInput();
  const dir = projectDir(input);
  const config = await readConfig(dir);
  if (!config) return;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const relPath = file ? projectRelative(dir, file) : null;
  if (!relPath) return;
  const branch = currentBranch(dir);
  const d = decideEdit({ state: await readBranchState(dir, branch), config, relPath, branch });
  if (!d.allow) deny(d.reason);
  else if (d.warning) context('PreToolUse', `SDD warning: ${d.warning}`);
});
