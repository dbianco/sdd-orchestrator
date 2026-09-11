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

## Error handling

Every error result is `{code, message, details}`. `PHASE_ORDER_VIOLATION`
carries `details.forward` and `details.backward`; `FEATURE_BLOCKED` carries
`details.blocked_reason` and needs a human; `EMBEDDING_MODEL_MISMATCH` needs an
admin to run `sdd-admin reindex`. Gate failures are not errors: read
`findings`, fix the artifacts, call `advance_phase` again.
