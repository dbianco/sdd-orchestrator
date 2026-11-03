# SDD Orchestrator

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server
that gives coding agents the right spec-driven-development (SDD) context at the
right moment, and gives people a console to see whether the process works.

For each task it:

- **routes** the task to the best-fitting SDD framework (OpenSpec, GitHub Spec
  Kit, BMAD, Kiro, or the house `sdlc` flow) using explainable rules;
- **keeps lifecycle state** per feature and runs deterministic gate checks
  between phases, so gates are enforced rather than advisory;
- **assembles a context pack** per phase from a company-wide knowledge base,
  with app-scoped memory (ADRs, accepted specs, decisions) and explicit
  cross-app lookup;
- **records everything** (routing, transitions, evidence, approvals, commits)
  so an admin UI, reports and pull-request comments can show what happened and
  whether the process is paying off.

The host agent (Claude Code, Cursor, or any MCP client) remains the only thing
that edits files, runs tests or spawns sub-agents. The server reads and writes
only its own database.

## Why

Coding agents tend to follow whatever process was in the prompt last, forget
why a past decision was made once the conversation that made it is gone, and
start writing code before checking whether a spec is actually complete. None
of that is a model problem; it is a missing place to keep process state
outside the agent's own context window. This server is that place: one
explainable choice of framework per task, phase gates that block on the
artifact's own text rather than on trust, and a knowledge base that survives
across sessions, branches and hosts.

## Use cases

- **Brownfield feature work.** "Add CSV export to the orders page" against a
  service with an existing `openspec/` directory routes to OpenSpec's
  `default` track: a proposal and delta spec gated on measurable acceptance
  criteria before `implement` starts.
- **Production incidents.** A hotfix routes to OpenSpec's `hotfix` track,
  which defers spec review until after the fix ships and adds a mandatory
  `learn` phase whose gate requires an `Incident Memory Proposal` section, so
  the agent has to write up the incident before the feature can archive.
- **Compliance-sensitive paths.** An app's policy can pin a framework by path
  glob (`**/payments/**` → BMAD) regardless of what `route_task` would
  otherwise pick; overriding that pin needs an explicit
  `policy_override_reason` recorded on `start_feature`.
- **Greenfield services.** A repository with no spec library and fewer than
  20 commits routes to Spec Kit's `default` track — the full seven-phase
  lifecycle from `specify` through `learn`.
- **Behaviour-preserving refactors.** OpenSpec and Spec Kit both ship a
  `refactor` track that requires characterization tests before any change and
  blocks the move out of `verify` if the evidence shows an existing test was
  modified (`max_existing_tests_modified: 0`).
- **Requirement traceability.** The spec gate captures requirement ids
  (`FR-001` in Spec Kit, `FR1` in BMAD, `R1` in the house flow, requirement
  names in OpenSpec) and the gate out of `verify` checks them against
  `evidence.implements`. `sdd-admin export rtm <app>`, the
  `sdd://apps/{slug}/rtm` resource and the admin UI show, per app, which
  requirement was covered by which evidence and who approved it.
- **Cross-app knowledge reuse.** `search_memory` with `scope: "company"` or a
  list of app slugs answers "how do other apps handle X" without pulling in
  every other app's private decisions by default.

## Quick start

You need Node 22 and Docker (for Postgres with pgvector).

```bash
git clone https://github.com/dbianco/sdd-orchestrator
cd sdd-orchestrator
npm install
cp .env.example .env                 # docker compose reads this file: set VOYAGE_API_KEY, or SDD_EMBEDDING_PROVIDER=ollama
docker compose up -d postgres

# sdd-admin reads the environment, not .env
export SDD_DATABASE_URL=postgres://sdd:sdd@localhost:5433/sdd
export VOYAGE_API_KEY=...            # or: export SDD_EMBEDDING_PROVIDER=ollama

npm run admin -- init --app checkout --demo --advisory
```

`init` migrates the database, registers the app, ingests the bundled framework
packs, issues you a personal token and prints the commands that connect Claude
Code. `--demo` adds a sample "demo" app so the admin UI is not empty (remove it
with `sdd-admin demo reset`); `--advisory` sets the suggested enforcement to
`"warn"` so nothing is blocked while you try it. Without an embedding key `init`
falls back to placeholder embeddings so setup works offline; search quality needs
a real provider. Run `init` from your application's repository with the
installed `sdd-admin` and add `--write-config` to create its `.sdd/config.json`
and `.gitignore` entry for you.

