# SDD Orchestrator: Design Specification

**Status:** Draft for review (revision 2, after adversarial review)
**Date:** 2026-09-10
**Supersedes:** the v1.0.0 draft `sdd_orchestrator_spec.md`, preserved in commit 0aacf55

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
- Hold knowledge for many apps in one store, with app memory (architecture
  decision records, decisions, constraints, incidents) scoped per app and
  cross-app lookup as an explicit action.
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
  at the start and end; retrieved material belongs in the middle. Always-on
  content must be limited to constraints every session needs, one per entry,
  with its reason.
- Tool descriptions are paid for on every turn, so the tool surface must stay
  small, and every description must say what the tool does, when to use it and
  what it returns.
- Spec review is the highest-leverage human checkpoint, and a deterministic
  path gate for risky files must never be overridable by automation.
- Policies should be versioned and reviewed. Durkin et al. note that policy as
  code gives "directional input to the AI as to what we want, and protection
  ensuring that the output of the AI is in compliance", and that policies can
  signal deprecation of templates.
- Tactical artifacts (spec, plan, tasks) are archived after merge. Living
  memory is the strategic tier: constitution, decisions, constraints. Link to
  archived specs, do not duplicate them.
- Neither source describes AIUP. The term "context pack" appears in neither
  book and is defined in section 9.

### 4.1 Terms

| Term | Meaning |
|---|---|
| Framework | A named SDD workflow with its own artifacts and commands: OpenSpec, Spec Kit, BMAD, Kiro, or the `sdlc` house flow |
| House flow | The workflow of the TextraAI `sdlc` plugin: PRD, scoping doc, jot down (a short technical design note), task breakdown, implement-task |
| Quality layer | Addy Osmani's `agent-skills` (MIT): process skills such as test-driven development, code review and security hardening, attached to every decision |
| Stack guide | A language or framework engineering standard, for example the plugin's Go, React and Node guides |
| App | One software product the company develops; the unit of memory scoping |
| Feature | One unit of work routed by the server, bound to a workspace branch |
| Context pack | Defined in section 9 |

## 5. Architecture

One TypeScript service on Node 22, `sdd-orchestrator`, packaged as a Docker
image, plus an admin CLI, `sdd-admin`. Postgres 16 with pgvector 0.8 or later
is the only stateful dependency. MCP is exposed over Streamable HTTP for shared
use and over stdio for local development and tests.

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
                    approve, register apps, set policy)
