#!/usr/bin/env node
import { projectDir, readInput, run } from './lib/io.mjs';
import { currentBranch, parseToolResponse, readBranchState, readConfig, stateFromToolResult, writeBranchState } from './lib/state.mjs';

run(async () => {
  const input = await readInput();
  const dir = projectDir(input);
  if (!(await readConfig(dir))) return;
  const result = parseToolResponse(input.tool_response);
  if (!result) return;
  const branch = currentBranch(dir);
  const prev = await readBranchState(dir, branch);
  const next = stateFromToolResult(input.tool_name, result, prev);
  if (JSON.stringify(next) !== JSON.stringify(prev)) await writeBranchState(dir, branch, next);
});
