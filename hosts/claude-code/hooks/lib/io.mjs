// Shared stdin/stdout plumbing for the sdd hook scripts.
import { isAbsolute, relative, resolve } from 'node:path';

export async function readInput() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

// Path relative to the project, or null when it lies outside it.
export function projectRelative(dir, file) {
  const rel = relative(dir, resolve(dir, file));
  return rel.startsWith('..') || isAbsolute(rel) ? null : rel.split('\\').join('/');
}

export function emit(value) {
  process.stdout.write(JSON.stringify(value));
}

export function deny(reason) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

export function context(hookEventName, text) {
  emit({ hookSpecificOutput: { hookEventName, additionalContext: text } });
}

// A hook that fails on its own must not block the session; decisions are made explicitly by the callers.
export function run(main) {
  main().catch((e) => { process.stderr.write(`sdd hook: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(0); });
}