```

### 5.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| MCP surface | Register tools, resources, prompts; validate input; map errors to codes | Router, lifecycle engine, assembler |
| Router | Pure function from task signals and the known-framework list to a routing decision | Nothing (no I/O) |
| Lifecycle engine | Feature state, phase transitions, gate checks on artifact text | Knowledge store (for framework pack declarations) |
| Knowledge store | Repository over Postgres for items, versions, chunks, proposals, apps, policies, features, packs | Embedding provider |
| Context assembler | Retrieve, order and budget content into a context pack | Knowledge store |
| Ingestion CLI | Validate and load packs; manage apps, policies, proposals, deprecation, reindex | Knowledge store |

Each unit is testable alone. The router and gate checks are pure. Framework
knowledge lives in packs. The set of known frameworks is the set of ingested
`framework_pack` items, so adding a framework means ingesting a pack, not
changing the engine.

### 5.2 Main call flow

1. Host calls `route_task` with the task description, app slug, actor and
   workspace facts.
2. MCP surface validates input and loads the app and its current policy.
3. Router produces a decision: framework (or `none` for spikes), track,
   confidence, rule, reasons, high-risk flag, and clarifying questions when
   confidence is medium.
4. If confidence is `high`, or the host passed `confirm: true`, the lifecycle
   engine creates a feature in phase `specify`, pinned to the current version
   of the chosen framework pack. If the decision is `none`, or confidence is
   `medium` without `confirm`, no feature is created.
5. If a feature was created, the assembler builds and persists the context pack
   for `specify`.
6. Surface returns the decision, the feature id and pack when present, the
   questions when present, and any warnings.

Resume never goes through the router. A host resumes with `get_context` or
`get_feature_status` using the feature id from `.sdd/feature.json`.

## 6. Data model

All tables carry `id`, `created_at`, `updated_at` and `created_by`. `created_by`
is the display identity from the `actor` parameter (section 11.3).

| Table | Columns | Notes |
|---|---|---|
| `apps` | slug, name, default_stack text[], compliance bool, token_budget int null, stop_conditions text[] | Unit of app memory. `stop_conditions` are appended to position 6 of every pack for this app |
| `app_policies` | app_id, version, policy jsonb, actor, reason | Append-only. The current policy is the highest version. `policy` holds `{framework}` and optional `path_rules: [{glob, framework}]` |
| `frameworks` | name, pack_version, phases jsonb, gates jsonb, status (active, deprecated) | One row per ingested framework pack version. The router's known-framework list is the active rows |
| `features` | app_id, slug, framework, framework_pack_version, track, current_phase, status (active, blocked, archived), blocked_reason, high_risk bool, failed_cycles int, policy_version, source_task text, decision jsonb | One row per routed feature. Bound to a workspace by `.sdd/feature.json` |
| `context_packs` | feature_id, phase, items jsonb ([{stable_id, version}]), token_count, budget, degraded bool, over_budget bool | One row per assembled pack. `advance_phase` references the pack it was working from |
| `phase_transitions` | feature_id, from_phase, to_phase, direction (forward, backward), result (pass, fail), findings jsonb, evidence jsonb, pack_id null, artifact_hashes jsonb, human_approved bool, reason, actor | Audit trail of every gate run |
| `feature_artifacts` | transition_id, name, sha256, byte_length, content text | Artifact text as submitted, capped at 256 KB per artifact. Larger artifacts store hash and length only |
| `knowledge_items` | stable_id, version int, kind, tier (always_on, retrieved), framework text null, app_id null, memory_type null, stack_tags text[], phase_tags text[], title, body, front_matter jsonb, pack_name, pack_version, status (active, deprecated, pending), superseded_by, deprecation_reason, source_path, source_hash, source_url, license | Immutable once active. Changes create a new version. `framework` null means the item applies to every framework |
| `knowledge_chunks` | item_id, ordinal, heading_path, text, embedding vector(1024), embedding_model, token_count, tokenizer | One row per section, hard cap 512 tokens |
| `proposals` | app_id, feature_id, payload jsonb, status (pending, approved, rejected), reviewed_by, review_reason | Approval copies payload into `knowledge_items` as a new active item |

`kind` is one of `framework_pack`, `standard`, `stack_guide`, `app_memory`.
`memory_type`, required when `kind` is `app_memory`, is one of `adr`,
`decision`, `constraint`, `incident`. Accepted specs are not ingested as memory;
an `adr` or `decision` links to the archived spec by path or ticket id.

A `standard` with `app_id` null is a company standard. A `standard` with an
`app_id` is that app's steering rule set. Only `standard` items may be
`always_on`.

Rules:

- An `app_memory` item belongs to exactly one app. Cross-app retrieval happens
  only through the explicit `scope` parameter of `search_memory` and
  `get_context`.
- An active item is never edited. Re-ingesting a changed file creates version
  n+1 and sets `superseded_by` on version n. A file removed from a pack on
  re-ingest produces a warning and no change.
- Deprecated items stay in the database, leave default retrieval, and remain
  resolvable by id so a feature's history stays readable.
- Every context pack records the item ids and versions it contained, and every
  transition records the pack it was working from, so a feature routed earlier
  can show which standards it was held to.
- A feature is pinned to the framework pack version current at routing. Gate
  declarations and phase templates come from that version until the feature is
  archived. A backward move may re-pin to the current version when the host
  passes `repin: true`.

## 7. MCP surface

Six developer-facing tools. Admin operations are CLI only (section 12.4),
which keeps the tool list small and keeps knowledge writes off the network
path.

Every description states what the tool does, when to use it and what it
returns, and includes one example call. Every tool that returns instructions
returns them as plain text inside the result, because Cursor's support for the
Prompts primitive lags behind Tools. Every successful result may carry a
`warnings[]` list.

All mutating tools take `actor` (string, required): the display identity the
host read from `.sdd/config.json`. It is attribution only (section 11.3).

### 7.1 Tools

**`route_task`**

| Input | Type | Notes |
|---|---|---|
| `task_description` | string, required | |
| `app` | slug, required | |
| `actor` | string, required | |
| `workspace` | object, required | See below |
| `framework_preference` | string, optional | Validated against active frameworks at call time |
| `confirm` | bool, default false | Create the feature even at medium confidence |
| `feature_slug` | string, optional | Defaults to a slug derived from the task description |

`workspace` fields, all optional, null meaning unknown: `stack` string[],
`intent` (`feature`, `spike`, `product`, `auto`), `is_greenfield` bool,
`has_spec_library` bool, `estimated_files` int, `paths_touched` string[],
`repositories` int, `new_subsystem` bool, `host` string. Section 8.3 states how
a host derives them.

| Output | Notes |
|---|---|
| `decision` | `{framework or "none", track or null, confidence: high or medium, rule, reasons[], high_risk, policy_version}` |
| `feature_id` | Present only when a feature was created |
| `context_pack` | Present only when a feature was created |
| `pack_id` | Present with `context_pack` |
| `clarifying_questions[]` | At most three, present at medium confidence |
| `guidance` | Prototype-first guidance text when `framework` is `none` |
| `attached_layers[]` | `[{stable_id, version, kind}]` for quality layer and stack guides |
| `next_instructions` | Tells the host to write `.sdd/feature.json` and what to do in `specify` |

**`get_context`**

| Input | Notes |
|---|---|
| `feature_id` | required |
| `actor` | required |
| `phase` | optional, defaults to current |
| `focus` | optional query string to steer retrieval |
| `scope` | `"app"` (default), `"company"`, or slug[] for cross-app memory |

Returns `context_pack`, `pack_id`, `feature` state.

**`advance_phase`**

| Input | Notes |
|---|---|
| `feature_id`, `actor` | required |
| `expected_phase` | required; must equal the current phase or the call fails with `STALE_STATE` |
| `target_phase` | required |
| `artifacts` | map name to content; the pack declares which names a transition needs |
| `evidence` | object, verify transitions only; schema in section 10.4 |
| `human_approved` | bool |
| `cycle_failed` | bool; the host reports one failed implement-verify correction cycle |
| `pack_id` | optional; defaults to the latest pack for this feature and phase |
| `reason` | required for backward moves |
| `repin` | bool, backward moves only |

Returns `result` (`pass` or `fail`), `findings[]` `{check, severity: blocker or
warning, location, message}`, `next_instructions` (on pass), `feature` state.
A gate failure is a normal result, not an error. Findings of severity `warning`
do not fail the transition.

**`search_memory`**

| Input | Notes |
|---|---|
| `query` | required |
| `app` | slug, required; the referent for scope `app` |
| `scope` | `"app"` (default), `"company"`, or slug[] |
| `kinds[]` | default all |
| `limit` | default 8 |

Returns `chunks[]` `{item_id, stable_id, version, app, kind, memory_type,
heading_path, text, score, match: vector or exact_id}`.

**`propose_memory`**

Input: `feature_id`, `actor`, `kind` (`app_memory` or `standard`),
`memory_type` (required for `app_memory`), `title`, `body`, `stack_tags[]`,
`links[]` (paths or ticket ids to archived artifacts). Returns `proposal_id`,
`status`.

**`get_feature_status`**

Input: `feature_id`. Returns framework, framework_pack_version, track,
current_phase, status, blocked_reason, high_risk, failed_cycles, transitions[]
(summaries), latest pack id per phase.

### 7.2 Resources

Read-only, addressed by URI. They exist for hosts that support browsing; every
value is also reachable through a tool.

- `sdd://apps/{slug}`: app profile, current policy version, always-on standards.
- `sdd://features/{id}`: feature state and transition summaries.
- `sdd://frameworks/{name}`: framework pack summary: phases, artifacts, gates.
- `sdd://knowledge/{stable_id}`: current version of one item.
- `sdd://knowledge/{stable_id}/v/{version}`: a specific version.