In your application repository, create `.sdd/config.json` (it is committed) and
ignore the state file:

```json
{ "app": "checkout", "enforcement": "warn" }
```

```gitignore
.sdd/state.json
```

Then start the server and look around:

```bash
docker compose up -d                 # server on :8080 (builds the image, including the admin UI)
curl http://localhost:8080/healthz
open http://localhost:8080/admin     # any username, password = your sdd_ token
```

Connect Claude Code with the three commands `init` printed:

```bash
export SDD_URL=http://localhost:8080 SDD_TOKEN=sdd_...
claude plugin marketplace add dbianco/sdd-orchestrator
claude plugin install sdd@sdd-orchestrator
```

Restart the Claude Code session (the plugin reads `SDD_TOKEN` at start-up), run
`/sdd:route <your task>`, and the agent routes it, starts a feature and walks
the gates. If anything misbehaves, run `sdd-admin doctor`.

## How it works

Every feature moves through the same seven phases and then `archived`:

`specify` → `plan` → `tasks` → `implement` → `verify` → `integrate` → `learn` → `archived`

Each framework pack maps its own vocabulary and commands onto these phases and
declares, per transition, the artifacts the agent must submit and the checks
they must pass. A track may skip phases.

| Framework | Tracks | Typical fit |
|---|---|---|
| `openspec` | `default`, `hotfix`, `refactor` | brownfield work with an existing spec library |
| `spec-kit` | `default`, `refactor` | greenfield services, the full seven-phase lifecycle |
| `bmad` | `quick`, `full` | compliance-sensitive or large work |
| `kiro` | `default` | requirements / design / tasks workflow |
| `sdlc` | `default` | the house flow |

The routing decision (framework, track, rule and reasons) is recorded, can be
pinned per app by a policy (for example `**/payments/**` always uses BMAD), and
is shown in the admin UI. Trivial fixes and spikes get a lite pack and no spec
phases.

### What the gates check

| Check | Blocks when |
|---|---|
| `missing_artifact` | a declared artifact was not submitted |
| `required_sections` | a section is missing or empty |
| `placeholder_scan` | TODO / TBD style markers are left in |
| `requirement_ids` | requirement ids are missing or duplicated |
| `measurable_criteria` | an acceptance criterion has no threshold |
| `delta_markers` | a delta spec lacks ADDED / MODIFIED / REMOVED |
| `task_ordering` | a task depends on a later or unknown task (lists like "depends on T1, T2" are all checked) |
| `task_done_checks` | a task has no done check |
| `artifact_traceability` | a requirement is not cited by any task, or a task cites a requirement that does not exist |
| `scope_drift` | a changed file is not in the plan |
| `verify_evidence` | tests, lint or security evidence is incomplete or failing |
| `requirement_coverage` | a requirement is missing from `evidence.implements` |
| `human_approved` | the move needs a person's approval |

Every finding in the admin UI comes with a plain-language fix.

## Using it day to day

### Connect a host

For Claude Code, the `sdd` plugin ([`hosts/claude-code/`](hosts/claude-code/README.md))
is the recommended setup: it connects the server and adds hooks that block code
edits until the task is routed and its feature reaches `implement`.

Which variable is read by what:

| Variable | Read by | Purpose |
|---|---|---|
| `SDD_DATABASE_URL` | the server and `sdd-admin` | Postgres connection URL. `sdd-admin` talks to the database directly. |
| `SDD_URL`, `SDD_TOKEN` | the Claude Code plugin | where the MCP server is and which token to send |
| `SDD_ENFORCEMENT` | the plugin hooks | personal override of `.sdd/config.json` (`block`, `warn`, `off`) |

`.sdd/config.json` in each repository names the app and the enforcement level:
`{ "app": "checkout", "enforcement": "block" }`. `warn` explains instead of
refusing, which is the easiest way to try the workflow; set `SDD_ENFORCEMENT=warn`
in your own shell to do that without changing the committed file.

Each person and each pipeline gets its own token; the server records the
token's identity instead of trusting an `actor` field. `SDD_AUTH_MODE` defaults
to `warn` (calls without a token still work, with a warning); set it to
`enforce` once every host sends a token.

