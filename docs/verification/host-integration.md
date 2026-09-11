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

Add `.sdd/feature.json` to `.gitignore`. The actor identity comes from the
host's own configuration (for Claude Code the `SDD_ACTOR` environment
variable or the git user name; for Cursor the same environment variable).

## Connecting

Claude Code, `.mcp.json` in the workspace:

```json
{ "mcpServers": { "sdd": { "type": "http", "url": "http://sdd.internal:8080/mcp" } } }
```

Cursor, `.cursor/mcp.json`:

```json
{ "mcpServers": { "sdd": { "url": "http://sdd.internal:8080/mcp" } } }
```

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
2. Otherwise call `route_task`. Show the decision. If there are clarifying
   questions, answer them and call `route_task` again. Then call
   `start_feature` with the accepted decision and write the returned id to
   `.sdd/feature.json`.
3. Work from the context pack. Before `advance_phase`, read `current_phase`
   from `.sdd/feature.json` and pass it as `expected_phase`. On `STALE_STATE`,
   call `get_feature_status`, update the cache, and retry once.
4. After every successful `advance_phase`, update `.sdd/feature.json` from the
   returned `feature` state.
5. When the feature is archived, delete `.sdd/feature.json`.

## Known limitations of a v1 context pack

**One template is pinned per phase.** A phase declares a single `template` in
its framework pack, and the assembler pins exactly that one into position 3 of
the pack (`src/assembler/assemble.ts`). Several phases nonetheless gate on
more than one artifact, and the next-gate footer names all of them
unconditionally:

| Framework / track | Phase | Gate requires | Pinned template |
|---|---|---|---|
| openspec / default | specify | `proposal.md`, `spec.md`, `tasks.md` | `openspec.template.proposal` |
| bmad / full | specify | `prd.md`, `architecture.md` | `bmad.template.prd` |
| sdlc / default | specify | `prd.md`, `scoping.md` | `sdlc.template.prd` |

The secondary templates are ingested and retrievable, but they reach the pack
only through ordinary similarity retrieval in position 4 — subject to the
similarity floor and to budget trimming — so a host cannot assume their text is
present just because the footer asks for the artifact. When the pack names an
artifact whose template is not in it, call `get_context` again with `focus` set
to that artifact and use the returned pack for that file. Write the `focus` in
the vocabulary of the document you want, not in the vocabulary of the task:
against the seed packs, `focus: "ADDED Requirements delta spec scenario WHEN
THEN requirement"` pulls `openspec.template.spec` into position 4, while
`focus: "spec.md delta requirements"` falls under the similarity floor and
returns nothing. Giving a phase several pinned templates is a manifest-schema
change and is deliberately out of scope for v1.

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