There is no per-phase context resource; `get_context` is the single path to a
pack.

### 7.3 Prompts

One prompt per abstract phase: `sdd.specify`, `sdd.plan`, `sdd.tasks`,
`sdd.implement`, `sdd.verify`, `sdd.integrate`, `sdd.learn`. Each takes
`feature_id` and returns exactly what `get_context` returns for that phase.
They are thin wrappers so hosts that expose prompts as slash commands can offer
them; they are never the only path.

### 7.4 Error codes

Errors are reserved for precondition and protocol failures. Gate failures and
degraded retrieval are normal results with `findings` or `warnings`.

| Code | When | Applies to |
|---|---|---|
| `APP_NOT_FOUND` | Unknown app slug | any |
| `FEATURE_NOT_FOUND` | Unknown feature id | any |
| `UNKNOWN_FRAMEWORK` | Preference names no active framework | `route_task` |
| `STALE_STATE` | `expected_phase` differs from the current phase | `advance_phase` |
| `PHASE_ORDER_VIOLATION` | Target phase not reachable from the current one under the pinned pack; allowed targets attached | `advance_phase` |
| `FEATURE_BLOCKED` | Feature is blocked; reason attached | forward `advance_phase` only. Reads, backward moves and `propose_memory` remain allowed |
| `FEATURE_ARCHIVED` | Feature is archived | any mutation |
| `EMBEDDING_MODEL_MISMATCH` | Configured embedding model differs from the stored one; points to `sdd-admin reindex` | any retrieval |
| `VALIDATION_ERROR` | Input schema violation, with field path | any |

