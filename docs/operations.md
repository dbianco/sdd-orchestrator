# Operating notes

Known operational characteristics of the v1 server. None of these is a bug;
each is a consequence of a deliberate v1 design choice, recorded here so that
whoever deploys or debugs the server is not surprised by it.

## Connection pool sizing against embedding latency

`start_feature` and `get_context` assemble a context pack inside a single
database transaction, and the retrieval step inside that transaction calls the
embedding provider over HTTP to embed the query. The pooled connection and its
open transaction are therefore held for the whole duration of that outbound
call.

The pool is `max: 10` connections per process (`src/db/pool.ts`). With ten
concurrent `get_context` calls and a slow embedding endpoint, every connection
in the pool can be parked on the same outbound request, and any other work in
the process — including `/healthz` — waits behind it. Two bounds keep that
state finite:

- every remote embedding request is aborted after
  `EMBEDDING_REQUEST_TIMEOUT_MS` (30s, `src/embedding/provider.ts`), which is
  the ceiling on how long one connection can be parked; retrieval treats the
  abort as a degraded result, returns exact-id matches only and adds a warning
  to the pack, so the transaction ends and the connection is released;
- `pool.connect()` is bounded by `connectionTimeoutMillis` (5s), so a caller
  that finds the pool saturated fails with `timeout exceeded when trying to
  connect` rather than queueing forever.

Sizing rule of thumb: a process can sustain roughly
`max / embedding_latency_seconds` context assemblies per second. At the default
`max: 10` and a 500ms embedding round trip that is about 20/s; at a 3s round
trip it is about 3/s. If you expect more, run more replicas, put the embedding
model closer to the server (Ollama on the same host, or a regional Voyage
endpoint), or raise `max` in `src/db/pool.ts` together with Postgres's own
`max_connections`. Sustained `timeout exceeded when trying to connect` errors
mean the pool is the bottleneck, not Postgres.

## `GET /mcp` holds a stream open for the life of the connection

Every request to `/mcp` — `POST`, `GET` and `DELETE` alike — constructs a fresh
`McpServer` and a fresh `StreamableHTTPServerTransport`
(`src/mcp/http.ts`). For `GET` that stream stays open as long as the client
keeps the connection, so server memory scales with the number of concurrent
listening hosts, and a reverse proxy in front of the server needs:

- response buffering off (nginx: `proxy_buffering off`) so events are not held
  back;
- a read/idle timeout longer than the longest expected quiet period, or
  disabled (nginx: `proxy_read_timeout`), otherwise the proxy closes idle
  streams;
- no request-level retry on `GET /mcp`.

Sessions are not resumable (`sessionIdGenerator: undefined`): a dropped stream
means the host reconnects and rebuilds its own view from
`get_feature_status` / `list_features`. Nothing server-side is lost, because all
feature state lives in Postgres.

## Migrations run on every process start, including the CLI

`sdd-admin` runs `runMigrations` before opening its pool
(`openCli` in `src/cli/context.ts`), and so does the server (`src/index.ts`).
This keeps a single-operator deployment self-healing, but it has two
consequences:

- read-only commands are not read-only against the schema. `sdd-admin app list`
  and `sdd-admin proposals list` will apply any pending migration before
  printing anything, so the database role the CLI uses needs DDL rights, and a
  CLI invocation from an old checkout can migrate a database another process is
  using.
- every invocation pays the migration check, which is a couple of round trips
  against `pgmigrations` when there is nothing to apply.

Run the CLI from the same checkout as the running server, and treat
`sdd-admin` as an administrative tool, not as something to call from a script
loop.

## Docker build context

`.dockerignore` keeps `node_modules`, `dist`, `test`, `docs` and the git
directory out of the build context. The image installs its own dependencies
with `npm ci` inside `node:22-alpine`; a host `node_modules` built on macOS
must never reach the image.

## Re-ingest framework packs after upgrading the router