```bash
sdd-admin token create --for daniel --scope host,approver --name "daniel laptop"
sdd-admin token create --for checkout-ci --scope ci --app checkout --name "checkout pipeline"
sdd-admin token list                                   # shows each token's app slugs
sdd-admin token update <id> --add-app billing          # widen a token without issuing a new secret
```

A token created with `--app` only sees those apps. The plugin reads `SDD_TOKEN`
when the session starts, so **restart the session after you change the token you
export**. Widening a token with `token update` needs no restart: the server
checks the token's scope on every call.

Without the plugin, configure the MCP server by hand.

Claude Code (`.mcp.json` in the workspace):

```json
{
  "mcpServers": {
    "sdd": { "type": "http", "url": "http://sdd.internal:8080/mcp", "headers": { "Authorization": "Bearer ${SDD_TOKEN}" } }
  }
}
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sdd": { "url": "http://sdd.internal:8080/mcp", "headers": { "Authorization": "Bearer ${env:SDD_TOKEN}" } }
  }
}
```

Local development against a local database, over stdio:

```json
{
  "mcpServers": {
    "sdd": { "command": "sdd-orchestrator", "args": ["--stdio"] }
  }
}
```

### Seed the knowledge base and configure an app

`sdd-admin init` ingests every bundled pack. To be selective, or to add your
own, use `ingest` and `ingest-all`:

```bash
sdd-admin app register checkout --name "Checkout Service" --compliance
sdd-admin app update checkout --stack typescript,react,node --budget 6000
sdd-admin app set-policy checkout policy.json --reason "PCI scope: BMAD for payments paths"

sdd-admin ingest packs/openspec
sdd-admin ingest packs/quality-layer
sdd-admin ingest packs/stack-guides/react
sdd-admin ingest packs/company            # always-on constitution
sdd-admin ingest-all packs                # or everything under a directory
```

`policy.json`:

```json
{
  "framework": null,
  "path_rules": [{ "glob": "**/payments/**", "framework": "bmad" }],
  "risk_paths": ["**/webhooks/**"]
}
```

### Route a task and start a feature

The developer types a task; the host agent calls the server.

```
You: Add CSV export to the orders page.
```

The agent calls `route_task`:

```json
{
  "task_description": "Add CSV export to the orders page",
  "app": "checkout",
  "workspace": {
    "stack": ["typescript", "react"],
    "is_greenfield": false,
    "has_spec_library": true,
    "estimated_files": 4,
    "paths_touched": ["src/orders/"],
    "host": "claude-code"
  }
}
```

and receives:

```json
{
  "decision": {
    "framework": "openspec",
    "track": "default",
    "confidence": "high",
    "rule": "10-brownfield-small-medium",
    "reasons": ["brownfield (asserted by host)", "size: medium (4 files, one top-level dir)"],
    "high_risk": false,
    "policy_version": 3,
    "framework_pack_version": "1.0.0"
  },
  "attached_layers": [
    { "pack_name": "quality-layer", "pack_version": "1.0.0", "kind": "standard" },
    { "pack_name": "stack-guides/react", "pack_version": "1.0.0", "kind": "stack_guide" }
  ]
}
```

The agent shows the decision, the developer accepts, and the agent calls
`start_feature` with the same decision and `actor: "daniel"`. The result
carries a `feature_id` and the first context pack: header, always-on
constitution, the OpenSpec proposal template, retrieved app memory such as
`ADR-7 Exports go through the reporting service`, React guide sections, and
the stop conditions plus the checks the next gate will run.

`route_task` also returns a `routing_id`: the server records one routing
event per unit of work (deduplicated by `external_ref` or by task text), so
trivial fixes that never become features still show up in the admin. Pass
the `routing_id` to `start_feature`, and call `record_commit` after each
commit to link it to the work.

### Advance through the gates

After the agent writes the proposal and the developer reviews it:

```json
{
  "feature_id": "f_01j9…",
  "actor": "daniel",
  "expected_phase": "specify",
  "target_phase": "implement",
  "artifacts": { "proposal.md": "…", "specs": "…", "tasks.md": "…" }
}
```