Each error carries a human-readable message so the host can act instead of
guessing.

## 8. Router

The router is a pure function of the task signals, the app's current policy
and the active framework list. It evaluates rules in priority order and stops
at the first rule that fires. The decision records the rule name and the
signals used.

### 8.1 Signals

| Signal | Derivation |
|---|---|
| App policy | Current `app_policies` row: `framework`, or the first `path_rules` glob matching any `paths_touched` |
| Explicit preference | `framework_preference` |
| Intent | `workspace.intent` if not `auto`; else `spike` when the task text matches the spike phrase list, `product` when it matches the product phrase list, else `feature`. Both lists are server configuration with defaults (`can we`, `prototype`, `spike`, `is it possible`; `whole product`, `new product`, `epic`, `PRD`) |
| Greenfield | `is_greenfield`; if null, `not has_spec_library`; if both null, unknown |
| Size | `small`: `estimated_files` at most 3 and all `paths_touched` share one top-level directory. `large`: `estimated_files` at least 20, or `repositories` at least 2, or `new_subsystem` true. Else `medium`. Unknown when `estimated_files` is null and `new_subsystem` is not true |
| Risk paths | Any `paths_touched` matching the risk list. Default list: `**/payments/**`, `**/billing/**`, `**/auth/**`, `**/*crypto*`, `**/migrations/**`, `infra/**`, `**/*.tf`, `.github/workflows/**`. Apps may extend it in policy |
| Compliance | `apps.compliance` |

Risk does not change the framework. It sets `high_risk` on the feature, which
forces human approval at `verify` to `integrate` (section 10.3).

### 8.2 Rules

| Order | Condition | Decision |
|---|---|---|
| 1 | Policy names a framework, or a path rule matches | That framework, confidence high |
| 2 | Explicit preference | That framework, confidence high, with a warning in `reasons` if rules 3 to 9 would differ |
| 3 | Intent `spike` | `none`. Return prototype-first guidance; no feature |
| 4 | Intent `product` | `sdlc` house flow, starting at PRD |
| 5 | Size large and (compliance or `new_subsystem`) | BMAD. Track `quick` when `estimated_files` is at most 15 and compliance is false, else `full` |
| 6 | Brownfield and size small or medium | OpenSpec |
| 7 | Greenfield and size small or medium | Spec Kit |
| 8 | Size large | Spec Kit |
| 9 | Greenfield status or size unknown | Confidence medium. Candidate OpenSpec when `has_spec_library` is true, else Spec Kit. Up to three clarifying questions asking for the missing facts |

Kiro is routed only by rules 1 and 2, since its workflow assumes its IDE. Its
EARS requirement patterns are ingested as a `standard` with `framework` null
and `phase_tags: [specify]`, so every framework's specify phase retrieves them.

`track` is null for every framework except BMAD.

If rule 1 or 2 names a framework whose pack is deprecated, the call fails with
`UNKNOWN_FRAMEWORK`.

### 8.3 Deriving workspace facts

The host supplies workspace facts. The `route_task` description and a client
helper script in `docs/verification/` state the derivations so different hosts
produce the same signals:

- `has_spec_library`: any of `openspec/`, `specs/`, `.specify/`,
  `_bmad-output/`, `.kiro/specs/`, `.sdlc/` exists in the workspace.
- `is_greenfield`: the repository has fewer than 20 commits, or
  `.sdd/config.json` sets `greenfield: true`.
- `estimated_files`, `paths_touched`, `new_subsystem`: the host agent's own
  estimate, flagged as an estimate in the reasons.
- `repositories`: the number of configured repositories the task names.

Any null fact is unknown and lowers confidence per rule 9.

## 9. Context assembly

