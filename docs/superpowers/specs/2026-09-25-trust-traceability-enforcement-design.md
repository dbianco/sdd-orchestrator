# Trust, Traceability and Enforcement: Design Specification

**Status:** Draft for review
**Date:** 2026-09-25
**Builds on:** `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`
(whose section 11.3 security posture and host-asserted evidence this revises;
see section 15), `docs/superpowers/specs/2026-09-17-admin-ui-design.md` (the
admin UI this adds an Approvals view to) and
`docs/superpowers/specs/2026-09-18-routing-events-and-commits-design.md` (the
`commits` table CI evidence is bound to)

## 1. Summary

v1 enforces the lifecycle only for agents that choose to follow it, and it
records what the agent says happened rather than what happened:

1. **Nothing enforces the process in the editor.** The session flow in
   `docs/verification/host-integration.md` works only if the agent reads it
   and complies.
2. **The agent's word is the only proof.** `actor`, `human_approved` and the
   verify evidence (tests, lint, security, files changed) are whatever the
   calling agent sends. There is no authentication.
3. **Requirement tracing stops halfway.** `evidence.implements` is validated
   and stored, and nothing reads it.
4. **Nothing has been verified against a real host or a real embedder.** The
   feature matrix is blank, and retrieval was measured only with the fake
   provider.
5. **Context packs can miss documents a gate requires.** A phase pins one
   template, while OpenSpec, BMAD and `sdlc` specify gates require two or
   three documents.
6. **The repository has no CI**, although its own seed constitution requires
   tests to run before merge.

This change adds bearer-token identity, server-side human approvals,
CI-sourced evidence, requirement traceability from spec to evidence, several
pinned templates per phase, a Claude Code plugin that enforces the flow with
hooks, a retrieval evaluation harness, a scripted host walkthrough, and a CI
workflow for this repository.

Decisions taken before this draft, with the requester:

- Identity: tokens issued by `sdd-admin`, one per person or pipeline; the
  actor comes from the token. Evidence is tagged `ci` or `host`, and
  compliance apps and high-risk features accept only CI evidence out of
  `verify`.
- Approvals: a human approves a pending transition on the server, with
  `sdd-admin` or the admin UI, authenticated with their own token.
- Process: this spec is reviewed before a plan and code are written.
- Authentication default (after review): `SDD_AUTH_MODE` defaults to `warn`.

## 2. Goals

- Every MCP write over HTTP is attributable to an issued credential, not to a
  free-text field.
- A mandated approval is given by an authenticated person, never by the
  agent's own flag.
- For the features that matter most (compliance apps, high-risk features),
  the test, lint and security results that open the gate out of `verify`
  come from CI, bound to the latest commit of the feature.
- Every requirement identified in an accepted spec is either covered by the
  evidence or reported as uncovered, per feature and per app.
- The agent receives, in its context pack, every template the next gate
  requires.
- In Claude Code, editing code outside an active lifecycle is blocked or
  warned about by the host itself, and the local feature state is written by
  hooks from server responses, not by the agent.
- Retrieval quality and host behaviour are measured by commands anyone can
  rerun, not asserted.
- Every change to this repository is typechecked and tested before merge.

## 3. Non-goals

- OAuth, SSO or an external identity provider. Tokens are the identity
  interface; an OIDC front can issue them later.
- Per-row authorization beyond app scoping and scopes (section 4.3).
- Running tests, scans or git inside the server. CI runs them and reports.
- Forge webhooks. CI evidence arrives through an authenticated endpoint that
  the pipeline calls.
- Enforcement in Cursor or other hosts. The plugin is Claude Code only; the
  server-side controls (tokens, approvals, CI evidence) apply to every host.
- Replacing a manual pass through the real hosts. Section 10 makes it
  scripted and reproducible, but a person still runs Claude Code and Cursor
  and fills the feature matrix.
- A general per-framework graph engine, or an LLM router.

## 4. Identity and tokens

### 4.1 Tokens

`sdd-admin token create` issues a token and prints it once:

```bash
sdd-admin token create --actor daniel --scope host,approver --name "daniel laptop" [--app checkout ...] [--expires 90d]
sdd-admin token create --actor ci-checkout --scope ci --app checkout --name "checkout pipeline"
sdd-admin token list [--actor daniel]
sdd-admin token revoke tk_01j… --reason "laptop lost"
```

Format: `sdd_` followed by 32 random bytes in base64url. The server stores
only the SHA-256 of the whole string and compares hashes, so a database read
does not reveal usable tokens. `--app` restricts the token to those apps;
omitted means every app. `--expires` is optional; an expired or revoked token
is rejected exactly like an unknown one.

`sdd-admin` itself connects to the database directly and stays in the
administrator trust tier: whoever holds database credentials is an
administrator. Its writes keep `--actor`, defaulting to the OS user.

### 4.2 Transport

Over Streamable HTTP, every `/mcp` request carries
`Authorization: Bearer <token>`. An express middleware resolves the token
before the MCP server is constructed and passes an `AuthContext`
(`{ token_id, actor, scopes, app_ids } | { anonymous: true }`) into
`createMcpServer`, so every tool handler sees it. `last_used_at` is updated at
most once a minute per token.

`SDD_AUTH_MODE` selects the behaviour:

| Mode | Unauthenticated `/mcp` request | `actor` | Approvals | Evidence required from CI |
|---|---|---|---|---|
| `enforce` | HTTP 401 with `WWW-Authenticate: Bearer` before any MCP handling | From the token | Server-side (section 5) | As section 6.3 |
| `warn` (default) | Accepted; logged; every result carries a warning `unauthenticated call accepted because SDD_AUTH_MODE=warn` | From the token when present, else from the payload | Server-side | As section 6.3 |
| `off` | Accepted, as in v1 | From the payload | Host-asserted `human_approved`, as in v1 | Never |

An invalid token is a 401 in every mode except `off`, where the header is
ignored. `warn` is the default so an upgrade without tokens keeps working;
operators move to `enforce` once every host sends a token (section 14).
`off` exists for local development and tests.

Over stdio there is no token. The process belongs to the local user: `actor`
comes from the payload or `SDD_ACTOR`, evidence is always tagged `host`, and
approvals behave as `SDD_AUTH_MODE` says, with the stdio user unable to
approve (approvals need an `approver` token or the CLI).

### 4.3 Scopes and app restriction

| Scope | Grants |
|---|---|
| `host` | Every MCP tool, resource and prompt |
| `ci` | `POST /api/ci/evidence` only |
| `approver` | Reading the admin API and UI; approving and rejecting approval requests |
| `admin` | Everything `approver` grants; reserved for future admin writes over HTTP |

A token without the scope a call needs, or restricted to apps that do not
include the call's app, gets the new domain error `FORBIDDEN`. For tools
addressed by `feature_id`, the app is the feature's. For `search_memory` and
`get_context` with a `scope` list or `company`, every named app must be
allowed; `company` needs an unrestricted token.

### 4.4 `actor` in tool inputs

`actor` becomes optional in every tool schema. When a token is present, its
actor is recorded and a different payload `actor` produces the warning
`actor "<payload>" ignored; the token belongs to "<token actor>"`. Without a
token (`warn`, `off`, stdio), the payload `actor` is required as today.

### 4.5 Admin UI login

The admin UI keeps HTTP Basic, with the password field now accepting a
personal token that has `approver` or `admin` scope; the username is
ignored. `SDD_ADMIN_TOKEN`, when set, still logs in, but read-only: approving
needs a personal token so every decision names a person.

## 5. Server-side approvals

### 5.1 Which transitions

Unchanged from v1: the first forward move out of `specify` (or out of
`verify` when the track declares `spec_review: deferred`), the move out of
`verify` when the feature is high-risk, and any transition whose gate lists
`human_approved`. When `SDD_AUTH_MODE` is `enforce` or `warn`, these are
approved on the server; the `human_approved` input is ignored with the warning
`human_approved is ignored; approval is requested from a person on the server`.

### 5.2 Requesting approval

`advance_phase` for such a move runs every check except `human_approved`:

