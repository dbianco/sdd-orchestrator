# SDD Orchestrator: Design Specification

**Status:** Draft for review (revision 5)
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
| Track | A variant of a framework with its own phase mapping and gates. v1 tracks: BMAD `quick` and `full`; OpenSpec `default`, `hotfix` and `refactor`; Spec Kit `default` and `refactor` |
| Intent | What kind of work a task is: `feature`, `product`, `spike`, `incident`, `remediation` or `refactor`. Supplied by the host or inferred from the task text |
| House flow | The workflow of the TextraAI `sdlc` plugin: PRD, scoping doc, jot down (a short technical design note), task breakdown, implement-task |
| Quality layer | Addy Osmani's `agent-skills` (MIT): process skills such as test-driven development, code review and security hardening, attached to every decision |
| Stack guide | A language or framework engineering standard, for example the plugin's Go, React and Node guides |
| App | One software product the company develops; the unit of memory scoping |
| Feature | One unit of work routed by the server, identified by `feature_id` |
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
| MCP surface | Register tools, resources, prompts; validate input; encode results and errors | Router, lifecycle engine, assembler |
| Router | Pure function from task signals, policy and the known-framework list to a routing decision | Nothing (no I/O) |
| Lifecycle engine | Feature state, phase transitions, reachability, gate checks on artifact text | Knowledge store (for framework declarations) |
| Knowledge store | Repository over Postgres for items, versions, chunks, proposals, apps, policies, features, frameworks, embedding config | Embedding provider |
| Context assembler | Retrieve, order and budget content into a context pack | Knowledge store |
| Ingestion CLI | Validate and load packs; manage apps, policies, proposals, deprecation, reindex | Knowledge store |

Each unit is testable alone. The router and gate checks are pure. Framework
knowledge lives in packs. The set of known frameworks is the set of current
`frameworks` rows, so adding a framework means ingesting a pack, not changing
the engine.

### 5.2 Main call flow

1. Host calls `route_task` with the task description, app slug and workspace
   facts. This call is read-only and may be repeated.
2. MCP surface validates input and loads the app and its current policy.
3. Router produces a decision: intent, framework (or `none` for spikes),
   track, confidence, rule, reasons, high-risk flag, and clarifying questions
   when confidence is medium.
4. Surface returns the decision, the questions when present, and any warnings.
   Nothing is written.
5. The host shows the decision to its user, answers any questions by calling
   `route_task` again with better facts, and then calls `start_feature` with
   the accepted decision. The lifecycle engine re-resolves the current
   framework version, policy version and track, and creates a feature in phase
   `specify` pinned to that version. `start_feature` is refused when the
   decision's framework is `none`.
6. The assembler builds and persists the context pack for `specify`, and
   `start_feature` returns the feature id, the pack and next instructions.

Resume never goes through the router. A host resumes with `get_context` or
`get_feature_status` using a feature id it kept (section 11.2).

## 6. Data model

All tables carry `id`, `created_at`, `updated_at` and `created_by`. `created_by`
is the display identity from the `actor` parameter for MCP writes, the
`--actor` flag for CLI writes, and the literal `prompt` for packs assembled
through the Prompts primitive (section 11.3).

| Table | Columns | Notes |
|---|---|---|
| `apps` | slug unique, name, default_stack text[], compliance bool, token_budget int null, min_similarity real null, stop_conditions text[] | Unit of app memory. Null `token_budget` and `min_similarity` mean the server defaults |
| `app_policies` | app_id, version, policy jsonb, reason | Append-only, unique on (app_id, version). The current policy is the highest version. `policy` holds `framework` (nullable), `path_rules: [{glob, framework}]`, `risk_paths: [glob]` (extends the default list). An app with no policy row behaves as `{framework: null}` with `policy_version` null |
| `frameworks` | name, pack_version, tracks jsonb, gate_library_version, status (active, deprecated) | Unique on (name, pack_version). `tracks` maps track name (or `default`) to `{phases, gates}`. The current version of a framework is its highest active `pack_version` |
| `embedding_config` | provider, model, dimension, reindexed_at | Single row, written by `ingest` and `reindex`, checked at startup and on every retrieval |
| `features` | app_id, slug, intent, framework, framework_pack_version, track, current_phase, status (active, blocked, archived), blocked_reason, high_risk bool, failed_cycles int, policy_version null, policy_override_reason null, source_task text, external_ref text null, trigger_ref text null, decision jsonb, workspace jsonb | Unique on (app_id, slug); a collision appends `-2`, `-3`. Created by `start_feature`. `external_ref` is the backlog ticket (Linear, Jira); `trigger_ref` is what caused the work (incident id, CVE, alert) |
| `context_packs` | feature_id, phase, scope jsonb, focus text null, items jsonb ([{stable_id, version}]), rendered text, token_count, budget, degraded bool, over_budget bool | One row per assembled pack. `rendered` is the exact text returned, so an audit can reproduce what the agent saw |
| `phase_transitions` | feature_id, from_phase, to_phase, direction (forward, backward), result (pass, fail), findings jsonb, evidence jsonb null, pack_id null, artifact_hashes jsonb, human_approved bool, reason null | Audit trail of every transition attempt. `created_by` is the actor |
| `feature_artifacts` | transition_id, name, sha256, byte_length, content text null | Artifact text as submitted, capped at 256 KB per artifact. Larger artifacts store hash and length only |
| `knowledge_items` | stable_id, version int, kind, tier (always_on, retrieved), framework text null, app_id null, memory_type null, human_id text null, stack_tags text[], phase_tags text[], title, body, front_matter jsonb, pack_name, pack_version text null, status (active, deprecated), superseded_by null, deprecation_reason, source_path, source_hash, source_url, license | Unique on (stable_id, version). Immutable once active. `framework` null means every framework; empty `phase_tags` means every phase |
| `knowledge_chunks` | item_id, ordinal, heading_path, text, embedding vector(1024), embedding_model, token_count, tokenizer | One row per section, hard cap 512 tokens |
| `proposals` | app_id, feature_id, payload jsonb, supersedes text null, status (pending, approved, rejected), reviewed_by, review_reason | Approval copies payload into `knowledge_items`; when `supersedes` names an active item, approval also sets `superseded_by` on it |