A **context pack** is the ordered, budgeted block of text returned for one
feature in one phase. Material that must never be forgotten sits at the start
and the end; retrieved material sits in the middle.

### 9.1 Order

| Position | Content | Source | Trimmable |
|---|---|---|---|
| 1 | Header: feature id, framework, phase, instruction block for this phase | Framework pack, pinned version | No |
| 2 | Always-on standards: company constitution and the app's steering rules, one constraint per line with its reason | `standard` items with `tier: always_on`, company then app | No |
| 3 | Phase template, verbatim | Framework pack, pinned version | No |
| 4 | Retrieved knowledge: chunks from app memory, retrieved standards and the quality layer, filtered and ranked per 9.2, each with stable id, version and heading path. Cross-app chunks only when `scope` asks | Retrieval | Yes, second |
| 5 | Stack guide sections retrieved by the task query, never whole files | Retrieval, `stack_guide` kind | Yes, first |
| 6 | Stop conditions and the next gate: the four default stop conditions (ambiguity between valid approaches, three failed fix attempts, existing behaviour contradicting acceptance criteria, irreversible data changes) plus `apps.stop_conditions`, then the checks the next `advance_phase` will run | Engine | No |

### 9.2 Retrieval

1. Metadata filter: `status = active`, `app_id` in scope or null, `framework
   = feature.framework or null`, `phase_tags` contains the phase, `kind` in
   the kinds for the position.
2. Vector search: cosine distance on `knowledge_chunks.embedding` with an HNSW
   index, 12 candidates, minimum similarity 0.35 (per-app override). pgvector
   0.8 iterative scan (`hnsw.iterative_scan = relaxed_order`) so filtered
   queries do not under-return.
3. Exact identifier match: any token in the query or task matching
   `\b(ADR|REQ|US|INC)-\d+\b` is matched against `stable_id`, `title` and
   chunk text via a trigram index. Exact hits rank ahead of vector hits.
4. Deduplicate by item, keeping the best chunk per item, then take the top 8.

The query text is the `focus` parameter when present, else the feature's
`source_task`. Voyage requests use `input_type: document` at ingestion and
`input_type: query` at retrieval; Ollama has no such distinction.

### 9.3 Budget and tokens

Token counts are estimates of host-model tokens made with one fixed counter,
`cl100k_base` through `js-tiktoken`, stored per chunk with the tokenizer name.
The budget defaults to 6,000 tokens, overridable per app. Trimming drops stack
guide chunks first, then retrieved knowledge chunks lowest score first, and
never positions 1, 2, 3 or 6. If those four positions alone exceed the budget
the pack is returned in full with `over_budget: true` and a warning.

Ingestion warns when an app's always-on standards exceed 1,200 tokens or when
any single phase template exceeds half the default budget.

### 9.4 Degraded mode

When the embedding provider is unavailable the assembler builds positions 4 and
5 from metadata filters and exact-id matches only, sets `degraded: true`, adds
a warning, and the call succeeds. `search_memory` behaves the same way.

## 10. Lifecycle and gates

### 10.1 Abstract phases

Every framework is mapped onto one loop: `specify`, `plan`, `tasks`,
`implement`, `verify`, `integrate`, `learn`. The engine reasons only about these
phases. `specify`, `implement`, `verify` and `integrate` are mandatory. A pack
may declare `plan`, `tasks` or `learn` as `skipped`, and a transition then
lands on the next non-skipped phase. Completing `integrate` moves to `learn`
when the pack has it, else to `archived`. Completing `learn` archives.

Every pack must map all seven phases explicitly; ingestion rejects a pack that
does not.

| Framework | Mapping |
|---|---|
| OpenSpec | `propose` covers specify, plan and tasks in one transition (plan and tasks skipped as separate stops); `apply` is implement; `verify` plus `sync` are verify; `archive` is integrate; learn skipped |
| Spec Kit | constitution is an always-on standard, not a phase; specify (with clarify), plan, tasks (with analyze), implement map one to one; verify is the local harness plus checklist; integrate is the pull request; reconcile is learn |
| BMAD | Quick track: quick-spec covers specify through tasks; quick-dev is implement; code-review is verify; integrate is the pull request; learn skipped. Full track: PRD and architecture are specify; epics and stories are plan and tasks; dev-story is implement; code-review is verify; integrate is the pull request; retrospective is learn |
| Kiro | requirements is specify, design is plan, tasks is tasks; implement, verify and integrate use the Kiro pack's own generic templates; learn skipped |
| sdlc house flow | PRD and scoping doc are specify; jot down is plan; task breakdown is tasks; implement-task covers implement and verify; integrate is the pull request; retrospective is learn |