- Any blocker: the result is `fail` as today; no approval is requested.
- No blocker: the server records the transition with the new result
  `awaiting_approval`, stores its artifacts as today, creates an approval
  request, and returns:

```json
{
  "result": "awaiting_approval",
  "approval_id": "ap_01j…",
  "findings": [],
  "next_instructions": "The move specify -> implement for f_01j… passed its checks and waits for a person. Ask a reviewer to approve ap_01j… in the admin UI (Approvals) or with `sdd-admin approvals approve ap_01j…`. Poll get_feature_status; do not start implement until current_phase is implement.",
  "feature": { "…": "…", "pending_approval": { "approval_id": "ap_01j…", "from": "specify", "to": "implement", "requested_by": "daniel", "requested_at": "…" } }
}
```

`dry_run` never creates a request; it reports `result: "awaiting_approval"`
when the only thing missing is the approval.

At most one request is pending per feature. A new forward `advance_phase` for
the same move while one is pending marks the old one `superseded` and creates
a new one, because the artifacts under review have changed. A backward move
supersedes the pending request.

### 5.3 Deciding

```bash
sdd-admin approvals list [--app checkout]
sdd-admin approvals show ap_01j…          # artifacts, findings, evidence, requester
sdd-admin approvals approve ap_01j… [--comment "…"]
sdd-admin approvals reject ap_01j… --reason "acceptance criteria 3 and 4 contradict"
```

and the equivalent `POST /admin/api/approvals/:id/approve` and `/reject`,
which need a token with `approver` scope for the feature's app.

Approving, in one transaction with the feature row locked: the request must
be `pending` (else `APPROVAL_NOT_PENDING`, carrying its status), the feature
must not be archived and must still be in the request's `from` phase (else
`STALE_STATE`). The server inserts a `pass` transition referencing the
approval, with `human_approved: true` and `approved_by` set to the approver,
moves the feature, and marks the request `approved`. Checks are not rerun:
they ran on exactly the artifacts and evidence the reviewer saw.

Rejecting inserts a `fail` transition with the finding
`{check: "human_approved", severity: "blocker", message: "rejected by <actor>: <reason>"}`
and marks the request `rejected`. The feature stays in its phase.

### 5.4 Distinct approver

Policy JSON gains `approval: { distinct_approver: boolean }`, default
`false`. The engine forces it to `true` for apps under compliance and for
high-risk features. When it applies, an approver whose actor equals the
requester's gets `FORBIDDEN` with `approver must differ from requester`. The
requester is the actor of the `awaiting_approval` transition.

### 5.5 Admin UI

A sixth tab, **Approvals**: pending requests with app, feature, move,
requester and age; a detail view showing each submitted artifact, the
findings (warnings only, since blockers never reach this state), the
evidence with its per-field source (section 6.4) and, for spec reviews, the
requirement list extracted so far (section 7); Approve and Reject buttons,
Reject requiring a reason. The tab is visible to every login; the buttons
are enabled only for tokens with `approver` or `admin` scope.

### 5.6 Hosts

`get_feature_status` and every returned `feature` state gain
`pending_approval` (null when none). After approval the host sees the new
`current_phase` and calls `get_context` for the phase's pack and
instructions. The plugin (section 9) surfaces the pending state in each
session.

## 6. CI-sourced evidence

### 6.1 Endpoint

`POST /api/ci/evidence`, `Authorization: Bearer <ci-scoped token>`:

```json
{
  "app": "checkout",
  "feature_id": "f_01j…",
  "commit_sha": "3f9c2a1…",
  "branch": "feature/orders-csv-export",
  "run_url": "https://github.com/acme/checkout/actions/runs/123",
  "evidence": {
    "tests": { "command": "npm test", "passed": 48, "failed": 0 },
    "lint": "pass",
    "security": { "status": "pass", "new_high": 0 },
    "files_changed": ["src/orders/export.ts", "src/orders/export.test.ts"],
    "existing_tests_modified": 0
  }
}
```