`kind` is one of `framework_pack`, `standard`, `stack_guide`, `app_memory`.
`memory_type`, required when `kind` is `app_memory`, is one of `adr`,
`decision`, `constraint`, `incident`. Accepted specs are not ingested as memory;
an `adr` or `decision` links to the archived spec by path or ticket id.

A `standard` with `app_id` null is a company standard. A `standard` with an
`app_id` is that app's steering rule set. Only `standard` items may be
`always_on`. The quality layer and the EARS patterns are `standard` items with
`framework` null and `tier: retrieved`.

Rules:

- An `app_memory` item belongs to exactly one app. Cross-app retrieval happens
  only through the explicit `scope` parameter of `search_memory` and
  `get_context`.
- An active item is never edited. Re-ingesting a changed file creates version
  n+1 and sets `superseded_by` on version n, which stays `active` for history
  but leaves default retrieval (section 9.2). A file removed from a pack on
  re-ingest produces a warning and no change.
- Deprecated items stay in the database, leave default retrieval, and remain
  resolvable by id so a feature's history stays readable.
- Every context pack records the items it contained and the text it rendered,
  and every transition records the pack it was working from, so a feature
  routed earlier can show which standards it was held to.
- A feature is pinned to the framework version current at `start_feature`.
  Phase mappings, gate declarations and phase templates come from that version
  until the feature is archived. A backward move may re-pin to the current
  version when the host passes `repin: true`.
- Approved proposals become items with `stable_id` =
  `<app slug>.<memory_type>.<zero-padded sequence>`, `pack_name` = `proposals`,
  `pack_version` null, `phase_tags` empty, and `human_id` set when the
  proposal's title starts with an identifier such as `ADR-12`.

## 7. MCP surface

Eight developer-facing tools. Admin operations are CLI only (section 12.4),
which keeps the tool list small and keeps knowledge writes off the network
path.

Every description states what the tool does, when to use it and what it
returns, and includes one example call. Every tool that returns instructions
returns them as plain text inside the result, because Cursor's support for the
Prompts primitive lags behind Tools. Every successful result may carry a
`warnings[]` list.

All mutating tools take `actor` (string, required): the display identity from
the host's local configuration (see the host integration guide, section 11.2).
It is attribution only (section 11.3). `get_context` is mutating because it
persists a pack.

### 7.1 Tools

**`route_task`** (read-only)

| Input | Type | Notes |
|---|---|---|
| `task_description` | string, required | |
| `app` | slug, required | |
| `workspace` | object, required | See below |
| `framework_preference` | string, optional | Validated against current frameworks at call time |

`workspace` fields, all optional, null meaning unknown: `stack` string[],
`intent` (`feature`, `product`, `spike`, `incident`, `remediation`, `refactor`,
`auto`), `is_greenfield` bool,
`has_spec_library` bool, `estimated_files` int, `paths_touched` string[],
`repositories` int, `new_subsystem` bool, `host` string. Section 8.3 states how
a host derives them.

| Output | Notes |
|---|---|
| `decision` | `{intent, framework or "none", track, confidence: high or medium, rule, reasons[], high_risk, policy_version, framework_pack_version}` |
| `clarifying_questions[]` | At most three, present at medium confidence |
| `guidance` | Prototype-first guidance text when `framework` is `none` |
| `attached_layers[]` | One entry per attached pack: `{pack_name, pack_version, kind}`. Always the quality layer; plus each stack-guide pack whose `stack_tags` intersect `workspace.stack`, falling back to `apps.default_stack` |

**`start_feature`**

| Input | Notes |
|---|---|
| `app`, `actor` | required |
| `task_description` | required; stored as `source_task` |
| `decision` | required; the `decision` object returned by `route_task`, possibly with a different `framework` or `track` if the user overrode it |
| `workspace` | the facts used, stored for audit |
| `feature_slug` | optional; defaults to a slug derived from the task description |
| `external_ref` | optional backlog ticket id, for example `YAL-123`; also used as the default `feature_slug` prefix |
| `trigger_ref` | optional cause reference, for example `INC-204`, `CVE-2026-1234`, or an alert id |
| `policy_override_reason` | required when `decision.framework` differs from what the app's current policy names |

Behaviour: the server stores the client-supplied `decision` verbatim, then
re-resolves `framework_pack_version` (current version of the framework),
`policy_version` (current policy) and `track` (from the decision when the
framework has tracks, else null). It fails with `UNKNOWN_FRAMEWORK` when the
framework has no current version, and with `VALIDATION_ERROR` when the
framework is `none`, when a framework with tracks is given no track, or when a
policy override lacks a reason. It warns when the stored decision's
`framework_pack_version` differs from the pinned one.