### 10.2 Gate check library

Packs declare which checks run at which transition, with parameters. The
library is deterministic and the server never fills in missing content.

| Check | Parameters | Verifies |
|---|---|---|
| `placeholder_scan` | `markers[]` (default `TBD`, `TODO`, `NEEDS HUMAN INPUT`, `OQ-\d+`) | No marker present in any submitted artifact |
| `required_sections` | `artifact`, `sections[]` | Each heading present and non-empty |
| `measurable_criteria` | `artifact`, `section`, `adjectives[]` (default list in code, extendable) | No criterion contains a listed adjective without a number or unit in the same line |
| `task_done_checks` | `artifact`, `task_regex`, `done_regex` | Every task match has a done-check match |
| `task_ordering` | `artifact`, `task_regex`, `dep_regex` | No task depends on a later task |
| `delta_markers` | `artifact` | OpenSpec ADDED, MODIFIED, REMOVED sections valid; every REMOVED entry has Reason and Migration |
| `verify_evidence` | `max_new_high` (default 0) | Section 10.4 rules |
| `scope_drift` | `plan_artifact`, `files_section` | Files changed outside the plan's files list produce a `warning` finding |
| `human_approved` | none | `human_approved` was true; stored with actor |

Severity is `blocker` unless the pack marks a check `warning`. `scope_drift`
defaults to `warning`.

### 10.3 Transitions

- `advance_phase` locks the feature row (`SELECT ... FOR UPDATE`), compares
  `expected_phase`, checks reachability under the pinned pack, runs the
  declared checks on the submitted artifacts, and records the transition,
  artifact hashes and artifact text in one transaction. A failed gate records a
  `fail` transition and leaves `current_phase` unchanged.
- The engine mandates `human_approved` on the first forward transition out of
  `specify` for every framework, because spec review is the highest-leverage
  checkpoint. Packs may require it elsewhere. When `high_risk` is true the
  engine also mandates it on `verify` to `integrate`.
- Backward moves are allowed with a recorded reason and reset `failed_cycles`.
- `cycle_failed: true` increments `failed_cycles`. Gate failures do not count.
  When `failed_cycles` reaches 3 the feature becomes `blocked` with the reason
  from the call. Unblocking is a backward move.
- Completing `integrate` and, when present, `learn` sets status `archived`.
- `next_instructions` always tells the host to update `.sdd/feature.json`.

### 10.4 Verify evidence

```json
{
  "tests":    { "command": "npm test", "passed": 42, "failed": 0 },
  "lint":     "pass",
  "security": { "status": "pass", "new_high": 0, "skipped_reason": null },
  "files_changed": ["src/api/export.ts", "src/api/export.test.ts"],
  "implements": ["REQ-03", "US-02"],
  "cycle": 1
}
```

`verify_evidence` passes when `tests.failed` is 0, `lint` is `pass`, and
`security.new_high` is at most `max_new_high` or `security.status` is
`skipped` with a reason. A skipped scan adds a `warning` finding. The server
records evidence as given and never infers a result from an absent field; a
missing field is a `blocker`.

## 11. Deployment, configuration and security

### 11.1 Deployment

`docker-compose.yml` starts Postgres with pgvector and the server. Schema
migrations run with `node-pg-migrate` on startup. Environment variables:

| Variable | Purpose |
|---|---|
| `SDD_DATABASE_URL` | Postgres connection |
| `SDD_EMBEDDING_PROVIDER` | `voyage` (default), `ollama`, or `fake` (tests only, deterministic vectors) |
| `SDD_EMBEDDING_MODEL` | Provider model name. Vectors are fixed at 1,024 dimensions; Voyage `voyage-3` family and Ollama `mxbai-embed-large` or `bge-m3` qualify. Other models are refused at startup |
| `VOYAGE_API_KEY` or `OLLAMA_URL` | Provider credentials or endpoint |
| `SDD_LISTEN` | Host and port for Streamable HTTP; defaults to a loopback or private interface |
| `SDD_ALLOWED_HOSTS` | Host header allowlist for DNS-rebinding protection |
| `SDD_TOKEN_BUDGET` | Default pack budget |

Streamable HTTP runs in stateless mode: no in-memory session state, no
resource subscriptions, so the server can be replicated behind a load balancer.
`sdd-orchestrator --stdio` runs the same server over standard input against
whatever database the environment names.