The router picks tracks from each track's `intents` and `is_default` fields in
`pack.yaml`, stored in `frameworks.tracks`. A database ingested before those
fields existed has no track claiming `incident` or `refactor`, so routing an
incident or a refactor fails with `UNKNOWN_FRAMEWORK` until the packs are
re-ingested. Re-run
`sdd-admin ingest packs/openspec`, `packs/spec-kit` and `packs/bmad` after
upgrading. Re-ingesting the same pack version rewrites the stored tracks, adds
no knowledge item versions for unchanged files, and leaves features that are
already pinned to that version unaffected.

## Framework packs 1.1.0: several templates and requirement checks

The seed framework packs moved to `1.1.0`: specify phases pin every document
their gate requires, and functional tracks capture requirement ids at the
spec gate and check coverage out of `verify` (gate library version `2`).
Run `sdd-admin ingest` for each framework pack after upgrading. Features
started before stay pinned to `1.0.0` and keep its gates until they are
archived; a backward move with `repin: true` moves one to `1.1.0`. A feature
that reaches `verify` without captured requirements gets a warning, not a
blocker.


## Authentication, approvals and CI evidence

`SDD_AUTH_MODE` controls the trust model:

| Mode | Calls without a token | Mandated approvals | CI evidence |
|---|---|---|---|
| `warn` (default) | Accepted with a warning; counted in `sdd_auth_rejections_total{reason="would_reject"}` | A person decides on the server | Merged into verify evidence; required for compliance apps and high-risk features |
| `enforce` | HTTP 401 | A person decides on the server | As `warn` |
| `off` | Accepted, as in v1 | The host sends `human_approved` | Ignored; `/api/ci` is not mounted |

Upgrading from v1, in order:

1. Before deploying, make sure each app has a reviewer who can approve:
   `sdd-admin token create --for <name> --scope host,approver --name <where>`,
   or CLI access (`sdd-admin approvals approve <id>`). From the first request
   after the upgrade, spec reviews and high-risk verify moves wait for a
   person. To keep the v1 flag for a while, set `SDD_AUTH_MODE=off`.
2. Deploy. Hosts without tokens keep working, with a warning on every result.
3. Issue a token per developer and per pipeline, and add the
   `Authorization: Bearer` header to hosts' MCP configuration.
4. Add the CI evidence step (`docs/ci/github-actions.md`) to compliance apps'
   pipelines first: their features cannot leave `verify` without it. A
   non-compliance app with high-risk features and no pipeline yet can opt out
   with `"evidence": "host"` in its policy.
5. When `sdd_auth_rejections_total{reason="would_reject"}` stays flat, switch to
   `SDD_AUTH_MODE=enforce`.

Tokens are stored as SHA-256 hashes; a lost token cannot be recovered, only
revoked (`sdd-admin token revoke <id> --reason ...`) and reissued. Rotate by
issuing the new token, updating the host or pipeline secret, then revoking
the old one. `--expires 90d` makes rotation mandatory. `SDD_ADMIN_TOKEN` still
logs in to the admin UI, read-only; approvals need a personal token so every
decision names a person.

An approver token restricted with `--app` can list and decide approvals only
for those apps. The admin UI's read-only views (Overview, Apps & Features,
Flow, Work, Traceability) are not filtered by that restriction yet: anyone who
can log in to the admin UI sees every app there.

## Measure retrieval before and after changing it

`sdd-admin eval packs/evals/seed.yaml` (or an app's own cases file) reports
recall@8 and mean reciprocal rank for golden queries, through the same
position-4 retrieval `get_context` uses. Run it before and after a `reindex`,
a model switch, a chunking change or a similarity-floor change, and pass
`--min-recall` or `--min-mrr` to make it fail the run. The fake embedder's
numbers say nothing about a real model; CI gates on Voyage only when a
`VOYAGE_API_KEY` secret is configured.

## Scripted walkthrough

`node docs/verification/walkthrough.mjs --url <server> --host-token ... --approver-token ... --ci-token ...`
runs the whole host contract against a deployment seeded with `packs/` and
running with `SDD_AUTH_MODE` `warn` or `enforce`. Use tokens made for the
purpose; the run creates and archives one feature under a `WALK-...` ticket.