Returns `feature_id`, `context_pack`, `pack_id`, `feature` state, and
`next_instructions` for `specify`, including the instruction to keep the
feature id.

**`get_context`**

| Input | Notes |
|---|---|
| `feature_id`, `actor` | required |
| `phase` | optional, defaults to current |
| `focus` | optional query string to steer retrieval |
| `scope` | `"app"` (default), `"company"`, or slug[]; section 9.2 defines each |

Returns `context_pack`, `pack_id`, `feature` state. Allowed on archived
features.

**`advance_phase`**

| Input | Notes |
|---|---|
| `feature_id`, `actor` | required |
| `expected_phase` | required; must equal the current phase or the call fails with `STALE_STATE` |
| `target_phase` | required; a phase name or the literal `archived` |
| `artifacts` | map name to content; the transition declares which names it needs |
| `evidence` | object, required on the transition out of `verify`; schema in section 10.4 |
| `human_approved` | bool |
| `cycle_failed` | bool; accepted only on the backward move from `verify` to `implement` |
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
`links[]` (paths or ticket ids to archived artifacts), `supersedes` (optional
`stable_id` of an active item this one replaces, for example the business rule
a change retires). Returns `proposal_id`, `status`.

**`get_feature_status`**

Input: `feature_id`. Returns intent, framework, framework_pack_version, track,
current_phase, phase alias, status, blocked_reason, high_risk, failed_cycles,
external_ref, trigger_ref, allowed forward and backward targets, transitions[]
(summaries), latest pack id per phase.

**`list_features`** (read-only)

Input: `app` (required), `status[]` (default `active` and `blocked`),
`external_ref` (optional exact match), `limit` (default 50). Returns
`features[]` `{feature_id, slug, intent, framework, track, current_phase,
status, external_ref, trigger_ref, updated_at}`. Lets a host working through
a backlog see what is already in flight and resume it instead of routing the
same ticket twice.

### 7.2 Result and error encoding

Tool results use the MCP TypeScript SDK's `structuredContent` with a declared
`outputSchema`, plus one `text` content block holding the rendered context pack
or instructions so hosts that ignore structured content still see them.

Domain errors are tool results with `isError: true` whose single text block is
the JSON object `{code, message, details}`. Input schema violations may
alternatively surface as SDK validation errors before the tool runs; both carry
`VALIDATION_ERROR`.

### 7.3 Resources

Read-only, addressed by URI. They exist for hosts that support browsing; every
value is also reachable through a tool.

- `sdd://apps/{slug}`: app profile, current policy version, always-on standards.
- `sdd://features/{id}`: feature state and transition summaries.
- `sdd://frameworks/{name}`: current framework version: tracks, phases,
  artifacts, gates.
- `sdd://knowledge/{stable_id}`: current version of one item.
- `sdd://knowledge/{stable_id}/v/{version}`: a specific version.

There is no per-phase context resource; `get_context` is the single path to a
pack.

### 7.4 Prompts

One prompt per abstract phase: `sdd.specify`, `sdd.plan`, `sdd.tasks`,
`sdd.implement`, `sdd.verify`, `sdd.integrate`, `sdd.learn`. Each takes
`feature_id` and returns exactly what `get_context` returns for that phase,
persisting the pack with `created_by = prompt`. They are thin wrappers so hosts
that expose prompts as slash commands can offer them; they are never the only
path.

### 7.5 Error codes

Errors are reserved for precondition and protocol failures. Gate failures and
degraded retrieval are normal results with `findings` or `warnings`. When
several apply, the first in this table wins.

| Code | When | Applies to |
|---|---|---|
| `VALIDATION_ERROR` | Input schema violation, with field path | any |
| `APP_NOT_FOUND` | Unknown app slug | any |
| `FEATURE_NOT_FOUND` | Unknown feature id | any |
| `UNKNOWN_FRAMEWORK` | Preference or decision names no current framework | `route_task`, `start_feature` |
| `FEATURE_ARCHIVED` | Feature is archived | `advance_phase`, `propose_memory` |
| `STALE_STATE` | `expected_phase` differs from the current phase | `advance_phase` |
| `FEATURE_BLOCKED` | Feature is blocked; reason attached | forward `advance_phase` only |
| `PHASE_ORDER_VIOLATION` | Target not reachable under section 10.3; allowed targets attached | `advance_phase` |
| `EMBEDDING_MODEL_MISMATCH` | Configured provider or model differs from `embedding_config`; points to `sdd-admin reindex` | any retrieval, `ingest` |

Each error carries a human-readable message so the host can act instead of
guessing.

## 8. Router

The router is a pure function of the task signals, the app's current policy
and the current framework list. It evaluates rules in priority order and stops
at the first rule that fires. The decision records the rule name and the
signals used.

### 8.1 Signals