`GET /healthz` reports database and embedding provider reachability.

### 11.2 Client setup

A workspace commits `.sdd/config.json` (server URL, app slug, actor name and
email, optional `greenfield: true`) and, once routed, `.sdd/feature.json` on
the feature branch (feature id, framework, phase at last sync). The server is
authoritative; `.sdd/feature.json` is a cache the host rewrites after every
`advance_phase`, and `STALE_STATE` tells the host when it has fallen behind.

### 11.3 Security posture

Stated plainly for v1:

- There is no authentication. The server must be reachable only on a trusted
  network, binds to a private interface by default, and validates the Host
  header against `SDD_ALLOWED_HOSTS`. `actor` is attribution, not a control.
- Knowledge writes happen only through the CLI. An untrusted client on the
  network can create features, transitions and proposals but cannot alter
  standards, memory or policy.
- Proposal bodies and artifact text are untrusted input. The server stores
  them, never executes them, and never feeds them into routing rules.
- Retrieved chunks are wrapped with provenance so hosts can treat them as data.
- Tool results never contain secrets. The server holds only the embedding key.

### 11.4 Failure handling

| Condition | Behaviour |
|---|---|
| Database unavailable | Clear error, no partial writes; every transition is one transaction |
| Embedding provider down | Degraded pack (section 9.4), call succeeds with a warning |
| Embedding model changed | `EMBEDDING_MODEL_MISMATCH` until `sdd-admin reindex` completes |
| Concurrent transitions | Row lock serialises them; the loser gets `STALE_STATE` |
| Illegal phase move | `PHASE_ORDER_VIOLATION` with the allowed targets |
| Gate failure | Normal `fail` result with findings; state unchanged |

### 11.5 Observability

Structured JSON logs with feature id, app, tool, rule and duration. Counters
for routing decisions by rule, gate results by check, degraded packs,
over-budget packs and failed cycles, exposed on `GET /metrics` in Prometheus
format. These are the only way to know whether the router and gates are doing
useful work.

## 12. Packs and ingestion

### 12.1 Pack format

A pack is a directory containing `pack.yaml` and Markdown files.

```yaml
# pack.yaml
name: openspec
kind: framework_pack
framework: openspec
version: 1.0.0            # pack version, recorded on every item as pack_version
source_url: https://github.com/Fission-AI/OpenSpec
license: MIT
phases:                   # framework packs only; all seven required
  specify:   { command: "/opsx:propose", template: openspec.template.proposal }
  plan:      skipped
  tasks:     skipped
  implement: { command: "/opsx:apply",   template: openspec.template.apply }
  verify:    { command: "/opsx:verify",  template: openspec.template.verify }
  integrate: { command: "/opsx:archive", template: openspec.template.archive }
  learn:     skipped
gates:                    # framework packs only
  - transition: specify->implement
    checks:
      - { name: placeholder_scan }
      - { name: required_sections, params: { artifact: proposal.md, sections: [Why, What Changes, Impact] } }
      - { name: delta_markers, params: { artifact: specs } }
      - { name: task_done_checks, params: { artifact: tasks.md, task_regex: "^- \\[ \\] ", done_regex: "\\*\\*Done when:\\*\\*" } }
  - transition: verify->integrate
    checks:
      - { name: verify_evidence }
      - { name: scope_drift, params: { plan_artifact: proposal.md, files_section: Impact }, severity: warning }
```

```markdown
---
id: openspec.template.proposal        # becomes knowledge_items.stable_id
kind: framework_pack
tier: retrieved
framework: openspec
phases: [specify]                     # becomes phase_tags
stack_tags: []
title: Proposal template
supersedes: null                      # stable_id of an item this one replaces; ingestion sets superseded_by on it
---
## Why
...
```

Front matter names map to schema columns as commented. The per-item integer
`version` is assigned by ingestion and is unrelated to the pack's semantic
version.

### 12.2 Chunking

Split on H2 headings; split an H2 section on H3 when it exceeds the cap; then
on paragraphs. Hard cap 512 tokens, no overlap. Never split inside a fenced
code block or a table. The embedded text is `title > heading path` followed by
the chunk text, and `heading_path` stores the full path so a heading like
"Rationale" stays retrievable.

### 12.3 Seed packs shipped in `packs/`

Seed packs contain templates only for the phases they map, not full upstream
distributions.

