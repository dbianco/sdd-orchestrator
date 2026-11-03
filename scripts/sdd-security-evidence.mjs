#!/usr/bin/env node
// Prints the `security` evidence object from Trivy and/or Opengrep JSON reports.
// Usage: node scripts/sdd-security-evidence.mjs [--trivy trivy.json] [--opengrep opengrep.json]
//          [--baseline .sdd/security-baseline.json] [--write-baseline <file>] [--skipped "<reason>"] [--merge evidence.json]
// See docs/security-evidence.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildSecurity, makeBaseline, opengrepHigh, trivyHigh } from './lib/securityEvidence.mjs';

const die = (m) => { process.stderr.write(`sdd-security-evidence: ${m}\n`); process.exit(1); };
const readJson = (file, what) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return die(`cannot read ${what} ${file}: ${e.message}`); } };

const { values } = parseArgs({
  options: { trivy: { type: 'string' }, opengrep: { type: 'string' }, baseline: { type: 'string' }, 'write-baseline': { type: 'string' }, skipped: { type: 'string' }, merge: { type: 'string' } },
});

const trivy = values.trivy ? readJson(values.trivy, 'Trivy report') : undefined;
const opengrep = values.opengrep ? readJson(values.opengrep, 'Opengrep report') : undefined;
let baseline = null;
if (values.baseline) {
  try { baseline = JSON.parse(readFileSync(values.baseline, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') die(`cannot read baseline ${values.baseline}: ${e.message}`);
    process.stderr.write(`sdd-security-evidence: no baseline at ${values.baseline}; every high finding counts as new\n`);
  }
}

if (values['write-baseline']) {
  if (!trivy && !opengrep) die('--write-baseline needs --trivy and/or --opengrep');
  const all = [...(trivy ? trivyHigh(trivy) : []), ...(opengrep ? opengrepHigh(opengrep) : [])];
  writeFileSync(values['write-baseline'], `${JSON.stringify(makeBaseline(all), null, 2)}\n`);
  process.stderr.write(`sdd-security-evidence: wrote a baseline of ${all.length} high finding(s) to ${values['write-baseline']}; commit it so reviewers see accepted risk\n`);
}

let result;
try { result = buildSecurity({ trivy, opengrep, baseline: values['write-baseline'] ? makeBaseline([...(trivy ? trivyHigh(trivy) : []), ...(opengrep ? opengrepHigh(opengrep) : [])]) : baseline, skipped: values.skipped }); } catch (e) { die(e.message); }

process.stderr.write(`sdd-security-evidence: ${result.high} high finding(s), ${result.baselined} accepted by the baseline, ${result.newFindings.length} new\n`);
for (const f of result.newFindings.slice(0, 20)) process.stderr.write(`  new: ${f.text}\n`);
if (result.newFindings.length > 20) process.stderr.write(`  ... and ${result.newFindings.length - 20} more\n`);

if (values.merge) {
  const evidence = readJson(values.merge, 'evidence file');
  evidence.security = result.security;
  writeFileSync(values.merge, `${JSON.stringify(evidence, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result.security)}\n`);