| Signal | Derivation |
|---|---|
| App policy | Current `app_policies` row: `framework`, or the first `path_rules` glob matching any `paths_touched` |
| Explicit preference | `framework_preference` |
| Intent | `workspace.intent` if not `auto`; else the first phrase list the task text matches, in this order: `incident` (`outage`, `production is down`, `hotfix`, `P1`, `INC-\d+`), `remediation` (`CVE-\d+`, `vulnerability`, `Snyk`, `deprecated library`), `refactor` (`refactor`, `no behaviour change`, `no behavior change`, `extract`, `untangle`), `spike` (`can we`, `prototype`, `spike`, `is it possible`), `product` (`whole product`, `new product`, `PRD`); else `feature`. Lists are server configuration; the defaults are these. A backlog ticket title alone rarely matches `product`, which is intended |
| Greenfield | `is_greenfield`; if null, `not has_spec_library`; if both null, unknown |
| Size | `small`: `estimated_files` at most 3 and all `paths_touched` share one top-level directory. `large`: `estimated_files` at least 20, or `repositories` at least 2, or `new_subsystem` true. Else `medium`. Unknown when `estimated_files` is null and `new_subsystem` is not true |
| Risk paths | Any `paths_touched` matching the default list plus the policy's `risk_paths`. Default: `**/payments/**`, `**/billing/**`, `**/auth/**`, `**/*crypto*`, `**/migrations/**`, `infra/**`, `**/*.tf`, `.github/workflows/**` |
| Compliance | `apps.compliance` |

Risk does not change the framework. It sets `high_risk` on the feature, which
forces human approval at `verify` to `integrate` (section 10.3).

### 8.2 Rules

| Order | Condition | Decision |
|---|---|---|
| 1 | Policy names a framework, or a path rule matches | That framework, confidence high. Track from intent per rules 5 and 6 when the framework has it, else `default` |
| 2 | Explicit preference | That framework, confidence high, with a warning in `reasons` if rules 3 to 11 would differ. Track as in rule 1 |
| 3 | Intent `spike` | `none`. Return prototype-first guidance; no feature |
| 4 | Intent `product` | `sdlc` house flow, starting at PRD |
| 5 | Intent `incident` | OpenSpec, track `hotfix`, any size. `high_risk` forced true |
| 6 | Intent `refactor` and size small or medium | OpenSpec, track `refactor` |
| 7 | Intent `refactor` and size large | Spec Kit, track `refactor` |
| 8 | Size large and (compliance or `new_subsystem`) | BMAD. Track `quick` when `estimated_files` is at most 15 and compliance is false, else `full` |
| 9 | Brownfield and size small or medium | OpenSpec, track `default` |
| 10 | Greenfield and size small or medium, or size large | Spec Kit, track `default` |
| 11 | Greenfield status or size unknown | Confidence medium. Candidate OpenSpec when `has_spec_library` is true, else Spec Kit. Up to three clarifying questions asking for the missing facts |

Intent `remediation` has no rule of its own: it routes by size like a feature,
is recorded on the feature, and its `trigger_ref` is expected to name the CVE
or scanner finding so retrieval surfaces prior decisions about the same
dependency.

Kiro is routed only by rules 1 and 2, since its workflow assumes its IDE. Its
EARS requirement patterns are ingested as a `standard` with `framework` null
and `phase_tags: [specify]`, so every framework's specify phase retrieves them.

`track` is `default` for frameworks with a single track. When rules 1 or 2
name BMAD, the track is `full` unless the preference or policy names one.

If rule 1 or 2 names a framework with no current version, the call fails with
`UNKNOWN_FRAMEWORK`.

### 8.3 Deriving workspace facts

The host supplies workspace facts. The `route_task` description and a client
helper script in `docs/verification/` state the derivations so different hosts
produce the same signals:

- `has_spec_library`: any of `openspec/`, `specs/`, `.specify/`,
  `_bmad-output/`, `.kiro/specs/`, `.sdlc/` exists in the workspace.
- `is_greenfield`: the repository has fewer than 20 commits, or the host's
  local configuration says so.
- `estimated_files`, `paths_touched`, `new_subsystem`: the host agent's own
  estimate, flagged as an estimate in the reasons.
- `repositories`: the number of configured repositories the task names.

Any null fact is unknown and lowers confidence per rule 9.

Workspace facts, `human_approved` and verify evidence are host assertions. The
server records them with the actor and never verifies them independently. The
decision's `reasons` name every asserted fact it relied on.

## 9. Context assembly

A **context pack** is the ordered, budgeted block of text returned for one
feature in one phase. Material that must never be forgotten sits at the start
and the end; retrieved material sits in the middle.

### 9.1 Order

| Position | Content | Source | Trimmable |
|---|---|---|---|
| 1 | Header: feature id, framework, track, phase and its alias, instruction block for this phase | Pinned framework version | No |
| 2 | Always-on standards: company constitution and the feature's app steering rules, one constraint per line with its reason. Independent of `scope` | `standard` items with `tier: always_on`, current versions, company then app | No |
| 3 | Phase template, verbatim | Pinned framework version | No |
| 4 | Retrieved knowledge: `app_memory`, retrieved `standard` (including quality layer and EARS), and non-template `framework_pack` items of the pinned version, filtered and ranked per 9.2, each with stable id, version and heading path | Retrieval | Yes, second |
| 5 | Stack guide sections from the packs named in `attached_layers`, retrieved by the task query, never whole files | Retrieval, `stack_guide` kind | Yes, first |
| 6 | Stop conditions and the next gate: the four default stop conditions (ambiguity between valid approaches, three failed fix attempts, existing behaviour contradicting acceptance criteria, irreversible data changes) plus `apps.stop_conditions`, then the checks and artifacts the next forward `advance_phase` will require | Engine | No |