`evidence` uses `VerifyEvidenceSchema` with every field optional; CI sends
what it measured. The server stores a `ci_evidence` row and upserts the
commit into `commits` with `source = 'ci'` anchored to the feature, so the
commit exists even when the host never called `record_commit`. The response
is `{ ci_evidence_id, commit_id }`. Errors use the admin API conventions:
400 for schema violations, 403 for scope or app, 404 for an unknown feature
or app.

### 6.2 Finding the feature in CI

Hosts already add an `SDD-Ref: <feature_id>` trailer to commits (routing
events spec, section 5.4). The shipped script reads it from `HEAD`:

```bash
node scripts/sdd-ci-evidence.mjs --evidence evidence.json --run-url "$RUN_URL"
# SDD_URL, SDD_CI_TOKEN and SDD_APP come from the environment;
# feature_id from `git log -1 --format='%(trailers:key=SDD-Ref,valueonly)'`,
# commit_sha from `git rev-parse HEAD`; --feature overrides the trailer.
```

The script has no dependencies beyond Node 22. The pipeline produces
`evidence.json` from its own test, lint and scan steps;
`docs/ci/github-actions.md` shows a complete job for an npm project. A commit
without a trailer and no `--feature` exits 0 with a notice, so pipelines
running on unrelated branches do not fail.

### 6.3 When CI evidence is required

`requires_ci_evidence(feature)` is true when the app is under compliance,
the feature is high-risk, or the app policy sets `evidence: "ci"`. The policy
may also set `evidence: "host"` to opt a non-compliance app out of the
high-risk default; compliance cannot be opted out.

When required, `verify_evidence` out of `verify` uses the latest
`ci_evidence` row for the feature created after the feature last entered
`verify`, and adds blockers when:

- there is none: `CI evidence required: none recorded since the feature entered verify`;
- its `commit_sha` is not the feature's latest commit (by `committed_at`,
  then `created_at`, across host- and CI-reported commits):
  `CI evidence is for 3f9c2a1 but the latest commit of the feature is 8e21b07`.

### 6.4 Merging CI and host evidence

For each evidence field, the CI value wins when the CI row has it; otherwise
the host value is used, except that when CI evidence is required the fields
`tests`, `lint` and `security` must come from CI. `implements` and
`characterization_tests` normally come from the host, which knows which
requirements it worked on. The transition stores the merged evidence plus
`evidence_sources`, a map from field to `ci` or `host`, and the
`ci_evidence_id` it used. When CI evidence is not required but present, it
is still preferred, so a pipeline improves the record for every feature.

## 7. Requirement traceability

### 7.1 Capturing requirements at the spec gate

A new gate check, `requirement_ids`, runs at the gate that accepts the spec:

| Param | Meaning |
|---|---|
| `artifact` | The spec artifact, e.g. `spec.md` |
| `id_regex` | Regular expression with a named group `id`, applied per line (multiline) |
| `min` | Minimum number of requirements, default 1 |

It reports a blocker when fewer than `min` ids are found and one for each
duplicate id. When the forward transition passes (including through an
approval, section 5.3), the server replaces the feature's
`feature_requirements` with the ids found, their line numbers and the
transition id. A later backward move and a new pass replace them again, so
the set always matches the last accepted spec.

Seed pack parameters, matching the shipped templates:

| Framework / track | Artifact | `id_regex` |
|---|---|---|
| spec-kit `default` | `spec.md` | `\*\*(?<id>FR-\d{3})\*\*` |
| openspec `default` | `spec.md` | `^###\s+Requirement:\s+(?<id>.+?)\s*$` |
| bmad `full` | `prd.md` | `\*\*(?<id>N?FR\d+)\*\*` |
| sdlc `default` | `prd.md` | `\*\*(?<id>R\d+)\*\*` |
| kiro `default` | `requirements.md` | `^###\s+Requirement\s+(?<id>\d+)\s*$` |

Refactor and hotfix tracks have no functional requirements by design and do
not declare the check; bmad `quick` keeps its `(AC: n)` task links, which
`task_done_checks` already enforces.

### 7.2 Checking coverage at the verify gate