Spec review is a person's decision, not the agent's: when every check
passes, the move comes back as `"result": "awaiting_approval"` with an
`approval_id`, and a reviewer approves or rejects it in the admin UI's
Approvals tab or with `sdd-admin approvals approve <id>`. Compliance apps and
high-risk features need a reviewer other than the requester. (With
`SDD_AUTH_MODE=off` the v1 behaviour applies: the host sends
`"human_approved": true`.)

A failing gate is a normal result, not an error:

```json
{
  "result": "fail",
  "findings": [
    { "check": "placeholder_scan", "severity": "blocker", "location": "proposal.md:41", "message": "marker TBD" },
    { "check": "measurable_criteria", "severity": "blocker", "location": "proposal.md:58", "message": "\"export must be fast\" has no threshold" }
  ]
}
```

The agent fixes the proposal and calls again. On pass it receives
`next_instructions` for `implement`. At the end of implementation the host
sends evidence with the move out of `verify`:

```json
{
  "expected_phase": "verify",
  "target_phase": "integrate",
  "evidence": {
    "tests": { "command": "npm test", "passed": 48, "failed": 0 },
    "lint": "pass",
    "security": { "status": "pass", "new_high": 0 },
    "files_changed": ["src/orders/export.ts", "src/orders/export.test.ts"],
    "implements": ["REQ-12"]
  }
}
```

If tests keep failing, the agent moves back from `verify` to `implement` with
`cycle_failed: true`. The third such move blocks the feature until a human
intervenes.