### 9.2 Retrieval

Scope semantics, shared by `get_context` and `search_memory`:

| `scope` | Items admitted |
|---|---|
| `app` | company-wide items (`app_id` null) plus the referent app's items |
| `company` | company-wide items only |
| slug[] | company-wide items plus the listed apps' items |

Steps:

1. Metadata filter: `status = active` and `superseded_by IS NULL` for every
   kind except `framework_pack`, which is filtered by `pack_name =
   feature.framework AND pack_version = feature.framework_pack_version`;
   `app_id` per scope; `framework = feature.framework OR framework IS NULL`;
   `phase_tags` empty or containing the phase; `kind` per position.
2. Vector search: cosine distance on `knowledge_chunks.embedding` with an HNSW
   index, 12 candidates, minimum similarity 0.35 or `apps.min_similarity`.
   pgvector 0.8 iterative scan (`hnsw.iterative_scan = relaxed_order`) so
   filtered queries do not under-return.
3. Exact identifier match: any token in the query or task matching
   `\b(ADR|REQ|US|INC)-\d+\b` is matched against `human_id`, `stable_id`,
   `title` and chunk text via a `pg_trgm` index. Exact hits rank ahead of
   vector hits.
4. Deduplicate by item, keeping the best chunk per item, then take the top 8.

The query text is the `focus` parameter when present, else the feature's
`source_task`. The feature's `trigger_ref` and `external_ref` are always added
to the exact-identifier step so an incident or ticket referenced elsewhere in
memory is found. Voyage requests use `input_type: document` at ingestion and
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

Every framework track is mapped onto one loop: `specify`, `plan`, `tasks`,
`implement`, `verify`, `integrate`, `learn`. The engine reasons only about these
phases. `specify`, `implement`, `verify` and `integrate` are mandatory. A track
may declare `plan`, `tasks` or `learn` as `skipped`. After the last non-skipped
phase the feature moves to the state `archived`.