A second check, `requirement_coverage` (no params), runs out of `verify`.
The gate library's `CheckInput` gains `requirements: string[]`, loaded by
the service from `feature_requirements`, so checks stay pure. Ids match after
trimming and case-folding. Each captured requirement missing from the merged
evidence's `implements` is a finding; each id in `implements` that is not a
captured requirement is a `warning`. A feature with no captured requirements
(specified before this change) gets one warning and no blockers.

Severity in the seed packs: `blocker` for spec-kit, bmad `full`, sdlc and
kiro, whose ids are short codes; `warning` for openspec, whose ids are
requirement names and are easy to paraphrase.

### 7.3 Exposure

- `get_feature_status` gains `requirements: [{ id, covered: true | false | null }]`,
  `null` until the feature has passed `verify`.
- A resource `sdd://apps/{slug}/rtm` and `sdd-admin export rtm <app> [--format csv|json]`
  return one row per feature and requirement: app, feature id and slug,
  `external_ref`, requirement id, coverage, files changed, test totals,
  evidence source, approver of the spec and of the verify move, archived at.
- `GET /admin/api/apps/:app/rtm` feeds a Requirements section in the admin
  UI's feature detail and a per-app table.

## 8. Several templates per phase

A phase mapping gains `templates`, an ordered list of template ids;
`template` stays accepted as shorthand for a one-item list, and ingestion
rejects a phase that declares both. The assembler pins every listed template
into position 3 in order, each under a heading with its title. The existing
ingestion warning for large templates applies to their combined size, and a
pack whose pinned templates alone exceed the default budget gets the
existing `over_budget` behaviour at assembly.

Seed packs change to:

| Framework / track | Phase | `templates` |
|---|---|---|
| openspec `default` | specify | proposal, spec, tasks |
| openspec `refactor` | specify | refactor-proposal, spec |
| bmad `full` | specify | prd, architecture |
| sdlc `default` | specify | prd, scoping |

The "One template is pinned per phase" limitation leaves the host
integration guide.

## 9. Enforcement in Claude Code: the `sdd` plugin

### 9.1 Packaging

The repository ships a plugin in `hosts/claude-code/` and a marketplace
manifest at the repository root, so a team installs it with
`/plugin marketplace add dbianco/sdd-orchestrator` and
`/plugin install sdd`. The plugin contains:

- the MCP server entry for `sdd` in the plugin manifest's `mcpServers`,
  with the URL and token taken from plugin `userConfig` (exported to hooks as
  `CLAUDE_PLUGIN_OPTION_*`) and sent as `Authorization: Bearer <token>`.
  Claude Code names a plugin-bundled server's tools
  `mcp__plugin_sdd_sdd__<tool>`, and a workspace that configures the server
  itself sees `mcp__sdd__<tool>`; every matcher below accepts both
  (`mcp__(plugin_sdd_)?sdd__…`);
- hooks (9.2), written as dependency-free Node scripts;
- a skill with the session flow of the host integration guide, so the agent
  has the procedure without the guide in context;
- commands `/sdd:status` (active feature, phase, pending approval,
  uncovered requirements) and `/sdd:route` (route the current task with
  workspace facts from `docs/verification/workspace-facts.sh`).

The workspace keeps `.sdd/config.json` (committed: app slug, greenfield flag,
enforcement mode) and `.sdd/state.json` (git-ignored, per branch: routing id,
feature id, phase, status, pending approval, updated at). `state.json`
replaces the guide's `feature.json`, and it is written only by hooks.

### 9.2 Hooks

| Event | Matcher | Behaviour |
|---|---|---|
| SessionStart | — | If `.sdd/config.json` exists, inject the active feature, its phase and alias, any pending approval, and the rule "route before editing code" as context. No config: do nothing |
| PostToolUse | the `sdd` server's `route_task`, `start_feature`, `advance_phase`, `get_feature_status`, `get_context` | Write `.sdd/state.json` from the tool's result: routing id and `lite` from `route_task`; feature id, phase, status and pending approval from the rest. See 9.5 for how the hook obtains the result |
| PreToolUse | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | Decide from `state.json` and the target path (9.3); deny with a reason telling the agent which tool to call next, or allow |
| PreToolUse | `Bash` | Deny commands that write into `.sdd/`; apply 9.3 to plain redirections (`>`, `>>`, `tee`) whose target is a file path |
| PostToolUse | `Bash` whose command contains `git commit` | Read `git rev-parse HEAD` and inject: call `record_commit` with that sha and the routing or feature id from `state.json`, and use the `SDD-Ref` trailer next time if it was missing |

