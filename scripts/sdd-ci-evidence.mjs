#!/usr/bin/env node
// Posts CI evidence for the feature named by the SDD-Ref trailer on HEAD.
// Usage: node scripts/sdd-ci-evidence.mjs --evidence evidence.json [--run-url URL] [--feature f_...] [--branch name]
// Environment: SDD_URL (server base URL), SDD_CI_TOKEN (token with the ci scope), SDD_APP (app slug).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function die(message) {
  process.stderr.write(`sdd-ci-evidence: ${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: { evidence: { type: 'string' }, 'run-url': { type: 'string' }, feature: { type: 'string' }, branch: { type: 'string' } },
});
const { SDD_URL, SDD_CI_TOKEN, SDD_APP } = process.env;
if (!values.evidence) die('--evidence <file> is required');
if (!SDD_URL || !SDD_CI_TOKEN || !SDD_APP) die('SDD_URL, SDD_CI_TOKEN and SDD_APP must be set');

const ref = values.feature ?? git('log', '-1', '--format=%(trailers:key=SDD-Ref,valueonly)').split('\n')[0]?.trim() ?? '';
if (!ref) { process.stdout.write('sdd-ci-evidence: no SDD-Ref trailer on HEAD; nothing to report\n'); process.exit(0); }
if (!ref.startsWith('f_')) { process.stdout.write(`sdd-ci-evidence: SDD-Ref ${ref} is not a feature id; nothing to report\n`); process.exit(0); }

let evidence;
try { evidence = JSON.parse(readFileSync(values.evidence, 'utf8')); } catch (e) { die(`cannot read ${values.evidence}: ${e.message}`); }

const body = {
  app: SDD_APP,
  feature_id: ref,
  commit_sha: git('rev-parse', 'HEAD'),
  // GitHub sets GITHUB_HEAD_REF to an empty string outside pull requests, so empty values fall through.
  branch: values.branch || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git('rev-parse', '--abbrev-ref', 'HEAD'),
  ...(values['run-url'] ? { run_url: values['run-url'] } : {}),
  evidence,
};
const res = await fetch(new URL('/api/ci/evidence', SDD_URL), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SDD_CI_TOKEN}` },
  body: JSON.stringify(body),
}).catch((e) => die(`cannot reach ${SDD_URL}: ${e.message}`));
const text = await res.text();
if (!res.ok) die(`server answered ${res.status}: ${text}`);
process.stdout.write(`${text}\n`);
