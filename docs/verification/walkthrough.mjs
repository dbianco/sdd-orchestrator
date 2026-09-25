#!/usr/bin/env node
// Scripted walkthrough of the host contract against a running server (spec 2026-09-25 section 10.2).
// Run from the repository root:
//   node docs/verification/walkthrough.mjs --url http://localhost:8080 --host-token sdd_... --approver-token sdd_... --ci-token sdd_... [--app checkout]
// The server must be seeded with packs/ and run with SDD_AUTH_MODE=warn or enforce.
// Prints one tab-separated line per feature-matrix row: <row> <pass|fail> <detail>; exits 1 if any row fails.
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const { values: o } = parseArgs({ options: {
  url: { type: 'string' }, 'host-token': { type: 'string' }, 'approver-token': { type: 'string' }, 'ci-token': { type: 'string' }, app: { type: 'string', default: 'checkout' },
} });
for (const k of ['url', 'host-token', 'approver-token', 'ci-token']) if (!o[k]) { process.stderr.write(`--${k} is required\n`); process.exit(2); }

const run = Date.now().toString(36);
const ticket = `WALK-${run}`.toUpperCase();
const sha = (n) => (run + n.toString(16)).replace(/[^0-9a-f]/g, 'a').padEnd(12, '0').slice(0, 12);
let failed = false;
function row(name, ok, detail = '') { if (!ok) failed = true; process.stdout.write(`${name}\t${ok ? 'pass' : 'fail'}\t${detail}\n`); }

const proposal = '## Why\nExports are manual.\n\n## What Changes\n- Add a CSV export button.\n\n## Impact\nOrders page only.\n';
const spec = '## ADDED Requirements\n\n### Requirement: CSV export\n\nThe system SHALL export up to 10000 rows within 2 s.\n\n#### Scenario: export\n\n- **WHEN** the user clicks export\n- **THEN** a CSV downloads\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n';
const tasks = '## Tasks\n\n- [ ] 1. Add endpoint\n- [ ] 2. Add button\n';