### 9.3 Edit rules

`.sdd/config.json` sets `enforcement: "block" | "warn" | "off"`, default
`block`. In `warn`, a denial becomes context for the agent instead of a
refusal.

| State | Allowed paths |
|---|---|
| No routing and no feature on this branch | Only files under the spec libraries (`openspec/`, `specs/`, `.specify/`, `_bmad-output/`, `.kiro/specs/`, `.sdlc/`) and Markdown under `docs/` |
| Lite routing recorded (`trivial`) | Everything |
| Spike routing recorded | Everything; the spike guidance says the code is disposable |
| Feature in `specify`, `plan` or `tasks` | Spec library paths and `docs/` Markdown |
| Feature in `implement` or `verify` | Everything |
| Feature in `integrate` or `learn` | Everything |
| Feature `blocked`, or a pending approval | Spec library paths and `docs/` Markdown |
| Anywhere | `.sdd/` is never editable by the agent |

### 9.4 What the plugin does not guarantee

Hooks bind the agent, not people: a developer editing in another tool is
unaffected, and the server-side controls (sections 4 to 7) are what hold
for every host. Shell commands can write files in ways the Bash rule does
not recognise (scripts, `sed -i`, package managers); the rule catches the
common redirections and is a guardrail, not a sandbox. `state.json` is a
cache of server state; when it disagrees with the server, `STALE_STATE`
tells the agent and the next PostToolUse corrects it.

### 9.5 Risk: the tool result in PostToolUse

Blocking uses PreToolUse with `hookSpecificOutput.permissionDecision: "deny"`
and a `permissionDecisionReason`, which Claude Code shows to the agent;
context uses `hookSpecificOutput.additionalContext`; a Bash hook sees
`tool_input.command` but not the command's output, so the commit hook reads
`git rev-parse HEAD` itself. These are documented. What is not clearly
documented is whether a PostToolUse hook receives the MCP tool's result
(`tool_response`). The first task of build step 7 checks this against the
installed Claude Code version. If the result is not available, the fallback
is a read-only, `host`-scoped endpoint, `GET /api/host/state?app=&branch=&external_ref=`,
returning the same state for the caller's most recent routing event or
feature matching the branch or ticket, which the hook calls with the
plugin's token. That path also needs `route_task` to accept an optional
`branch`, stored on the routing event, since routing events record no branch
today. The plan fixes one of the two paths before step 7 starts.

## 10. Verification

### 10.1 Retrieval evaluation

`sdd-admin eval <cases.yaml> [--app checkout] [--min-recall 0.8]` runs each
case's query through the same retrieval as `get_context` (scope, filters,
similarity floor) and reports, per case and overall, recall@8 and the mean
reciprocal rank of the expected `stable_id`s. It exits non-zero below the
thresholds, so it can gate a `reindex`, a chunking change or a model switch.
Cases:

```yaml
- query: "ADDED Requirements delta spec scenario WHEN THEN"
  phase: specify
  framework: openspec
  expect: [openspec.template.spec]
- query: "Add CSV export to the orders page"
  app: checkout
  phase: implement
  framework: openspec
  expect: [quality.tdd]
```

`packs/evals/seed.yaml` covers the seed packs. The fake provider cannot give
meaningful numbers (feature matrix note), so CI runs the harness with the
fake provider only to prove it works, and runs the seed cases against Voyage
when a `VOYAGE_API_KEY` secret is configured.

### 10.2 Scripted host walkthrough

