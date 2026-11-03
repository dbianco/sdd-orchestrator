# Security evidence with Trivy and Opengrep

The `verify -> integrate` gate does not care which scanner you use. It reads one
object from the evidence you send:

```json
"security": { "status": "pass", "new_high": 0 }
```

- `status: "pass"`: the scanners ran. The gate then compares `new_high` with the
  track's `max_new_high` (0 by default) and blocks when it is higher.
- `status: "fail"`: a scanner crashed or could not finish. Always blocks.
- `status: "skipped"` with `skipped_reason`: no scanner ran. The gate lets the
  move through with a warning that repeats your reason; without a reason it blocks.

The reference setup uses two free scanners that need no account or token:

| Scanner | Covers | Count as "high" |
|---|---|---|
| [Trivy](https://trivy.dev) | dependency vulnerabilities, committed secrets, IaC and Dockerfile misconfiguration | severity `HIGH` and `CRITICAL` |
| [Opengrep](https://github.com/opengrep/opengrep) | static analysis of your own code | severity `ERROR` |

Snyk, Endor Labs or any other tool works the same way: count its high findings
into `new_high`. The orchestrator never runs scanners itself; it only checks the
evidence you send.

## What "new" means

A raw count of high findings fails on almost every existing repository, and neither
scanner does reachability analysis, so expect volume similar to other SCA tools.
The reference setup therefore **diffs against a committed baseline**:

- `.sdd/security-baseline.json` lists the high findings the team has accepted, as
  counts per finding key (a Trivy finding is keyed by target, advisory id and package
  version; an Opengrep finding by rule id and file, **not** by line, so unrelated edits
  that shift lines do not turn old findings into new ones).
- A finding is new when its count exceeds the baseline for its key. Fixing one
  occurrence never hides a different new one.
- The baseline is committed, so accepting risk shows up in code review.

We chose the baseline over "scan only `files_changed`" because Trivy findings live in
lockfiles and Dockerfiles that a feature rarely touches, and a changed-files scan would
miss a vulnerable dependency added by editing `package.json` indirectly.

## Commands

Scan (JSON output, high and critical only; the first Trivy run downloads its database,
so allow a few minutes and cache `~/.cache/trivy` in CI):

```bash
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL \
  --format json --output trivy.json --timeout 30m .
opengrep scan --config <rules> --json --output opengrep.json .
```

If the default Trivy database mirror times out, add
`--db-repository ghcr.io/aquasecurity/trivy-db:2`.

Turn the reports into the `security` object. This helper ships in this repository
(`scripts/sdd-security-evidence.mjs`; copy it together with `scripts/lib/`):

```bash
# once, on the main branch: accept today's findings
node scripts/sdd-security-evidence.mjs --trivy trivy.json --opengrep opengrep.json \
  --write-baseline .sdd/security-baseline.json

# on every feature: prints {"status":"pass","new_high":N} and merges it into evidence.json
node scripts/sdd-security-evidence.mjs --trivy trivy.json --opengrep opengrep.json \
  --baseline .sdd/security-baseline.json --merge evidence.json
```

It lists new findings on stderr. Without `--baseline` every high finding counts as new.
When no scanner is available, say so explicitly:

```bash
node scripts/sdd-security-evidence.mjs --skipped "Trivy is not installed in this pipeline"
```

The helper refuses to print anything when given no report and no `--skipped`, so a
missing scan can never look like a clean one.

## In CI

The step goes between your test step and `scripts/sdd-ci-evidence.mjs`; see
[`ci/github-actions.md`](ci/github-actions.md). Replace the `npm audit` step and the
`security` field of the `jq` command there with the commands above and
`--merge evidence.json`.