const client = new Client({ name: 'sdd-walkthrough', version: '1.0.0' });
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
  return r.structuredContent;
};
const http = async (path, token, init = {}) => {
  const res = await fetch(new URL(path, o.url), { ...init, headers: { 'Content-Type': 'application/json', Authorization: token, ...init.headers } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const basic = (t) => `Basic ${Buffer.from(`walkthrough:${t}`).toString('base64')}`;

try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', o.url), { requestInit: { headers: { Authorization: `Bearer ${o['host-token']}` } } }));
  row('Streamable HTTP connection', true, 'authenticated with a host token');

  const routed = await call('route_task', { task_description: `Add CSV export to the orders page (${run})`, app: o.app, external_ref: ticket,
    workspace: { stack: ['typescript', 'react'], is_greenfield: false, has_spec_library: true, estimated_files: 4, paths_touched: ['src/orders/'], host: 'walkthrough' } });
  row('Tool: route_task', routed.decision.framework === 'openspec' && !!routed.routing_id, `${routed.decision.framework}/${routed.decision.track} by rule ${routed.decision.rule}`);

  const started = await call('start_feature', { app: o.app, task_description: `Add CSV export to the orders page (${run})`, decision: routed.decision, routing_id: routed.routing_id, external_ref: ticket });
  const pinsAll = ['proposal', 'delta spec', 'tasks'].every((t) => started.context_pack.toLowerCase().includes(t));
  row('Tool: start_feature', !!started.feature_id && pinsAll, `feature ${started.feature_id}; pack pins proposal, spec and tasks templates: ${pinsAll}`);
  const fid = started.feature_id;

  const failing = await call('advance_phase', { feature_id: fid, expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal.replace('Orders page only.', 'TBD'), 'spec.md': spec, 'tasks.md': tasks } });
  row('Tool: advance_phase', failing.result === 'fail' && failing.findings.some((f) => f.check === 'placeholder_scan'), 'gate failure is a normal result');

  const awaiting = await call('advance_phase', { feature_id: fid, expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal, 'spec.md': spec, 'tasks.md': tasks } });
  row('`awaiting_approval` shown and followed by the agent', awaiting.result === 'awaiting_approval' && !!awaiting.approval_id,
    awaiting.result === 'awaiting_approval' ? `approval ${awaiting.approval_id}` : `got ${awaiting.result}; is SDD_AUTH_MODE off?`);

  if (awaiting.approval_id) {
    const approved = await http(`/admin/api/approvals/${awaiting.approval_id}/approve`, basic(o['approver-token']), { method: 'POST', body: JSON.stringify({ comment: 'walkthrough' }) });
    row('Approval decided in the admin UI Approvals tab', approved.status === 200 && approved.body?.feature?.current_phase === 'implement', `admin API answered ${approved.status}`);
  }

  const status = await call('get_feature_status', { feature_id: fid });
  row('Tool: get_feature_status', status.current_phase === 'implement' && status.requirements.some((r) => r.id === 'CSV export'), `phase ${status.current_phase}; requirements ${status.requirements.map((r) => r.id).join(', ')}`);

  const commit = await call('record_commit', { app: o.app, sha: sha(1), message: `feat: csv export\n\nSDD-Ref: ${fid}`, files_changed: ['src/orders/export.ts'], feature_id: fid });
  const again = await call('record_commit', { app: o.app, sha: sha(1), message: `feat: csv export\n\nSDD-Ref: ${fid}`, feature_id: fid });
  row('Tool: record_commit', commit.deduplicated === false && again.deduplicated === true, `commit ${commit.commit_id}`);

  const toVerify = await call('advance_phase', { feature_id: fid, expected_phase: 'implement', target_phase: 'verify' });
  const ci = await http('/api/ci/evidence', `Bearer ${o['ci-token']}`, { method: 'POST', body: JSON.stringify({ app: o.app, feature_id: fid, commit_sha: sha(1),
    evidence: { tests: { command: 'npm test', passed: 12, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/orders/export.ts'] } }) });
  row('CI evidence posted by `scripts/sdd-ci-evidence.mjs`', toVerify.result === 'pass' && ci.status === 201, `POST /api/ci/evidence answered ${ci.status} (same request the script sends)`);

  const verified = await call('advance_phase', { feature_id: fid, expected_phase: 'verify', target_phase: 'integrate', evidence: { tests: { command: 'npm test', passed: 1, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, implements: ['CSV export'] } });
  const covered = (await call('get_feature_status', { feature_id: fid })).requirements.every((r) => r.covered === true);
  row('Requirement coverage out of verify', verified.result === 'pass' && covered, `result ${verified.result}; all requirements covered: ${covered}`);

  const archived = await call('advance_phase', { feature_id: fid, expected_phase: 'integrate', target_phase: 'archived' });
  const ctx = await call('get_context', { feature_id: fid });
  row('Tool: get_context', archived.feature.status === 'archived' && ctx.context_pack.includes(fid), 'works on archived features');

  const listed = await call('list_features', { app: o.app, external_ref: ticket, status: ['archived'] });
  row('Tool: list_features', listed.features.some((f) => f.feature_id === fid), `${listed.features.length} feature(s) for ${ticket}`);

  const found = await call('search_memory', { query: 'test-driven development', app: o.app, scope: 'company' });
  row('Tool: search_memory', Array.isArray(found.chunks), `${found.chunks.length} chunk(s), degraded ${found.degraded}`);

  const rtm = JSON.parse((await client.readResource({ uri: `sdd://apps/${o.app}/rtm` })).contents[0].text);
  row('Resource: sdd://apps/{slug}/rtm', rtm.rows.some((r) => r.feature_id === fid && r.covered === true && r.evidence_source === 'ci'), 'requirement covered, tests from CI');
} catch (e) {
  row('walkthrough', false, e instanceof Error ? e.message : String(e));
} finally {
  await client.close().catch(() => undefined);
}
process.exit(failed ? 1 : 0);