`docs/verification/walkthrough.mjs` drives a running server through the
documented session flow with the MCP SDK client over Streamable HTTP and a
`host`-scoped token: route, start, gate failure, fix, awaiting approval,
approve with an `approver` token through the admin API, implement, CI
evidence through `POST /api/ci/evidence`, verify with requirement coverage,
integrate, archive. It prints one line per feature-matrix row with pass or
fail. It verifies the server's contract as any host would see it; the rows
for Claude Code and Cursor still require a person, and the matrix gains a
"Scripted" column so the two kinds of verification are not confused.

## 11. Continuous integration for this repository

`.github/workflows/ci.yml`, on pull requests and pushes to `main`:

| Job | Steps |
|---|---|
| `check` | Node 22, `npm ci`, `npm run typecheck`, `npm run test:unit` |
| `integration` | Service container `pgvector/pgvector:pg16`, `SDD_TEST_DATABASE_URL` pointing at it, `npm run test:integration`, `npm run test:contract` |
| `admin-ui` | `npm --prefix admin-ui ci`, `npm run test:admin-ui`, `npm run build:admin-ui` |
| `plugin` | Unit tests for the hook scripts against fixture stdin payloads |
| `eval` | `sdd-admin eval packs/evals/seed.yaml` with the fake provider; against Voyage only when the secret exists |
| `image` | `docker build .` |

Branch protection requiring these jobs is a repository setting and is left
to the repository owner.

## 12. Data model

One migration, `…_trust_traceability_enforcement.js`:

| Change | Detail |
|---|---|
| New `api_tokens` | `id` (`tk_`), `actor`, `name`, `scopes text[]` (`CHECK` subset of `host`, `ci`, `approver`, `admin`), `app_ids text[] null`, `token_hash text UNIQUE`, `expires_at null`, `revoked_at null`, `revoked_reason null`, `last_used_at null`, audit columns |
| New `approval_requests` | `id` (`ap_`), `feature_id`, `transition_id` (the `awaiting_approval` row), `from_phase`, `to_phase`, `status` (`pending`, `approved`, `rejected`, `superseded`), `requested_by`, `decided_by null`, `decided_at null`, `comment null`, audit; partial unique index on `feature_id` where `status = 'pending'` |
| New `ci_evidence` | `id` (`ce_`), `app_id`, `feature_id`, `commit_sha`, `branch null`, `run_url null`, `evidence jsonb`, `token_id`, audit |
| New `feature_requirements` | `feature_id`, `req_id`, `artifact`, `line int`, `transition_id`, audit; unique on (`feature_id`, `req_id`) |
| `phase_transitions` | `result` `CHECK` adds `awaiting_approval`; new nullable `approval_id`, `approved_by`, `ci_evidence_id`, `evidence_sources jsonb`, `token_id` |
| `commits` | `source` `CHECK` adds `ci` |
| Every table with `created_by` | Unchanged; `created_by` is the token's actor when there is one |

## 13. Configuration and errors

New environment variable `SDD_AUTH_MODE` (`enforce`, `warn`, `off`; default
`warn`). `SDD_ADMIN_TOKEN` keeps working, now read-only (section 4.5).
`docker-compose.yml` and `.env.example` set `SDD_AUTH_MODE=warn` explicitly,
with a comment recommending `enforce` once tokens are issued, and document
how to create the first token.

New error codes, placed in `ERROR_PRECEDENCE` right after
`VALIDATION_ERROR`: `FORBIDDEN` (scope, app restriction, distinct approver),
then after `FEATURE_NOT_FOUND`: `APPROVAL_NOT_FOUND`, `APPROVAL_NOT_PENDING`.
An unauthenticated or invalid token is an HTTP 401, never a tool result,
because it is decided before the MCP layer.

Metrics: `sdd_approvals_total{decision}`, `sdd_approval_wait_seconds`
(histogram from request to decision), `sdd_ci_evidence_total{app}`,
`sdd_requirements_uncovered_total`, `sdd_auth_rejections_total{reason}`.

## 14. Rollout

1. Deploy. `SDD_AUTH_MODE` defaults to `warn`, so unauthenticated calls keep
   working with a warning. One behaviour changes on upgrade: mandated
   approvals now wait for a person (section 5), so before deploying, make
   sure at least one reviewer per app has an `approver` token or CLI access.
   Operators who need the v1 flag for a while can set `SDD_AUTH_MODE=off`.