Every track must map all seven phases explicitly; ingestion rejects a pack that
does not. Each mapped phase may carry an `alias`, the framework's own name for
it (for example `proposal` for OpenSpec's specify), used in headers, prompts
and status output so the host sees the vocabulary its framework uses.

This is a deliberately constrained model: one shared sequence, skippable
optional phases, backward edges with a reason, one halted status (`blocked`)
and one terminal status (`archived`). It covers every framework in scope. A
general per-framework graph engine is not part of v1.

| Framework and track | Mapping |
|---|---|
| OpenSpec `default` | `propose` covers specify, plan and tasks in one transition (plan and tasks skipped as separate stops); `apply` is implement; `verify` plus `sync` are verify; `archive` is integrate; learn skipped |
| OpenSpec `hotfix` | specify is a minimal proposal: reproduction, expected behaviour, regression test as acceptance criterion; plan and tasks skipped; implement, verify, integrate as `default`; learn is mandatory and its prompt asks for an `incident` memory proposal. Declares `spec_review: deferred` |
| OpenSpec `refactor` | specify is a design proposal with `Observed Behaviors`, `Assumed Contracts` and `Characterization Tests` sections and an empty delta spec; plan and tasks skipped; implement, verify, integrate as `default`; learn skipped. Verify requires `max_existing_tests_modified: 0` |
| Spec Kit `default` | constitution is an always-on standard, not a phase; specify (with clarify), plan, tasks (with analyze), implement map one to one; verify is the local harness plus checklist; integrate is the pull request; reconcile is learn |
| Spec Kit `refactor` | as `default`, but the spec requires `Observed Behaviors`, `Assumed Contracts` and `Characterization Tests` sections and no functional requirements, and verify requires `max_existing_tests_modified: 0` |
| BMAD `quick` | quick-spec covers specify through tasks; quick-dev is implement; code-review is verify; integrate is the pull request; learn skipped |
| BMAD `full` | PRD and architecture are specify; epics and stories are plan and tasks; dev-story is implement; code-review is verify; integrate is the pull request; retrospective is learn |
| Kiro | requirements is specify, design is plan, tasks is tasks; implement, verify and integrate use the Kiro pack's own generic templates; learn skipped |
| sdlc house flow | PRD and scoping doc are specify; jot down is plan; task breakdown is tasks; implement-task covers implement and verify; integrate is the pull request; retrospective is learn |

### 10.2 Gate check library

Tracks declare which checks run at which forward transition, with parameters,
and which artifact names the transition needs. The library is deterministic
and the server never fills in missing content. Checks see only the artifacts
submitted in the same call.

Common conventions: all markers and patterns are regular expressions and
case-sensitive unless stated; headings match at any level, case-insensitively;
a section is non-empty when it contains at least one non-blank, non-heading
line before the next heading of the same or higher level; a task block is the
lines from one `task_regex` match to the next.

| Check | Parameters | Algorithm |
|---|---|---|
| `missing_artifact` | implicit | A `blocker` finding for each declared artifact name absent from the call |
| `placeholder_scan` | `markers[]` (default `\bTBD\b`, `\bTODO\b`, `NEEDS HUMAN INPUT`, `\bOQ-\d+\b`) | Every submitted artifact is scanned; each match is a finding with line number |
| `required_sections` | `artifact`, `sections[]` | Each named heading present and non-empty |
| `measurable_criteria` | `artifact`, `section`, `adjectives[]` (default list in code, extendable) | Each list item or line in the section containing a listed adjective must also contain a number followed by a unit or symbol (`ms`, `s`, `%`, `MB`, `req/s`, or a bare integer); otherwise a finding |
| `task_done_checks` | `artifact`, `task_regex`, `done_regex` | Every task block must contain a `done_regex` match |
| `task_ordering` | `artifact`, `task_regex` with named group `id`, `dep_regex` with named group `id` | Every dependency id must belong to a task that appears earlier |
| `delta_markers` | `artifact` | Sections `ADDED`, `MODIFIED`, `REMOVED` Requirements recognised; each entry under `REMOVED` must contain `**Reason**` and `**Migration**` |
| `verify_evidence` | `max_new_high` (default 0), `max_existing_tests_modified` (default null, not checked) | Section 10.4 rules |
| `scope_drift` | `plan_artifact`, `files_section` | Paths in `evidence.files_changed` not present in the section (paths extracted as backticked tokens or tokens matching `[\w./-]+\.\w+`) produce a `warning` finding |
| `human_approved` | none | `human_approved` was true; recorded with the actor |

Severity is `blocker` unless the track marks a check `warning`. `scope_drift`
defaults to `warning`.

The library is a versioned allowlist compiled into the server. Tracks select
and parameterise checks; they cannot ship executable policy of any kind. A new
check requires a server release, and `frameworks.gate_library_version` records
the library version the pack was validated against.

### 10.3 Transitions and reachability

Reachability under the pinned track:

- A forward target is exactly the next non-skipped phase, or the literal
  `archived` when the current phase is the last non-skipped one.
- A backward target is any earlier non-skipped phase.
- Forward moves run the transition's declared checks. Backward moves run no
  checks and record the reason.
- `PHASE_ORDER_VIOLATION` carries the allowed forward and backward targets.

Procedure for `advance_phase`: lock the feature row (`SELECT ... FOR UPDATE`),
apply the error precedence of section 7.5, run checks for forward moves, and
record the transition, artifact hashes and artifact text in one transaction. A
failed gate records a `fail` transition and leaves `current_phase` unchanged.

Mandated approvals:

- The engine mandates `human_approved` on the first forward transition out of
  `specify` for every track, because spec review is the highest-leverage
  checkpoint. A track may declare `spec_review: deferred`, which moves that
  mandated approval to the transition out of `verify`; only the `hotfix` seed
  track does so, because a production outage should not wait on a spec review
  but must not merge without a human. Tracks may require approval elsewhere.
- When `high_risk` is true the engine also mandates it on the transition out of
  `verify`.

Failed cycles:

- `cycle_failed: true` is accepted only on the backward move from `verify` to
  `implement`. That move increments `failed_cycles` and does not reset it.
- Any other backward move resets `failed_cycles` to 0 and, if the feature was
  `blocked`, sets it back to `active`.
- When an increment reaches 3 the move is still recorded, status becomes
  `blocked`, and `blocked_reason` is the call's `reason`. Any subsequent
  backward move is the unblock.

Archival: a forward move to `archived` sets status `archived`. Archived
features accept reads and `get_context` only.

`next_instructions` always restates the feature id, current phase and alias so
the host can persist them however it chooses.

### 10.4 Verify evidence

Required on the forward transition out of `verify`:

```json
{
  "tests":    { "command": "npm test", "passed": 42, "failed": 0 },
  "lint":     "pass",
  "security": { "status": "pass", "new_high": 0, "skipped_reason": null },
  "files_changed": ["src/api/export.ts", "src/api/export.test.ts"],
  "implements": ["REQ-03", "US-02"],
  "existing_tests_modified": 0,
  "characterization_tests": ["src/orders/export.characterization.test.ts"]
}
```

| Field | Required | Values |
|---|---|---|
| `tests.command`, `tests.passed`, `tests.failed` | yes | string, int, int |
| `lint` | yes | `pass` or `fail` |
| `security.status` | yes | `pass`, `fail`, `skipped` |
| `security.new_high` | yes | int |
| `security.skipped_reason` | when status is `skipped` | string |
| `files_changed` | when the track declares `scope_drift` | string[] |
| `implements` | no | string[] |
| `existing_tests_modified` | when the track sets `max_existing_tests_modified` | int; count of pre-existing test files changed |
| `characterization_tests` | when the track sets `max_existing_tests_modified` | string[]; must be non-empty |

`verify_evidence` passes when `tests.failed` is 0, `lint` is `pass`, either
`security.status` is `pass` with `new_high` at most `max_new_high` or
`security.status` is `skipped` with a reason, and, when the track sets
`max_existing_tests_modified`, `existing_tests_modified` is at or below it and
`characterization_tests` is non-empty. A skipped scan adds a `warning`
finding. Any missing required field is a `blocker`. The server records evidence
as given and never infers a result from an absent field.

## 11. Deployment, configuration and security

### 11.1 Deployment

`docker-compose.yml` starts Postgres with pgvector and the server. Schema
migrations run with `node-pg-migrate` on startup; its advisory lock makes this
safe on replicated servers. The first migration creates the `vector` and
`pg_trgm` extensions. Environment variables:

| Variable | Purpose |
|---|---|
| `SDD_DATABASE_URL` | Postgres connection |
| `SDD_EMBEDDING_PROVIDER` | `voyage` (default), `ollama`, or `fake` (tests only, deterministic vectors) |
| `SDD_EMBEDDING_MODEL` | Accepted models, all at 1,024 dimensions: Voyage `voyage-3`, `voyage-3-large`, `voyage-3.5`, `voyage-3.5-lite`, `voyage-code-3` (requesting `output_dimension: 1024` where the default differs); Ollama `mxbai-embed-large`, `bge-m3`. Others are refused at startup |
| `VOYAGE_API_KEY` or `OLLAMA_URL` | Provider credentials or endpoint |
| `SDD_LISTEN` | Host and port for Streamable HTTP; defaults to a loopback or private interface |
| `SDD_ALLOWED_HOSTS` | Host header allowlist for DNS-rebinding protection |
| `SDD_TOKEN_BUDGET` | Default pack budget |

At startup the server compares provider and model with `embedding_config` and
refuses retrieval with `EMBEDDING_MODEL_MISMATCH` until `sdd-admin reindex`
completes. An empty `embedding_config` is written on first ingest.

Streamable HTTP runs in stateless mode (`sessionIdGenerator` unset): no
in-memory session state, no resource subscriptions, so the server can be
replicated behind a load balancer. `sdd-orchestrator --stdio` runs the same
server over standard input against whatever database the environment names.

`GET /healthz` reports database and embedding provider reachability.

### 11.2 Client setup

The server holds all feature state and depends on no file in any workspace.
Hosts need somewhere to keep the server URL, app slug, actor identity, an
optional greenfield flag, and the feature id between sessions. The recommended
convention, a committed `.sdd/config.json` plus a per-branch `.sdd/feature.json`
cache, is described in `docs/verification/host-integration.md`, not here.
Whatever a host keeps locally is a cache: the server is authoritative, and
`STALE_STATE` tells the host when its copy has fallen behind.

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
name: bmad
kind: framework_pack
framework: bmad
version: 1.0.0            # pack version, recorded on every item as pack_version
source_url: https://github.com/bmad-code-org/BMAD-METHOD
license: MIT
app: null                 # optional default app slug for every item in the pack
tracks:                   # framework packs only. A pack without tracks uses a single key "default"
  quick:
    spec_review: required # or deferred; see section 10.3
    phases:               # all seven required
      specify:   { alias: quick-spec, command: "/bmad-bmm-quick-spec", template: bmad.template.quick-spec }
      plan:      skipped
      tasks:     skipped
      implement: { alias: quick-dev,  command: "/bmad-bmm-quick-dev",  template: bmad.template.quick-dev }
      verify:    { alias: code-review, command: "bmad-code-review",    template: bmad.template.code-review }
      integrate: { alias: pull-request, template: bmad.template.integrate }
      learn:     skipped
    gates:
      - transition: specify->implement
        artifacts: [quick-spec.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: quick-spec.md, sections: [Goal, Acceptance Criteria, Tasks] } }
          - { name: task_done_checks, params: { artifact: quick-spec.md, task_regex: "^- \\[ \\] ", done_regex: "\\(AC: \\d" } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence }
  full:
    phases: { ... }
    gates:  [ ... ]