Moving a feature to `archived` also tells the host when the change was tiny for
the full track it used (see [Measuring the benefit](#measuring-the-benefit)).

### Look things up across apps

```json
{ "query": "how do other apps handle CSV encoding", "app": "checkout", "scope": "company" }
```

or, for named apps:

```json
{ "query": "rate limiting decisions", "app": "checkout", "scope": ["billing", "reporting"] }
```

### Grow and retire memory

During the `learn` phase the agent proposes an ADR:

```json
{
  "feature_id": "f_01j9…",
  "actor": "daniel",
  "kind": "app_memory",
  "memory_type": "adr",
  "title": "ADR-9 CSV exports stream rather than buffer",
  "body": "…",
  "links": ["openspec/changes/archive/2026-09-10-orders-csv-export/"]
}
```

An admin reviews proposals in the admin UI (Proposals) or from the CLI, and
retires knowledge:

```bash
sdd-admin proposals list
sdd-admin proposals approve p_42
sdd-admin deprecate checkout.adr.0003 --successor checkout.adr.0009 --reason "superseded by streaming"
sdd-admin deprecate-framework kiro --reason "no longer used"
sdd-admin reindex                       # after switching embedding model
sdd-admin export rtm checkout > rtm.csv # requirement traceability matrix
```

### Report CI evidence and comment on pull requests

For compliance apps and high-risk features (and apps whose policy sets
`"evidence": "ci"`), the move out of `verify` takes tests, lint and security
results only from CI, and only for the feature's latest commit. The pipeline
posts them with `scripts/sdd-ci-evidence.mjs`, which finds the feature from the
`SDD-Ref` commit trailer. The `security` field is scanner-agnostic;
[`docs/security-evidence.md`](docs/security-evidence.md) shows how to produce it
from Trivy and Opengrep (free, no account) with a baseline so only new findings
count. `scripts/sdd-pr-comment.mjs` posts one sticky summary comment per pull
request (requirement coverage, tests, approvals, blockers with fixes). Both are
described in [`docs/ci/github-actions.md`](docs/ci/github-actions.md), with a
ready-to-copy workflow.

## The admin UI

Open `/admin` (the same port as the server). Log in with any username and, as
the password, a personal token with the `approver` scope (to approve or reject)
or the shared `SDD_ADMIN_TOKEN` (read-only). The page is absent (a plain 404)
when `SDD_AUTH_MODE=off` and `SDD_ADMIN_TOKEN` is unset.

| Page | What you do there |
|---|---|
| Overview | feature counts, proposals waiting, blockers by check, time per phase, right-sizing and process-value cards |
| My week | what you shipped and which problems the gates caught for you, with fixes |
| Apps & Features | browse features, read a feature's phase history with findings, check the traceability matrix |
| Work | everything routed, with the decision, linked commits and features |
| Approvals | read artifacts and evidence, then approve or reject a phase move |
| Proposals | review agent-proposed memory and accept or reject it |
| Flow | phase-to-phase heatmap showing where gates stop work |
| Spec drift | archived specs whose files were changed again afterwards |

Every page has an **About this page** panel explaining what you can do there.
The **Project** picker in the sidebar scopes every page to one app, `Ctrl/⌘+K`
opens a command palette, tables sort and export to CSV, and the theme follows
your system (with a manual toggle). A number badge on Approvals shows requests
waiting for you; set `SDD_NOTIFY_WEBHOOK_URL` (Slack, Teams or Discord incoming
webhook) to be pinged in chat as well.

## Measuring the benefit

- **Is the process paying off?** (Overview): first-pass gate rate per week,
  problems caught before review, median approval wait.
- **Where does the time go?** (Overview): median time per phase and per track,
  the share spent on specs versus building, and time lost to rework after a
  failed gate. Backward moves are counted as spec amendments.
- **Right-sizing** (Overview, and a hint when a feature is archived): small
  changes (three files or fewer, two requirements or fewer) that went through a
  full track, so similar work can be routed as `trivial`. Compliance apps and
  high-risk features are excluded.
- **Spec drift**: archived specs whose files were later changed with no spec
  (flagged "likely stale") or only through other features ("review").
  `sdd-admin export drift [app]` prints the same report.
- **My week**: per-person summary framed as problems caught early.
- **Pull-request comments**: the spec-to-evidence picture on every PR.

## CLI reference

`sdd-admin` connects to the database directly (`SDD_DATABASE_URL`). Run any
command with `--help` for its options; in a checkout use `npm run admin -- <command>`.

| Command | Purpose |
|---|---|
| `init` | one-step setup: migrate, register an app, ingest packs, issue a token, optional demo data and repo config |
| `doctor` | check the database, pgvector, migrations, embedding provider, packs and auth, and print fixes (`--json` available) |
| `app register / update / set-policy / add-stop-condition / list` | manage apps, their stack, token budget, routing policy and stop conditions |
| `ingest <dir>` / `ingest-all [dir]` | validate and ingest knowledge packs |
| `deprecate <id>` / `deprecate-framework <name>` | retire knowledge items or a framework version |
| `proposals list / approve / reject` | review agent proposals |
| `approvals list / show / approve / reject` | decide phase moves that wait for a person |
| `token create / list / update / revoke` | issue and manage API tokens (scopes `host`, `approver`, `ci`, `admin`) |
| `reindex` | re-embed every chunk after changing the embedding model |
| `export rtm / pr-comment / drift` | traceability matrix (CSV or JSON), a pull-request summary, the drift report |
| `eval <cases.yaml>` | measure retrieval recall@8 and MRR on golden cases |
| `demo seed / reset` | create or remove a sample "demo" app |

## Configuration

Set these on the server (see [`.env.example`](.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `SDD_DATABASE_URL` | required | Postgres connection URL |
| `SDD_EMBEDDING_PROVIDER` | `voyage` | `voyage`, `ollama` or `fake` (placeholder, for tests and offline setup) |
| `SDD_EMBEDDING_MODEL` | provider default | `voyage-3.5`, `mxbai-embed-large`, ... |
| `VOYAGE_API_KEY` | none | required for the Voyage provider |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `SDD_LISTEN` | `127.0.0.1:8080` | `host:port` the HTTP server binds |
| `SDD_ALLOWED_HOSTS` | `localhost,127.0.0.1` | accepted `Host` headers |
| `SDD_TOKEN_BUDGET` | `6000` | default context-pack budget in tokens (per-app override with `app update --budget`) |
| `SDD_AUTH_MODE` | `warn` | `off`, `warn` or `enforce` |
| `SDD_ADMIN_TOKEN` | none | shared read-only password for the admin UI |
| `SDD_NOTIFY_WEBHOOK_URL` | none | chat webhook pinged when an approval is requested |
| `SDD_PUBLIC_URL` | none | base URL used for the link in that message |

## MCP surface

Tools: `route_task`, `start_feature`, `advance_phase`, `get_context`,
`get_feature_status`, `list_features`, `search_memory`, `propose_memory`,
`record_commit`. Resources: `sdd://apps/{slug}`, `sdd://apps/{slug}/rtm`,
`sdd://features/{id}`, `sdd://frameworks/{name}` and versioned knowledge items
under `sdd://knowledge/...`. Prompts: one `sdd.<phase>` prompt per phase.
What a host may and may not assume about a context pack is in
[`docs/verification/host-integration.md`](docs/verification/host-integration.md).

## Deploying

`docker compose up -d` runs Postgres (pgvector) and the server; the image builds
the admin UI and ships the packs. `GET /healthz` reports health and `GET /metrics`
exposes Prometheus metrics. Pool sizing against embedding latency, long-lived
`GET /mcp` streams and migrations on CLI start-up are covered in
[`docs/operations.md`](docs/operations.md).

## Troubleshooting

Start with `sdd-admin doctor`: it checks each dependency and prints the fix.

| Symptom | Likely cause and fix |
|---|---|
| `SDD_DATABASE_URL is not set` | `sdd-admin` and the server connect to Postgres directly; export the URL. `SDD_URL` and `SDD_TOKEN` are only for the plugin. |
| `this token is not scoped to app X` | the token was issued with `--app`; run `sdd-admin token update <id> --add-app X` |
| still `FORBIDDEN` after exporting a new token | restart the Claude Code session; the plugin reads `SDD_TOKEN` at start-up |
| "retrieval is off by configuration" | no embedding provider is configured; set `SDD_EMBEDDING_PROVIDER` and restart |
| "retrieval degraded at runtime" | the embedding provider failed; the warning names it and the error (check the key, URL and network) |
| edits are blocked by the hooks | the task is not routed or the feature is not in `implement`; run `/sdd:route`, or try `SDD_ENFORCEMENT=warn` |
| the admin UI returns 404 | `SDD_AUTH_MODE=off` and `SDD_ADMIN_TOKEN` is unset; set either |
| `hnsw.iterative_scan` errors | pgvector is older than 0.8; use the `pgvector/pgvector:pg16` image or upgrade the extension |

## Development

```bash
npm install
npm run db:test:up                       # Postgres + pgvector on :55432
export SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test
npm test                                 # unit, integration and contract tests (needs pgvector 0.8+)
npm run typecheck
npm run dev:stdio                        # server over stdio against SDD_DATABASE_URL
npm run admin -- app list                # sdd-admin without building
npm run admin -- eval packs/evals/seed.yaml   # retrieval recall@8 and MRR on golden cases
node docs/verification/walkthrough.mjs --url http://localhost:8080 \
  --host-token sdd_... --approver-token sdd_... --ci-token sdd_...   # scripted host walkthrough
```

The admin UI is a small React app in `admin-ui/`:

```bash
npm --prefix admin-ui install
npm --prefix admin-ui run dev            # http://localhost:5173/admin/, proxies /admin/api to :8080
npm run test:admin-ui                    # component tests
npm run build:admin-ui                   # output served by the server from admin-ui/dist
```

## Repository layout

```
.claude-plugin/           marketplace manifest for the Claude Code plugin
.github/workflows/        CI: typecheck, unit, integration, contract, admin UI, plugin, eval, image
admin-ui/                 the admin console (React, Vite)
docs/ci/                  CI evidence and pull-request comment workflows
docs/operations.md        deployment and operating notes
docs/security-evidence.md producing the security evidence from Trivy and Opengrep
docs/superpowers/         design specs, implementation plans and reviews
docs/verification/        host integration guide, feature matrix, walkthroughs, scripted walkthrough
hosts/claude-code/        the sdd plugin for Claude Code: hooks, skill, commands
migrations/               node-pg-migrate schema
packs/                    seed knowledge packs (frameworks, quality layer, stack guides, company) and golden eval cases
scripts/                  sdd-ci-evidence, sdd-pr-comment and sdd-security-evidence for pipelines
src/                      server (mcp, web), services, assembler, gates, analytics, reports, ingestion and CLI
test/                     unit, integration and contract tests
```

## More documentation

- Design: [`docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`](docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md)
  and the later specs for the admin UI, routing events and commits, and trust and traceability.
- Host verification status: [`docs/verification/feature-matrix.md`](docs/verification/feature-matrix.md).
- Interactive runtime architecture diagram:
  [dbianco.github.io/sdd-orchestrator/architecture/sdd-orchestrator.architecture.html](https://dbianco.github.io/sdd-orchestrator/architecture/sdd-orchestrator.architecture.html).

## License

MIT
