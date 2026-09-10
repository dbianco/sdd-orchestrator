# SDD Orchestrator: Design Specification

**Status:** Draft for review
**Date:** 2026-09-10
**Supersedes:** `sdd_orchestrator_spec.md` (v1.0.0 draft)

## 1. Summary

The SDD Orchestrator is a standalone Model Context Protocol (MCP) server that
gives coding agents the right spec-driven-development (SDD) context at the right
moment. For each task it decides which SDD framework fits, keeps the feature's
lifecycle state, runs deterministic gate checks between phases, and assembles a
budgeted context pack from a company-wide, app-partitioned knowledge base backed
by Postgres with pgvector.

The server is host-agnostic. Claude Code and Cursor are the verified hosts for
v1. The existing `sdlc` Claude Code plugin is one possible consumer and is not a
dependency; its workflow is registered as one of the routable frameworks.

The host agent remains the only thing that edits files, runs tests or spawns
sub-agents. The server reads and writes only its own database. It never touches
a repository.

## 2. Goals

- Route a task to the best-fitting SDD framework using explainable rules, not
  similarity search.
- Keep per-feature lifecycle state so phase gates are enforced rather than
  advisory, and so any host or teammate can resume a feature.
- Serve a context pack per phase that puts non-negotiable constraints where
  attention is strongest and retrieves everything else on demand.
- Hold knowledge for many apps in one store, with app memory (ADRs, accepted
  specs, decisions) scoped per app and cross-app lookup as an explicit action.
- Support incorporating and retiring knowledge through a reviewed, versioned
  ingestion path.
- Work from Claude Code and Cursor over standard MCP.

## 3. Non-goals

- Running tests, scans or agents inside the server.
- Reading or writing repositories.
- Authentication, authorization or multi-tenant isolation beyond app scoping
  (v1 is network-restricted; see section 11).
- Replacing Linear, Notion, Git or CI.
- An LLM-based router, automatic ingestion from repositories, an AIUP pack,
  Kiro IDE verification, RTM generation, or adapting the `sdlc` plugin to call
  the server. These are follow-ups (section 14).

## 4. Background and sources

The design draws on three sources. Numeric citations from the earlier draft are
replaced by these references.