2. Create tokens for each developer (`host,approver`) and each pipeline
   (`ci`), and add the `Authorization` header to hosts' MCP configuration or
   install the plugin.
3. Re-ingest the seed packs, whose versions move to `1.1.0` because gates
   and templates change. Features in flight stay pinned to `1.0.0` and keep
   their gates; new features get requirement capture and several templates.
4. Switch to `SDD_AUTH_MODE=enforce` once the `sdd_auth_rejections_total`
   rate in `warn` (which counts would-be rejections) is zero.
5. Add the CI evidence step to pipelines of compliance apps first, since they
   are the ones that will block without it.

Transitions awaiting approval never exist before this change, so no
backfill is needed. Features with no captured requirements get a warning at
verify (section 7.2), not a blocker.

## 15. Deviations from the v1 design

- Section 11.3 of the v1 spec says there is no authentication and `actor` is
  attribution only. With `SDD_AUTH_MODE=enforce`, `/mcp` requires a token and
  `actor` comes from it. The default, `warn`, accepts unauthenticated calls
  with a warning, and uses the token's actor whenever a token is sent.
- Sections 8.3 and 10.4 say `human_approved` and verify evidence are host
  assertions the server records and never checks. With authentication on,
  mandated approvals come from a person on the server, and for compliance
  apps and high-risk features the tests, lint and security results come from
  CI bound to the latest commit.
- Section 10.2 says checks see only the artifacts submitted in the same call.
  `requirement_coverage` also sees the requirements captured at the spec gate,
  loaded by the service and passed in, so checks remain pure functions.
- Section 9.1 pins one template per phase. Phases may now pin several.

## 16. Build order

Each step is independently shippable and has its own tests; the plan will
follow this order.

1. CI workflow (section 11), so every later step is checked.
2. Several templates per phase (section 8).
3. Requirement capture and coverage (section 7).
4. Tokens, auth modes and `FORBIDDEN` (section 4).
5. Server-side approvals and the Approvals tab (section 5).
6. CI evidence endpoint, script and merge rules (section 6).
7. Claude Code plugin (section 9).
8. Retrieval evaluation and scripted walkthrough (section 10); feature
   matrix gains the Scripted column.

## 17. Alternatives considered

- **Pull request reviews as approvals** (GitHub webhook). Closer to existing
  habits, but it needs a forge integration, a webhook secret and a mapping
  from pull requests to features, and it arrives after implementation, which
  is too late for spec review. Rejected for now; an approval request could
  later be decided by a webhook through the same endpoint.
- **Signed evidence from the host** (the agent signs with a key). Proves who
  sent the evidence, not that tests ran. CI is the party that actually runs
  them.
- **The server running tests or reading git.** Contradicts the v1 boundary
  that the server never touches repositories, and would need build
  environments per stack.
- **Requirement ids from a structured spec format** (YAML front matter
  listing requirements). Cleaner to parse, but every framework's native
  Markdown would need changing; a per-track regex works with the shipped
  templates as they are.
- **Enforcement through the MCP server alone** (refusing tool calls out of
  order). The server cannot see file edits; only the host can stop them.
- **Mutual TLS instead of bearer tokens.** Stronger binding, but certificate
  distribution to laptops and CI runners is heavier than the threat model
  (a trusted network with accountability needs) requires.

## 18. Open questions for review

1. ~~Default `SDD_AUTH_MODE`~~ Resolved 2026-09-25: the default is `warn`.
2. Distinct approver is forced for compliance apps and high-risk features. Is
   self-approval acceptable everywhere else, or should it be a company-wide
   policy?
3. CI evidence is required for compliance apps and high-risk features by
   default. Should `evidence: "ci"` be the default for every app instead,
   once pipelines are wired?
4. OpenSpec coverage is a warning because its ids are requirement names.
   Should OpenSpec specs adopt short ids (`REQ-1`) in the template so
   coverage can block there too?
5. The plugin defaults to `enforcement: "block"`. Should teams start with
   `warn` during rollout?
