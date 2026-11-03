#!/usr/bin/env node
// Posts (or updates) a single SDD summary comment on the current pull request.
// Usage: node scripts/sdd-pr-comment.mjs [--feature f_...] [--pr 123] [--dry-run]
// Environment: SDD_URL, SDD_CI_TOKEN (ci scope), SDD_APP, GITHUB_TOKEN, GITHUB_REPOSITORY; the PR number comes from --pr,
// PR_NUMBER or the GitHub event payload. The feature id comes from the SDD-Ref trailer on HEAD unless --feature is given.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const MARKER = '<!-- sdd-orchestrator:summary -->';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const die = (m) => { process.stderr.write(`sdd-pr-comment: ${m}\n`); process.exit(1); };

const { values } = parseArgs({ options: { feature: { type: 'string' }, pr: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
const { SDD_URL, SDD_CI_TOKEN, SDD_APP, GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH } = process.env;
if (!SDD_URL || !SDD_CI_TOKEN || !SDD_APP) die('SDD_URL, SDD_CI_TOKEN and SDD_APP must be set');

const ref = values.feature ?? git('log', '-1', '--format=%(trailers:key=SDD-Ref,valueonly)').split('\n')[0]?.trim() ?? '';
if (!ref.startsWith('f_')) { process.stdout.write('sdd-pr-comment: no SDD-Ref feature trailer on HEAD; nothing to post\n'); process.exit(0); }

const url = new URL('/api/ci/pr-comment', SDD_URL);
url.search = new URLSearchParams({ app: SDD_APP, feature_id: ref }).toString();
const res = await fetch(url, { headers: { Authorization: `Bearer ${SDD_CI_TOKEN}` } }).catch((e) => die(`cannot reach ${SDD_URL}: ${e.message}`));
if (!res.ok) die(`server answered ${res.status}: ${await res.text()}`);
const { markdown } = await res.json();
const body = `${markdown.trimEnd()}\n\n[Open in the admin UI](${new URL('/admin/', SDD_URL)})\n`;

if (values['dry-run']) { process.stdout.write(body); process.exit(0); }
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) die('GITHUB_TOKEN and GITHUB_REPOSITORY must be set (or use --dry-run)');
let pr = values.pr ?? process.env.PR_NUMBER;
if (!pr && GITHUB_EVENT_PATH) { try { pr = String(JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8')).pull_request?.number ?? ''); } catch { /* not a PR event */ } }
if (!pr) { process.stdout.write('sdd-pr-comment: not running for a pull request; nothing to post\n'); process.exit(0); }

const api = (path, init = {}) => fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}${path}`, {
  ...init, headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
});
const list = await api(`/issues/${pr}/comments?per_page=100`);
if (!list.ok) die(`cannot list comments: ${list.status}`);
const existing = (await list.json()).find((c) => typeof c.body === 'string' && c.body.includes(MARKER));
const out = existing ? await api(`/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) }) : await api(`/issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
if (!out.ok) die(`GitHub answered ${out.status}: ${await out.text()}`);
process.stdout.write(`sdd-pr-comment: ${existing ? 'updated' : 'posted'} the summary on #${pr}\n`);
