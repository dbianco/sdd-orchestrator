# Host integration guide

The server holds all feature state and reads no file in any workspace. A host
needs four things between sessions: the server URL, the app slug, an actor
identity, and the feature id of the work in progress. This guide names one
convention; any host may keep these values elsewhere. Whatever the host keeps
is a cache. The server is authoritative, and `STALE_STATE` tells the host
its copy is behind.

## Files

`.sdd/config.json`, committed:

```json
{ "server": "http://sdd.internal:8080/mcp", "app": "checkout", "greenfield": false }
```

`.sdd/feature.json`, per branch and git-ignored:

```json
{ "feature_id": "f_01j9...", "current_phase": "implement", "updated_at": "2026-09-10T12:00:00Z" }
```

Add `.sdd/feature.json` to `.gitignore`. Identity comes from a personal token
issued with `sdd-admin token create --for <name> --scope host,approver`,
kept in the `SDD_TOKEN` environment variable and sent as a bearer header
(below). The server records the token's actor and ignores a different
`actor` in the payload, with a warning. Without a token (`SDD_AUTH_MODE=warn`
or `off`, or stdio), `actor` in the payload is the identity, falling back to
`SDD_ACTOR` over stdio.

## Connecting

Claude Code, `.mcp.json` in the workspace:

```json
{ "mcpServers": { "sdd": { "type": "http", "url": "http://sdd.internal:8080/mcp", "headers": { "Authorization": "Bearer ${SDD_TOKEN}" } } } }
```

Cursor, `.cursor/mcp.json`:

```json
{ "mcpServers": { "sdd": { "url": "http://sdd.internal:8080/mcp", "headers": { "Authorization": "Bearer ${env:SDD_TOKEN}" } } } }
```

With `SDD_AUTH_MODE=enforce` a missing or invalid token is an HTTP 401 before
any tool runs. A token restricted to other apps, or without the `host`
scope, gets `FORBIDDEN`.

Local development over stdio against a local database:

```json
{ "mcpServers": { "sdd": { "command": "sdd-orchestrator", "args": ["--stdio"], "env": { "SDD_DATABASE_URL": "postgres://sdd:sdd@localhost:5432/sdd", "SDD_EMBEDDING_PROVIDER": "ollama" } } } }
```

## Deriving workspace facts

Run `docs/verification/workspace-facts.sh` from the repository root to get
`has_spec_library`, `is_greenfield`, `repositories` and `host`. The agent adds
its own estimates for `estimated_files`, `paths_touched` and `new_subsystem`,
and passes `stack` from the project's manifest. Every estimate is recorded by
the server as a host assertion (spec section 8.3).

## Session flow

1. New work: run `list_features` with the ticket id as `external_ref`. If a
   feature exists, write its id to `.sdd/feature.json` and call `get_context`.
2. Otherwise call `route_task` with the ticket as `external_ref` and your
   name as `actor`. It returns a `routing_id`; the same task routed again
   returns the same id. Set `workspace.intent` whenever you know the work is
   a spike, incident, refactor, product or trivial change: the server never
   takes those intents from the task text, and a matching phrase only comes
   back as a clarifying question. Show the decision. If there are clarifying
   questions, answer them and call `route_task` again. For trivial work the
   lite pack is the whole context: do the change, then go to step 6.
   For everything else call `start_feature` with the accepted decision and
   the `routing_id`, and write the returned feature id to `.sdd/feature.json`.
   If `start_feature` reports that the routing event already belongs to a
   feature (for example on a retry after a timeout), that id is your feature:
   write it to `.sdd/feature.json` and call `get_context`; do not start again.
3. Work from the context pack. Before `advance_phase`, read `current_phase`
   from `.sdd/feature.json` and pass it as `expected_phase`. On `STALE_STATE`,
   call `get_feature_status`, update the cache, and retry once.
4. After every successful `advance_phase`, update `.sdd/feature.json` from the
   returned `feature` state. A result of `awaiting_approval` means every check
   passed and a person must decide: tell the developer the `approval_id`
   (reviewers use the admin UI's Approvals tab or
   `sdd-admin approvals approve <id>`), do not start the next phase, and poll
   `get_feature_status` until `pending_approval` is null. A rejection shows up
   as a failed transition whose `human_approved` finding carries the
   reviewer's reason. Do not send `human_approved: true`; with auth on it is
   ignored.
5. When the feature is archived, delete `.sdd/feature.json`.
6. After every commit — trivial fix or feature — call `record_commit` with
   the sha, message, `files_changed` (from `git show --name-only`) and the
   `routing_id` or `feature_id`. Add a trailer `SDD-Ref: <that id>` to the
   commit message. The CI evidence script (`scripts/sdd-ci-evidence.mjs`,
   `docs/ci/github-actions.md`) reads it to know which feature a pipeline run
   belongs to; for compliance apps and high-risk features, the move out of
   `verify` needs that CI evidence for the feature's latest commit.

## Requirements and `implements`

Tracks with functional requirements capture their ids when the spec gate
passes: `**FR-001**` in Spec Kit, `**FR1**`/`**NFR1**` in BMAD `full`,
`**R1**` in the house flow, `### Requirement 1` in Kiro, and the requirement
name in `### Requirement: <name>` for OpenSpec. `get_feature_status` lists
them under `requirements`. On the move out of `verify`, put every id this
feature implements in `evidence.implements`, spelled as in the spec (case and
surrounding spaces are ignored). A missing id is a blocker, except in
OpenSpec, where requirement names are easy to paraphrase and a missing one is
a warning. An id that is not a requirement of the feature is a warning.

## Known limitations of a v1 context pack

**`attached_layers` is an announcement, not a guarantee of text.** `route_task`
always reports the quality layer (and any stack-guide pack matching the stack)
in `attached_layers`, and those packs are always eligible for retrieval. Their
content still enters a pack through position 4/5 retrieval like anything else,
so a given phase's pack may contain no quality-layer section at all. Use
`focus` ("test-driven development", "security hardening") to pull it in
deliberately.

**`list_features` reports raw phase names.** For speed, `list_features` returns
`current_phase` as the canonical phase (`specify`, `plan`, `implement`, …)
without resolving the framework's alias or `allowed_targets`, which would cost
one framework lookup per row. `get_feature_status` and `get_context` return the
alias (`proposal`, `jot-down`, …) for the same feature. A host showing a
feature list should either display the canonical name or call
`get_feature_status` for the feature the developer selects.

## Error handling

Every error result is `{code, message, details}`. `PHASE_ORDER_VIOLATION`
carries `details.forward` and `details.backward`; `FEATURE_BLOCKED` carries
`details.blocked_reason` and needs a human; `EMBEDDING_MODEL_MISMATCH` needs an
admin to run `sdd-admin reindex`. Gate failures are not errors: read
`findings`, fix the artifacts, call `advance_phase` again.

**Check evidence before spending a real attempt.** The move out of `verify`
requires an evidence object whose exact shape (field names, enum values,
track-specific extras) is spelled out in the `verify->integrate` gate's
context-pack footer. Before submitting for real, an agent can pass
`dry_run: true` on `advance_phase` to run the same gate checks against a
candidate `evidence`/`artifacts` payload; the call returns `result` and
`findings` but records no transition and leaves `current_phase` unchanged, so
it can be retried freely while iterating on the evidence shape.