- Graziano, *AI-Native Software Engineering* (O'Reilly early release, 2026).
  Chapters 3 (context engineering), 4 (MCP), 5 (SDD), 6 (SDD workflow),
  7 (frameworks compared), 8 (verification), 9 (orchestration patterns).
- Durkin, Minick, Gaikwad, *AI-Native Software Delivery* (O'Reilly, 2025).
  Chapter 7 (quality gates, policy as code) and chapter 10 (platform
  templates). This book has no material on retrieval or context engineering.
- ainativesoftware.engineering/compare, the framework comparison covering Spec
  Kit, OpenSpec, BMAD, Kiro and Agent Skills.

Findings that shaped the design:

- Framework choice depends on task attributes (greenfield or brownfield, change
  size, ceremony tolerance, compliance), not on textual similarity to a
  template. Graziano warns that semantic search "can miss things that are
  relevant for architectural reasons rather than textual similarity".
- Attention is weakest in the middle of the context window. Constraints belong
  at the start and end; retrieved material belongs in the middle.
- Tool descriptions are paid for on every turn, so the tool surface must stay
  small, and every description must say what the tool does, when to use it and
  what it returns.
- Policies should be versioned and reviewed. Durkin et al. note that policy as
  code gives "directional input to the AI as to what we want, and protection
  ensuring that the output of the AI is in compliance", and that policies can
  signal deprecation of templates.
- Neither source describes AIUP. The term "context pack" appears in neither
  book and is defined in section 9.

## 5. Architecture

One TypeScript service on Node 22, `sdd-orchestrator`, packaged as a Docker
image, plus an admin CLI, `sdd-admin`. Postgres with the pgvector extension is
the only stateful dependency. MCP is exposed over Streamable HTTP for shared use
and over stdio for local development and tests.

```
Host (Claude Code, Cursor)
        │  MCP (Streamable HTTP or stdio)
        ▼
┌──────────────────────────────────────────────────────────┐
│ sdd-orchestrator                                         │
│  MCP surface ─► Router ─► Lifecycle engine ─► Assembler  │
│                              │                  │        │
│                              ▼                  ▼        │
│                         Knowledge store ◄── Embedding    │
│                              │             provider      │
└──────────────────────────────┼───────────────────────────┘
                               ▼
                    Postgres + pgvector
                               ▲
                    sdd-admin CLI (ingest, deprecate,
                    approve, register apps)
```

### 5.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| MCP surface | Register tools, resources, prompts; validate input; map errors to codes | Router, lifecycle engine, assembler |
| Router | Pure function from task signals to a routing decision | Nothing (no I/O) |
| Lifecycle engine | Feature state, phase transitions, gate checks on artifact text | Knowledge store (for framework pack gate declarations) |
| Knowledge store | Repository over Postgres for items, versions, chunks, proposals, apps, features | Embedding provider |
| Context assembler | Retrieve, order and budget content into a context pack | Knowledge store |
| Ingestion CLI | Validate and load packs; manage apps, proposals, deprecation, reindex | Knowledge store |

Each unit is testable alone. The router and gate checks are pure. Framework
knowledge lives in packs, not in code, so adding a framework never changes the
engine.

### 5.2 Main call flow

1. Host calls `route_task` with the task description, app slug and workspace
   facts.
2. MCP surface validates input and loads the app.
3. Router produces a decision: framework, track, confidence, reasons, and
   clarifying questions when confidence is medium.
4. Lifecycle engine creates a feature in phase `specify` (or resumes one when a
   feature id is supplied).
5. Assembler builds the context pack for the current phase.
6. Surface returns decision, feature id, pack and questions.

## 6. Data model

All tables carry `created_at`, `updated_at` and `created_by` (display identity,
see section 11).

| Table | Columns (indicative) | Notes |
|---|---|---|
| `apps` | id, slug, name, default_stack (text[]), compliance (bool), routing_policy (jsonb), token_budget (int, nullable) | Unit of app memory. `routing_policy` holds overrides such as `{"framework":"openspec"}` or path-based rules |
| `features` | id, app_id, slug, framework, track, current_phase, status (active, blocked, archived), blocked_reason, source_task (text) | One row per routed feature. Bound to a workspace by `.sdd/feature.json` |
| `phase_transitions` | id, feature_id, from_phase, to_phase, gate_result (jsonb), evidence (jsonb), reason, actor | Audit trail of every gate run, pass or fail, forward or backward |
| `knowledge_items` | id, stable_id, kind, framework, app_id (nullable), stack_tags (text[]), phase_tags (text[]), title, body, front_matter (jsonb), version, status (active, deprecated, pending), superseded_by, deprecation_reason, source_path, source_hash, source_url, license | Immutable once active. Changes create a new version |
| `knowledge_chunks` | id, item_id, ordinal, heading, text, embedding (vector), token_count | One row per heading-delimited section, max about 500 tokens |
| `proposals` | id, app_id, feature_id, payload (jsonb), status (pending, approved, rejected), reviewed_by, review_reason | Approval copies payload into `knowledge_items` as a new active item |

`kind` is one of `framework_pack`, `standard`, `stack_guide`, `app_memory`.

Rules:

- An `app_memory` item belongs to exactly one app. Retrieval across apps
  happens only when the query names the scope.
- An active item is never edited. Re-ingesting a changed file creates version
  n+1 and sets `superseded_by` on version n.
- Deprecated items stay in the database, leave default retrieval, and remain
  resolvable by id so a feature's history stays readable.
- Every feature transition stores the item ids and versions the pack used, so a
  feature routed earlier can show which standards it was held to.

## 7. MCP surface

Six developer-facing tools. Admin operations are CLI only (section 10), which
keeps the tool list small and keeps knowledge writes off the network path.

Every description states what the tool does, when to use it and what it
returns, and includes one example call. Every tool that returns instructions
returns them as plain text inside the result, because Cursor's support for the
Prompts primitive lags behind Tools.

### 7.1 Tools

| Tool | Input | Output |
|---|---|---|
| `route_task` | `task_description` (string, required), `app` (slug, required), `workspace` (object: `stack` string[], `is_greenfield` bool or null, `has_spec_library` bool or null, `estimated_files` int or null, `paths_touched` string[], `host` string), `framework_preference` (enum: openspec, spec-kit, bmad, kiro, sdlc, auto), `feature_id` (optional, to resume) | `decision` {framework, track, confidence: high or medium, rule, reasons[]}, `feature_id`, `context_pack`, `clarifying_questions[]` (max 3), `attached_layers[]` (quality layer, stack guides) |
| `get_context` | `feature_id`, `phase` (optional, defaults to current), `focus` (optional query string), `include_apps` (slug[] or "company", optional) | `context_pack` |
| `advance_phase` | `feature_id`, `target_phase`, `artifacts` (map name to content), `evidence` (object, verify phase only), `human_approved` (bool), `reason` (required for backward moves) | `result` (pass or fail), `findings[]` {check, severity, location, message}, `next_instructions` (text, on pass), `feature` state |
| `search_memory` | `query`, `scope` ("app", "company", or slug[]), `kinds[]`, `limit` (default 8) | `chunks[]` {item_id, stable_id, version, app, kind, heading, text, score} |
| `propose_memory` | `feature_id`, `kind` (app_memory or standard), `title`, `body`, `stack_tags[]` | `proposal_id`, `status` |
| `get_feature_status` | `feature_id` | framework, track, current_phase, status, blocked_reason, transitions[], open questions |

### 7.2 Resources

Read-only, addressed by URI:

- `sdd://apps/{slug}`: app profile, policy, active standards.
- `sdd://features/{id}`: feature state and transitions.
- `sdd://features/{id}/context/{phase}`: the context pack for a phase.
- `sdd://frameworks/{name}`: framework pack summary: phases, artifacts, gates.
- `sdd://knowledge/{stable_id}[@version]`: full body of one item.

### 7.3 Prompts

One prompt per abstract phase: `sdd.specify`, `sdd.plan`, `sdd.tasks`,
`sdd.implement`, `sdd.verify`. Each takes `feature_id` and is built by the same
assembler the tools use. Prompts are a convenience layer, never the only path.

### 7.4 Error codes

| Code | When |
|---|---|
| `APP_NOT_FOUND` | Unknown app slug |
| `FEATURE_NOT_FOUND` | Unknown feature id |
| `PHASE_ORDER_VIOLATION` | Target phase is not reachable from the current one |
| `GATE_FAILED` | One or more gate checks failed; findings attached |
| `FEATURE_BLOCKED` | Feature is blocked; reason attached |
| `EMBEDDING_UNAVAILABLE` | Provider down; response is degraded, not failed, where possible |
| `VALIDATION_ERROR` | Input schema violation, with field path |

Each error carries a human-readable message so the host can act instead of
guessing.

## 8. Router

The router is a pure function. It evaluates signals in priority order and stops
at the first rule that fires. The decision records the rule name and the
signals used.

### 8.1 Signals

| Signal | Source |
|---|---|
| App policy override | `apps.routing_policy` |
| Explicit preference | `framework_preference` |
| Spike intent | Task text matches exploration phrasing ("can we", "prototype", "spike", "is it possible") |
| Product-level scope | Task text asks for a whole product, epic or PRD |
| Greenfield or brownfield | `workspace.is_greenfield`, falling back to `has_spec_library` |
| Change size | `estimated_files` and `paths_touched`: small is one layer and few files; large is a new subsystem or several repositories; otherwise medium |
| Risk paths | `paths_touched` matching payments, auth, migrations, infra, CI patterns |
| Compliance flag | `apps.compliance` |

### 8.2 Rules

| Order | Condition | Decision |
|---|---|---|
| 1 | App policy names a framework (optionally per path pattern) | That framework |
| 2 | Explicit preference given | That framework, with a warning in `reasons` if rules 3 to 9 would differ |
| 3 | Spike intent | No framework. Return prototype-first guidance; create no feature |
| 4 | Product-level scope | `sdlc` house flow, starting at PRD |
| 5 | Brownfield and small | OpenSpec |
| 6 | Brownfield and medium | OpenSpec; Spec Kit if risk paths touched |
| 7 | Greenfield and medium or large | Spec Kit |
| 8 | Large and (compliance flag or new subsystem needing domain modelling) | BMAD; track `quick` under about fifteen estimated stories, `full` above |
| 9 | Kiro | Only via rule 1 or 2. Kiro's EARS requirement patterns are served as content in every framework's requirements phase regardless |

If greenfield status or size is unknown, confidence is `medium`, the best
candidate is returned, and up to three clarifying questions are included for
the host to ask its user. Osmani's quality skills and matching stack guides
attach to every decision and are never routing targets.

## 9. Context assembly

A **context pack** is the ordered, budgeted block of text returned for one
feature in one phase. Material that must never be forgotten sits at the start
and the end; retrieved material sits in the middle.

### 9.1 Order

| Position | Content | Trimmable |
|---|---|---|
| 1 | Header: feature id, framework, phase, instruction block for this phase from the framework pack | No |
| 2 | Non-negotiable standards: company constitution and app steering rules, one constraint per line with its reason | No |
| 3 | Phase template, verbatim from the framework pack | No |
| 4 | Retrieved memory: top-k chunks from app memory and standards filtered by app, stack and phase, each with item id, version and source. Cross-app chunks only when requested | Yes, second |
| 5 | Stack guide sections retrieved by the task query, never whole files | Yes, first |
| 6 | Stop conditions (ambiguity, three failed fix attempts, contradiction with acceptance criteria, irreversible data changes, plus app-specific ones) and what the next gate will check | No |

### 9.2 Retrieval

Hybrid, in this order: metadata filters (app, kind, framework, phase, stack,
status active), then vector similarity on chunk embeddings, plus an exact match
on identifiers such as `ADR-`, `REQ-`, `US-` so a referenced decision is never
missed by similarity alone. Results are deduplicated by item and carry
provenance.

### 9.3 Budget

Default six thousand tokens, overridable per app. Trimming cuts stack guides
first, then memory, and never positions 1, 2, 3 or 6. Token counts are stored
per chunk at ingestion so budgeting needs no model call.

### 9.4 Degraded mode

When the embedding provider is unavailable the assembler builds the pack from
metadata filters and exact-id matches only, marks the pack `degraded: true`, and
the call succeeds.

## 10. Lifecycle and gates

### 10.1 Abstract phases

Every framework is mapped onto one loop: `specify`, `plan`, `tasks`,
`implement`, `verify`, `integrate`, `learn`. The engine reasons only about these
phases. Each framework pack declares its mapping:

| Framework | Mapping highlights |
|---|---|
| OpenSpec | `propose` covers specify, plan and tasks in one transition; `apply` is implement; `verify` and `sync` are verify; `archive` is integrate |
| Spec Kit | constitution is a standard, not a phase; specify, clarify, plan, tasks, analyze, implement map one to one; reconcile is learn |
| BMAD | Quick track: quick-spec is specify through tasks, quick-dev is implement. Full track: PRD and architecture expand specify; epics and stories are tasks; dev-story is implement; code-review is verify; retrospective is learn |
| Kiro | requirements is specify, design is plan, tasks is tasks |
| sdlc house flow | PRD, scoping doc, jot down map to specify and plan; task breakdown is tasks; implement-task covers implement and verify |

### 10.2 Gate check library

Framework packs declare which checks run at which transition. The library is
deterministic and the server never fills in missing content.

| Check | What it verifies |
|---|---|
| `placeholder_scan` | No `TBD`, `TODO`, `NEEDS HUMAN INPUT`, or unresolved open-question markers |
| `required_sections` | Named sections present and non-empty |
| `measurable_criteria` | Acceptance criteria contain no unquantified adjectives (fast, gracefully, robust) without a threshold |
| `task_done_checks` | Every task has a binary done check |
| `task_ordering` | No task depends on a later task |
| `delta_markers` | OpenSpec ADDED, MODIFIED, REMOVED sections valid; every REMOVED entry has Reason and Migration |
| `human_approved` | Host asserted human approval; stored with actor |

### 10.3 Transitions

- `advance_phase` runs the declared checks on the artifact text sent by the
  host. Failure returns findings with locations and leaves the feature in place.
- Backward moves are allowed with a recorded reason.
- Verify accepts evidence: test summary, lint result, security status, files
  changed. The server records it and checks it against what the tasks phase
  declared. It does not run anything.
- A third reported failed correction cycle sets status `blocked` with the
  reason. Unblocking is a backward transition with a reason.
- Learn returns a prompt asking the agent to propose memory.
- Integrate completed sets status `archived`.

## 11. Deployment, configuration and security

### 11.1 Deployment

`docker-compose.yml` starts Postgres with pgvector and the server. Environment
variables:

| Variable | Purpose |
|---|---|
| `SDD_DATABASE_URL` | Postgres connection |
| `SDD_EMBEDDING_PROVIDER` | `voyage` (default) or `ollama` |
| `SDD_EMBEDDING_MODEL` | Provider model name |
| `VOYAGE_API_KEY` or `OLLAMA_URL` | Provider credentials or endpoint |
| `SDD_LISTEN` | Host and port for Streamable HTTP |
| `SDD_TOKEN_BUDGET` | Default pack budget |

`sdd-orchestrator --stdio` runs the same server over standard input against
whatever database the environment names.

### 11.2 Client setup

A workspace commits `.sdd/config.json` (server URL, app slug, display identity
source) and, once routed, `.sdd/feature.json` on the feature branch (feature id,
framework, phase at last sync). Any host or teammate resumes from those files.

### 11.3 Security posture

Stated plainly for v1:

- There is no authentication. The server must be reachable only on a trusted
  network. Display identity is attribution, not a control.
- Knowledge writes happen only through the CLI. An untrusted client on the
  network can create features and proposals but cannot alter standards or
  memory.
- Proposal bodies and artifact text are untrusted input. The server stores
  them, never executes them, and never feeds them into routing rules.
- Retrieved chunks are wrapped with provenance so hosts can treat them as data.
- Tool results never contain secrets. The server holds only the embedding key.

### 11.4 Failure handling

| Condition | Behaviour |
|---|---|
| Database unavailable | Clear error, no partial writes; every transition and ingestion is one transaction |
| Embedding provider down | Degraded pack (section 9.4), call succeeds; `search_memory` returns exact-id matches only with a warning |
| Unknown app or feature | `APP_NOT_FOUND` or `FEATURE_NOT_FOUND` |
| Illegal phase move | `PHASE_ORDER_VIOLATION` with the allowed targets |
| Gate failure | `GATE_FAILED` with findings; state unchanged |

## 12. Packs and ingestion

### 12.1 Pack format

A pack is a directory containing `pack.yaml` and Markdown files.

```yaml
# pack.yaml
name: openspec
kind: framework_pack
framework: openspec
version: 1.0.0
source_url: https://github.com/Fission-AI/OpenSpec
license: MIT
```

```markdown
---
id: openspec.template.delta-spec
kind: framework_pack
framework: openspec
phases: [specify]
stack_tags: []
title: Delta spec template
supersedes: null
---
## ADDED Requirements
...
```

Framework packs additionally declare the phase mapping and gate checks in
`pack.yaml` under `phases:` and `gates:`.

Chunking splits on headings with a cap of about five hundred tokens per chunk.

### 12.2 Seed packs shipped in `packs/`

- `openspec`, `spec-kit`, `bmad`: templates, command vocabulary, phase mapping
  and gates, ingested from MIT sources with attribution.
- `kiro`: templates written for this project in Kiro's three-document structure
  and EARS notation. No proprietary text is copied.
- `sdlc`: the house flow (PRD, scoping doc, jot down, task breakdown,
  implement-task) with its existing validation gates.
- `quality-layer`: Osmani's agent-skills, attached to every decision.
- `stack-guides`: the plugin's domain skills (Go, React, Node, frontend design,
  web design audit), tagged by stack.

### 12.3 CLI

| Command | Effect |
|---|---|
| `sdd-admin app register <slug> --name ... [--compliance]` | Create an app |
| `sdd-admin app set-policy <slug> <policy.json>` | Set routing overrides |
| `sdd-admin app list` | List apps |
| `sdd-admin ingest <dir>` | Validate, version, chunk and embed a pack. Changed files become a new version; unchanged files are skipped by hash |
| `sdd-admin deprecate <stable_id> [--successor <id>] --reason ...` | Retire an item |
| `sdd-admin proposals list \| approve <id> \| reject <id> --reason ...` | Review agent proposals |
| `sdd-admin reindex` | Re-embed all chunks after a provider or model change |

Ingestion refuses a pack with duplicate ids, missing required front matter, or
a framework the engine does not know. Nothing is written until the whole pack
validates.

## 13. Testing

- **Router**: one unit test per rule, plus conflict, unknown-signal and
  preference-contradiction cases. Pure, no database.
- **Gate checks**: passing and failing artifacts for every check, including
  the measurable-criteria detector and OpenSpec delta validation.
- **Assembler**: ordering, trimming priority, deduplication, exact-id inclusion,
  degraded mode.
- **Integration** against Postgres in Docker: ingestion versioning and
  supersession, deprecation leaving retrieval, proposal approval, a full
  feature lifecycle from route to archive with transitions recorded, and
  backward moves.
- **Contract** tests through the MCP SDK client over both transports: tool
  schemas, error codes, and every instruction-bearing tool returning its text
  inline.
- **Host verification**: a scripted walkthrough of one OpenSpec feature and one
  Spec Kit feature in Claude Code and in Cursor, kept as a checklist under
  `docs/verification/`.

## 14. Follow-ups (out of scope for v1)

- Authentication (bearer tokens, then OAuth) behind an identity interface.
- LLM router fallback behind the router interface for cases rules leave at
  medium confidence.
- Adapting the `sdlc` plugin to consume the server instead of its own
  domain-skills table.
- Automatic ingestion from app repositories on merge.
- An AIUP pack, once source material is available.
- Kiro IDE verification.
- RTM generation from feature transitions and evidence.
- Server-side agent execution of any kind.

## 15. Relationship to the previous draft

Kept: the SDD philosophy and maturity levels, the Kiro, Spec Kit and house
pipeline patterns, the placeholder gate, the three-cycle limit and the
requirement trace fields.

Changed: routing is rule-based with retrieval after the decision, not vector
similarity; OpenSpec and BMAD are added and AIUP is deferred for lack of a
source; the verification pipeline of the old section 5 is recognised as the
existing `sdlc` plugin's job and is out of scope here; Resources, Prompts, data
model, ingestion, deprecation, deployment and security are specified; numeric
citations are replaced by named sources.