```

```markdown
---
id: bmad.template.quick-spec          # becomes knowledge_items.stable_id
kind: framework_pack
tier: retrieved
framework: bmad
app: null                             # slug for app-scoped items; required for app_memory
phases: [specify]                     # becomes phase_tags; empty means every phase
stack_tags: []
title: Quick spec template
supersedes: null                      # stable_id of an item this one replaces; ingestion sets superseded_by on it
---
## Goal
...
```

Front matter names map to schema columns as commented. The per-item integer
`version` is assigned by ingestion and is unrelated to the pack's semantic
version. An item's `app` must name a registered app or ingestion fails.

### 12.2 Chunking

Split on H2 headings; split an H2 section on H3 when it exceeds the cap; then
on paragraphs. Hard cap 512 tokens, no overlap. Never split inside a fenced
code block or a table. The embedded text is `title > heading path` followed by
the chunk text, and `heading_path` stores the full path so a heading like
"Rationale" stays retrievable.

### 12.3 Seed packs shipped in `packs/`

Seed packs contain templates only for the phases they map, not full upstream
distributions.

- `openspec` (tracks `default`, `hotfix`, `refactor`), `spec-kit` (tracks
  `default`, `refactor`), `bmad` (tracks `quick`, `full`): templates, command
  vocabulary, phase mapping and gates, adapted from their MIT sources with
  attribution. The `hotfix` and `refactor` templates are written for this
  project following Graziano's brownfield guidance.
- `kiro`: templates written for this project in Kiro's three-document structure
  and EARS notation. No proprietary text is copied. The EARS patterns ship as a
  framework-null standard.
- `sdlc`: the house flow with templates for PRD, scoping doc, jot down and task
  breakdown so a host without the plugin can still follow it, plus its existing
  validation gates.
- `quality-layer`: Osmani's agent-skills (MIT), `kind: standard`,
  `tier: retrieved`, `framework` null.
- `stack-guides`: the plugin's domain skills (Go, React, Node, frontend design,
  web design audit), one pack per stack, tagged by stack. These derive from
  `antigravity-awesome-skills`; its license must be confirmed before the pack is
  published.
- `company`: an example always-on constitution showing the one-constraint-per-
  line-with-reason shape.

### 12.4 CLI

Every CLI write takes `--actor`, defaulting to the OS user name.

| Command | Effect |
|---|---|
| `sdd-admin app register <slug> --name ... [--compliance]` | Create an app |
| `sdd-admin app update <slug> [--stack ...] [--budget N] [--min-similarity X]` | Set default stack, token budget, similarity floor |
| `sdd-admin app set-policy <slug> <policy.json> --reason ...` | Append a new policy version |
| `sdd-admin app add-stop-condition <slug> "<text>"` | Append an app stop condition |
| `sdd-admin app list` | List apps with current policy version |
| `sdd-admin ingest <dir>` | Validate the whole pack, embed in batches, then write in one transaction. Changed files become a new version; unchanged files are skipped by hash; removed files warn. Refused on embedding mismatch |
| `sdd-admin deprecate <stable_id> [--successor <id>] --reason ...` | Retire one item |
| `sdd-admin deprecate-framework <name> [--version V] --reason ...` | Retire a framework version, or all versions. Features pinned to it continue; new routing to it fails |
| `sdd-admin proposals list \| approve <id> \| reject <id> --reason ...` | Review agent proposals. Approving one with `supersedes` also marks the named item superseded |
| `sdd-admin reindex` | Re-embed all chunks with the configured model, then rewrite `embedding_config` |

Ingestion refuses a pack with duplicate ids, missing required front matter, a
framework pack whose tracks do not each map all seven phases, a gate naming an
unknown check or an undeclared artifact, an `always_on` item that is not a
`standard`, an `app_memory` item without `app`, or an unknown app slug.
Nothing is written until the whole pack validates and all embeddings are
computed.

## 13. Testing

- **Router**: one unit test per rule, plus conflict, unknown-signal,
  preference-contradiction, deprecated-framework, policy path-rule, intent
  phrase-list precedence and track selection cases for every intent. Pure, no
  database.
- **Gate checks**: passing and failing artifact fixtures for every check under
  each seed track's parameters, including `missing_artifact`, the
  measurable-criteria detector, OpenSpec delta validation and verify evidence
  with a skipped scan and with a missing required field.
- **Lifecycle engine**: reachability for every seed track, archive from the
  last phase, backward targets, mandated approvals including deferred spec
  review on `hotfix`, `failed_cycles` reaching blocked and the unblock, error
  precedence.
- **Assembler**: ordering, scope semantics, trimming priority, over-budget
  behaviour, deduplication, exact-id ranking, framework-null and empty
  phase-tag inclusion, superseded exclusion, pinned framework version, degraded
  mode. Uses the `fake` embedding provider.
- **Integration** against Postgres in Docker: ingestion versioning,
  supersession and removed-file warning; app-scoped ingestion; deprecation of
  items and framework versions; proposal approval producing a retrievable item;
  policy versioning; proposal approval with `supersedes` retiring the old
  item; `list_features` by app, status and `external_ref`; a full feature
  lifecycle from `start_feature` to archive for every seed track with
  transitions, packs and artifacts recorded;
  backward moves and repin; concurrent `advance_phase` producing one
  `STALE_STATE`; embedding config mismatch and reindex.
- **Contract** tests through the MCP SDK client over both transports: tool
  schemas and `structuredContent`, error encoding and precedence, warnings,
  `route_task` writing nothing, `start_feature` refusing `none`, missing track
  and inactive frameworks, and every instruction-bearing tool returning its
  text inline.
- **Host verification** under `docs/verification/`: a feature matrix of tools,
  resources and prompts against Claude Code and Cursor, the workspace-facts
  helper script, the host integration guide, and a scripted walkthrough of one
  OpenSpec feature and one Spec Kit feature in each host.

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

Revision 3 changes after the external review in
`docs/superpowers/reviews/2026-09-10-sdd-orchestrator-review.md`: `route_task`
is read-only and `start_feature` creates the feature; host facts, approval and
evidence are stated to be recorded assertions; the gate library is stated to be
a compiled allowlist requiring a server release; phase aliases added; workspace
file conventions moved to the host integration guide; the constrained phase
model is stated as deliberate. The review's local-first default was not
adopted because the shared-server topology was decided earlier.

Revision 4 changes after the second adversarial review: tracks in the pack
format and `frameworks` table so BMAD's two mappings are expressible; explicit
reachability, archive transition and error precedence; one semantics for
`failed_cycles`; `start_feature` re-resolves versions and track and requires a
reason for policy overrides; retrieval excludes superseded versions and pins
framework items; approved proposals get a stable id and are retrievable; `app`
front matter for app-scoped ingestion; `embedding_config` and an exact model
list; gate algorithms and per-transition artifact lists; evidence field table;
MCP result and error encoding; scope semantics; rendered text stored per pack;
CLI commands for app settings and framework deprecation; leftover workspace
file references removed.

Revision 5 changes after the use-case walkthrough (new capability, business
rule change, production incident, scanner finding, legacy refactor, telemetry
regression, backlog throughput): intents `incident`, `remediation` and
`refactor`; OpenSpec `hotfix` and `refactor` tracks and a Spec Kit `refactor`
track; deferred spec review for hotfixes; `trigger_ref` and `external_ref` on
features and in exact-id retrieval; `supersedes` on proposals so a changed rule
retires the old one; `existing_tests_modified` and `characterization_tests`
evidence; the `list_features` tool; `epic` removed from the product phrase
list so backlog tickets do not route to the PRD flow.