- `openspec`, `spec-kit`, `bmad`: templates, command vocabulary, phase mapping
  and gates, adapted from their MIT sources with attribution.
- `kiro`: templates written for this project in Kiro's three-document structure
  and EARS notation. No proprietary text is copied. The EARS patterns ship as a
  framework-null standard.
- `sdlc`: the house flow with templates for PRD, scoping doc, jot down and task
  breakdown so a host without the plugin can still follow it, plus its existing
  validation gates.
- `quality-layer`: Osmani's agent-skills (MIT), `tier: retrieved`, attached to
  every decision.
- `stack-guides`: the plugin's domain skills (Go, React, Node, frontend design,
  web design audit), tagged by stack. These derive from
  `antigravity-awesome-skills`; its license must be confirmed before the pack is
  published.
- `company`: an example always-on constitution showing the one-constraint-per-
  line-with-reason shape.

### 12.4 CLI

| Command | Effect |
|---|---|
| `sdd-admin app register <slug> --name ... [--compliance]` | Create an app |
| `sdd-admin app set-policy <slug> <policy.json> --reason ...` | Append a new policy version |
| `sdd-admin app add-stop-condition <slug> "<text>"` | Append an app stop condition |
| `sdd-admin app list` | List apps with current policy version |
| `sdd-admin ingest <dir>` | Validate the whole pack, embed in batches, then write in one transaction. Changed files become a new version; unchanged files are skipped by hash; removed files warn |
| `sdd-admin deprecate <stable_id> [--successor <id>] --reason ...` | Retire an item; for a framework pack, also marks the framework deprecated |
| `sdd-admin proposals list \| approve <id> \| reject <id> --reason ...` | Review agent proposals |
| `sdd-admin reindex` | Re-embed all chunks with the configured model, then clear the mismatch state |

Ingestion refuses a pack with duplicate ids, missing required front matter, a
framework pack missing any of the seven phases, a gate naming an unknown check,
or an `always_on` item that is not a `standard`. Nothing is written until the
whole pack validates and all embeddings are computed.

## 13. Testing

- **Router**: one unit test per rule, plus conflict, unknown-signal,
  preference-contradiction, deprecated-framework and policy path-rule cases.
  Pure, no database.
- **Gate checks**: passing and failing artifact fixtures for every check under
  each seed pack's parameters, including the measurable-criteria detector,
  OpenSpec delta validation and verify evidence with a skipped scan.
- **Assembler**: ordering, trimming priority, over-budget behaviour,
  deduplication, exact-id ranking, framework-null inclusion, degraded mode.
  Uses the `fake` embedding provider.
- **Integration** against Postgres in Docker: ingestion versioning,
  supersession and removed-file warning; deprecation leaving retrieval;
  proposal approval; policy versioning; a full feature lifecycle from route to
  archive for every seed pack with transitions, packs and artifacts recorded;
  backward moves and repin; concurrent `advance_phase` producing one
  `STALE_STATE`; `failed_cycles` reaching blocked; embedding model mismatch.
- **Contract** tests through the MCP SDK client over both transports: tool
  schemas, error codes, warnings, and every instruction-bearing tool returning
  its text inline.
- **Host verification** under `docs/verification/`: a feature matrix of tools,
  resources and prompts against Claude Code and Cursor, the workspace-facts
  helper script, and a scripted walkthrough of one OpenSpec feature and one
  Spec Kit feature in each host.

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

Kept: the SDD philosophy, the Kiro, Spec Kit and house pipeline patterns, the
placeholder gate, the three-cycle limit, and requirement tracing through the
`implements` and `files_changed` evidence fields.

Changed: routing is rule-based with retrieval after the decision, not vector
similarity; OpenSpec and BMAD are added and AIUP is deferred for lack of a
source; the verification pipeline of the old section 5 is recognised as the
existing `sdlc` plugin's job and is out of scope here; Resources, Prompts, data
model, ingestion, deprecation, deployment and security are specified; numeric
citations are replaced by named sources.

Revision 2 changes after adversarial review: complete and validated phase
mappings with skippable phases; gate failure as a normal result; router table
without holes, compliance ahead of greenfield, risk as a flag rather than a
framework change; `actor` on every mutating call; persisted packs, artifacts,
policies and pack versions; engine-mandated spec review; numeric routing
thresholds and workspace-fact derivations; fixed embedding dimension, tokenizer,
chunking, retrieval parameters, concurrency control and observability.
