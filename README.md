# SDD Orchestrator

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server
that gives coding agents the right spec-driven-development (SDD) context at the
right moment.

For each task it:

- **routes** the task to the best-fitting SDD framework (OpenSpec, GitHub Spec
  Kit, BMAD, Kiro, or a house workflow) using explainable rules;
- **keeps lifecycle state** per feature and runs deterministic gate checks
  between phases, so gates are enforced rather than advisory;
- **assembles a context pack** per phase from a company-wide knowledge base,
  with app-scoped memory (ADRs, accepted specs, decisions) and explicit
  cross-app lookup.

The host agent (Claude Code, Cursor, or any MCP client) remains the only thing
that edits files, runs tests or spawns sub-agents. The server reads and writes
only its own database.

## Status

v1 implemented per
[`docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`](docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md)
and the plan in
[`docs/superpowers/plans/2026-09-10-sdd-orchestrator-v1.md`](docs/superpowers/plans/2026-09-10-sdd-orchestrator-v1.md).
Host verification status is tracked in
[`docs/verification/feature-matrix.md`](docs/verification/feature-matrix.md).

## Development

```bash
npm install
npm run db:test:up                       # Postgres + pgvector on :55432
export SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test
npm test                                 # unit, integration and contract tests
npm run typecheck
npm run dev:stdio                        # server over stdio against SDD_DATABASE_URL
npm run admin -- app list                # sdd-admin without building
```

## Planned stack

| Component | Choice |
|---|---|
| Runtime | TypeScript on Node 22 |
| Transport | MCP over Streamable HTTP (shared) and stdio (local dev) |
| Storage | Postgres with pgvector, shipped via Docker Compose |
| Embeddings | Voyage AI by default, Ollama for development |
| Admin | `sdd-admin` CLI for ingesting packs, approving proposals, deprecating items |

## Usage examples

The interface below is the v1 contract.

### 1. Run the server

```bash
git clone https://github.com/dbianco/sdd-orchestrator
cd sdd-orchestrator
cp .env.example .env            # set VOYAGE_API_KEY, or SDD_EMBEDDING_PROVIDER=ollama
docker compose up -d            # Postgres + pgvector + sdd-orchestrator on :8080
curl http://localhost:8080/healthz
```

### 2. Seed the knowledge base (admin, once)

```bash
sdd-admin app register checkout --name "Checkout Service" --compliance
sdd-admin app update checkout --stack typescript,react,node --budget 6000
sdd-admin app set-policy checkout policy.json --reason "PCI scope: BMAD for payments paths"

sdd-admin ingest packs/openspec
sdd-admin ingest packs/spec-kit
sdd-admin ingest packs/bmad
sdd-admin ingest packs/quality-layer
sdd-admin ingest packs/stack-guides/react
sdd-admin ingest packs/company            # always-on constitution
```

`policy.json`:

```json
{
  "framework": null,
  "path_rules": [{ "glob": "**/payments/**", "framework": "bmad" }],
  "risk_paths": ["**/webhooks/**"]
}
```

### 3. Connect a host

Claude Code (`.mcp.json` in the workspace):

```json
{
  "mcpServers": {
    "sdd": { "type": "http", "url": "http://sdd.internal:8080/mcp" }
  }
}
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sdd": { "url": "http://sdd.internal:8080/mcp" }
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

### 4. Route a task and start a feature

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

### 5. Advance through the gates

After the agent writes the proposal and the developer reviews it:

```json
{
  "feature_id": "f_01j9…",
  "actor": "daniel",
  "expected_phase": "specify",
  "target_phase": "implement",
  "artifacts": { "proposal.md": "…", "specs": "…", "tasks.md": "…" },
  "human_approved": true
}
```

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

### 6. Look things up across apps

```json
{ "query": "how do other apps handle CSV encoding", "app": "checkout", "scope": "company" }
```

or, for named apps:

```json
{ "query": "rate limiting decisions", "app": "checkout", "scope": ["billing", "reporting"] }
```

### 7. Grow and retire memory

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

An admin reviews and retires knowledge:

```bash
sdd-admin proposals list
sdd-admin proposals approve p_42
sdd-admin deprecate checkout.adr.0003 --successor checkout.adr.0009 --reason "superseded by streaming"
sdd-admin deprecate-framework kiro --reason "no longer used"
sdd-admin reindex                       # after switching embedding model
```

## Repository layout

```
docs/superpowers/specs/   design specifications
docs/superpowers/plans/   implementation plans
docs/verification/        host integration guide, feature matrix, walkthroughs, workspace-facts script
migrations/               node-pg-migrate schema
packs/                    seed knowledge packs (frameworks, quality layer, stack guides, company)
src/                      server, services, assembler, ingestion and CLI
test/                     unit, integration and contract tests
```

## License

MIT
