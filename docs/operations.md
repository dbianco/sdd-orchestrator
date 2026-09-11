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
