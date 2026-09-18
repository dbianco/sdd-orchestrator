# Routing Events and Commits: Design Specification

**Status:** Draft for review
**Date:** 2026-09-18
**Builds on:** `docs/superpowers/specs/2026-09-17-admin-ui-design.md` (the
admin UI this adds a tab to) and `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`
(whose "route_task is read-only" statement this deliberately revises; see
section 12)

## 1. Summary

Today `route_task` is stateless: it decides a framework, optionally returns
a lite pack for trivial work, and writes nothing. Work that never becomes a
formal feature — a CSS fix, a date-range validation bug, a spike — leaves no
trace except an in-process Prometheus counter with no app or date. A Product
Owner looking at the admin UI sees only the features that went through
`start_feature`, which is a partial and skewed picture of where the team's
effort actually goes.

This change records every routing decision as a **routing event**, one row
per unit of work (deduplicated by ticket id or by normalized task text, not
per call), lets the host **link commits** to routing events and features via
a new `record_commit` tool, and adds a **Work** tab to the admin UI that
shows all routed work — formal features and trivial fixes alike, clearly
distinguished — filterable by app and date range.

The server still never reads a repository. Commits are reported by the host,
the same way `files_changed` is reported today in verify evidence.

## 2. Goals

- Every call to `route_task` leaves a durable, app-scoped, dated record,
  without turning repeated calls for the same task into noise.
- A PO can see, for any app and date range, everything that was routed:
  intent, framework, ticket, whether it became a feature (and that feature's
  status), and which commits landed for it.
- Trivial work has a meaningful "done" signal: at least one linked commit.
- A ticket id (Linear, Jira) can be attached to routed work and travels to
  the commit link, so ticket → routing → commits → files is queryable — the
  seed of a future traceability matrix.
- `start_feature` and `record_commit` stay idempotent under client retries.

## 3. Non-goals

- Reading git, cloning repositories, or verifying that a reported commit
  exists. The host is trusted, as it is for verify evidence.
- Forge webhooks (GitHub/GitLab push events). The `commits` table is designed
  so a webhook can feed it later (`source = 'webhook'`), but no endpoint is
  built now.
- A *merged* or *deployed* state for commits. `branch` is recorded; merge
  status needs the webhook.
- Global date/app filters across the existing Overview, Flow, Apps and
  Proposals views. Only the new Work tab filters in v1; the API parameters it
  introduces (`app`, `from`, `to`) are reusable later.
- Clickable links to Jira/Linear. `external_ref` is shown as text; a per-app
  tracker base URL is a later addition.
- Retention, archival or deletion of routing events and commits.
- Backfilling routing events for features created before this change.

## 4. Data model

One additive migration. No existing table changes.

### 4.1 `routing_events` — one row per unit of routed work

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `r_` + lowercase ULID (new prefix) |
| `app_id` | text, FK `apps` | |
| `identity_key` | text | dedup key, see 4.3; `UNIQUE (app_id, identity_key)` |
| `external_ref` | text null | ticket id, e.g. `YAL-123` |
| `trigger_ref` | text null | incident id, CVE, alert |
| `task_description` | text | latest text supplied |
| `decision` | jsonb | latest full `Decision` (intent, framework, track, confidence, rule, reasons, high_risk, policy_version, framework_pack_version) |
| `intent` | text | denormalized from `decision` for grouping |
| `framework` | text | denormalized; `none` for spike/trivial |
| `lite` | boolean | a lite pack was returned |
| `workspace` | jsonb null | latest workspace facts (`paths_touched` etc.) |
| `route_count` | integer, default 1 | incremented by `route_task` only |
| `first_routed_at` | timestamptz | |
| `last_routed_at` | timestamptz | |
| `feature_id` | text null, FK `features` | set when the work becomes a feature |
| `created_at`, `updated_at`, `created_by` | audit | `created_by` = `actor` or `host` |

### 4.2 `commits` — host-reported commits linked to work

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `cm_` + lowercase ULID (new prefix) |
| `app_id` | text, FK `apps` | |
| `sha` | text | 7–64 lowercase hex; `UNIQUE (app_id, sha)` |
| `branch` | text null | |
| `message` | text | ≤ 10 000 chars |
| `files_changed` | text[] default `{}` | ≤ 500 entries, each ≤ 512 chars |
| `committed_at` | timestamptz null | author date as reported by the host |
| `routing_id` | text null, FK `routing_events` | |
| `feature_id` | text null, FK `features` | |
| `source` | text | `'host'` (default) or `'webhook'`; `CHECK` |
| `created_at`, `updated_at`, `created_by` | audit | |

`CHECK (routing_id IS NOT NULL OR feature_id IS NOT NULL)`: a commit must be
anchored to something.

### 4.3 Identity and dedup

`identity_key` is computed server-side from the call's inputs:

- If `external_ref` is present: `ticket:` + `external_ref` trimmed and
  upper-cased. Ticket ids are treated as case-insensitive.
- Otherwise: `text:` + SHA-256 of `task_description` lower-cased, trimmed,
  with runs of whitespace collapsed to one space.

`route_task` upserts with `INSERT … ON CONFLICT (app_id, identity_key) DO
UPDATE`, setting `decision`, `intent`, `framework`, `lite`,
`task_description`, `workspace` to the new values, `route_count =
route_count + 1`, `last_routed_at = now()`, and `external_ref = COALESCE(new,
existing)` so a ticket attached later is kept. There is no time window: the
same identity is the same work, whenever it is routed again.

Documented edge: the same task routed first without a ticket and later with
one produces two rows (different identities). v1 does not try to merge them.

## 5. Tool changes

### 5.1 `route_task`

Input gains three optional fields, all attribution-only for routing itself:
`actor` (string), `external_ref` (string), `trigger_ref` (string). Existing
hosts that omit them keep working unchanged.

Flow: decide → upsert routing event (4.3) → build lite pack if trivial →
return. The upsert is one statement inside the same call; if it fails, the
call fails (the database is already required for `requireApp`; there is no
"route without a database" mode).

Output gains `routing_id`. Two calls with the same identity return the same
`routing_id`.

When a lite pack is returned, its rendered text ends with a new line:
`When you commit, call record_commit with routing_id "<id>".` — the same
mechanism phase instructions use to tell the host when to call
`advance_phase`.

The tool description drops "It is read-only and writes nothing" and states
instead that it records a routing event, idempotently per task identity.

### 5.2 `start_feature`

Invariant introduced: **every feature has exactly one routing event.**

Input gains optional `routing_id`. If present, it must exist (else
`ROUTING_EVENT_NOT_FOUND`) and belong to the same app (else
`VALIDATION_ERROR`, field `routing_id`); on success
`routing_events.feature_id` is set to the new feature.

If absent, `start_feature` computes the identity from
`(external_ref ?? task_description)` with the rules in 4.3 and:
- links the existing event if one exists with `feature_id IS NULL`;
- creates the event from the supplied `decision` if none exists (a host
  that skipped `route_task`), then links it. An event created this way has
  `route_count = 0`: the count means "calls to `route_task`", and there were
  none.

`start_feature` never increments `route_count`. If the resolved event already
has a different `feature_id`, the call fails with `VALIDATION_ERROR` — one
unit of work does not become two features.

`renderPhaseInstructions` adds one line to every phase's instructions:
`After each commit, call record_commit with feature_id "<id>".`

### 5.3 `record_commit` (new tool)

Input: `app` (slug), `actor`, `sha`, `message`; optional `branch`,
`files_changed[]`, `committed_at` (ISO 8601); and exactly one anchor among
`routing_id`, `feature_id`, `external_ref`.

`sha` is accepted in either case and stored lower-cased.

Anchor resolution, all scoped to `app`:
- `feature_id` → must exist (`FEATURE_NOT_FOUND`) and belong to the app
  (`VALIDATION_ERROR`); also sets `routing_id` from the feature's linked
  event when there is one.
- `routing_id` → must exist (`ROUTING_EVENT_NOT_FOUND`) and belong to the
  app (`VALIDATION_ERROR`); also sets `feature_id` from the event when it
  has one.
- `external_ref` → looks up `ticket:<REF>` in the app; if none,
  `VALIDATION_ERROR` with the message
  `no routing event for <REF> in <app>; call route_task first or pass routing_id`.
- No anchor → `VALIDATION_ERROR`.

Dedup by `(app_id, sha)`: re-reporting the same commit updates `message`,
`branch`, `files_changed`, `committed_at`, and **fills null anchors without
overwriting existing ones**. Client retries are safe.

Output: `{ commit_id, routing_id, feature_id, deduplicated }` where
`deduplicated` is true when the row already existed.

Size limits from 4.2 are enforced by the input schema; violations are
`VALIDATION_ERROR`.

### 5.4 Commit message convention (recommendation, not a dependency)

Hosts are advised to add a trailer `SDD-Ref: <routing_id or feature_id>`
to commit messages so git history is self-describing and a future webhook
can link commits without the host calling `record_commit`. Nothing in the
server parses it in v1.

## 6. Admin API

Two new `GET` routes on the existing authenticated `/admin` router. Both use
the same `handle()` wrapper, so `APP_NOT_FOUND` → 404, `ZodError` → 400,
anything else → 503.

### 6.1 `GET /admin/api/routing?app=&from=&to=&limit=`

Query schema: `app` optional slug; `from`, `to` optional calendar dates
(`YYYY-MM-DD`), interpreted as UTC day boundaries — `from` at 00:00:00 and
`to` at 23:59:59.999, both inclusive; `limit` optional integer 1–500,
default 200. A `.refine` rejects `from > to` with the message
`from must be on or before to` — a 400, not a 503.

Response `{ events, summary }`:
- `events`: routing events ordered by `last_routed_at DESC`, each joined
  with the linked feature's `slug`, `status`, `current_phase` (nullable) and
  a `commit_count`.
- `summary`: `[{ intent, count }]` over the same filter.

Date filter is by **overlap**: `first_routed_at <= to AND last_routed_at >=
from`. Work routed in August and re-routed in September appears in both
months' views.

### 6.2 `GET /admin/api/routing/:id`

Response `{ event, commits }`: the full event (decision reasons, workspace,
route_count, first/last routed) and its commits ordered by `committed_at`
then `created_at`.

An unknown id raises a new `ROUTING_EVENT_NOT_FOUND` domain error code,
added to `ERROR_PRECEDENCE` next to `FEATURE_NOT_FOUND` and to the 404
branch of the admin router's `handle()` wrapper.

## 7. Admin UI — the Work tab

A fifth tab, **Work**, following the existing `useState` navigation.

- **Filter bar**: app `<select>` populated from `/admin/api/apps`, `from`
  and `to` as `<input type="date">`, an Apply button. When `from > to`, Apply
  is disabled and an inline error shows; the server's 400 is the safety net,
  not the UX.
- **Summary tiles** from `summary`, one per intent.
- **Table** columns: last routed, app, type badge, ticket, task (truncated),
  framework/track, feature status, commits. The type badge is `feature` when
  `feature_id` is set, `lite` when a lite pack was returned, otherwise the
  intent (`spike`, `incident`, …); an intent of `feature` or `product`
  that has not been started yet shows as `<intent> · not started`, so it is
  never confused with a formal feature. `external_ref` is plain text.
- **Row click** → inline detail (same technique as `FeatureDetail`, with a
  Back button): decision reasons, `workspace.paths_touched`, route count,
  first/last routed, and the commits list (short sha, branch, first message
  line, file count, expandable file list). If the event has a feature, a link
  opens the existing `FeatureDetail` for it.
- Empty / loading / error states as in the other views
  (`No routed work in this range.`).

`admin-ui/src/types.ts` gains `RoutingEvent`, `RoutingSummary`, `Commit`,
duplicated from the backend shapes per the existing convention.

## 8. Error handling

- Routing-event upsert failure inside `route_task`: the call fails; no
  partial state (single statement).
- `start_feature` with a cross-app `routing_id`, or an event already linked
  to another feature: `VALIDATION_ERROR`, feature not created (the check runs
  inside the existing transaction before `createFeature`).
- `record_commit` with no resolvable anchor: `VALIDATION_ERROR`; nothing
  written.
- Admin API: invalid dates or `from > to` → 400 with the refine message;
  unknown app slug → 404; unknown routing id → 404.

## 9. Testing

- **Unit**: identity-key normalization (ticket case-insensitive; task text
  differing only in case/whitespace → same hash); date-range schema.
- **Integration, store**: routing-event upsert (same ticket twice → one row,
  `route_count` 2; same text in two apps → two rows; text vs ticket → two
  rows); commit upsert (same sha → one row, null anchors filled, existing
  anchors kept); `listRoutingEvents` app filter and overlap semantics;
  intent summary.
- **Integration, services**: `routeTask` writes and returns a stable
  `routing_id`; lite pack text contains the `record_commit` instruction with
  that id; `startFeature` links by explicit id, auto-links by identity,
  creates when missing, rejects cross-app and already-linked events;
  `recordCommit` with each anchor kind and each error.
- **Contract (stdio)**: `route_task` idempotent across two calls;
  `record_commit` end to end; both admin routes with filters; 400 when
  `from > to`.
- **admin-ui**: Work view renders rows and tiles from mocked responses;
  changing filters fetches with `?app=&from=&to=`; invalid range disables
  Apply; row detail shows commits. Output pristine — every `fetch` the view
  performs is stubbed, including the apps list for the select.
- The existing migration test applies the new migration on an empty
  database.

## 10. Documentation

- `src/mcp/tools/routeTask.ts` description: replace "read-only and writes
  nothing" with the routing-event behaviour and `routing_id`.
- `docs/verification/host-integration.md`: the recommended sequence
  `route_task` → `start_feature` with `routing_id` → `record_commit` after
  each commit, plus the `SDD-Ref` trailer convention.
- `README.md`: section 4 mentions `routing_id`; section 8 mentions the Work
  tab and its filters.
- `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`: a one-line
  note where `route_task` is described as read-only, pointing here.

## 11. Rollout

Additive migration; existing tables untouched. Hosts that do not send the
new optional fields behave as before and simply do not receive
`routing_id`. Routing events accumulate from deployment onward; features
created earlier have no event until they are touched again, and the Work
tab shows that gap rather than fabricating history.

## 12. Deviation from the v1 design

The v1 spec and the tool description state that `route_task` "is read-only
and writes nothing". This spec revises that: `route_task` records a routing
event. It still does not touch repositories or lifecycle state, and the
write is idempotent per task identity, so repeated exploratory calls do not
accumulate rows. The reason is the PO use case in section 1: without a
record of routed work, the admin UI shows only the formal minority of what
the team does.

## 13. Alternatives considered

- **Record only trivial routings.** Smaller, but the Work tab would then
  need to union `features` to show effort, with two sources of truth and no
  link between a feature and the routing that produced it. Recording every
  routing and linking features to it keeps one source.
- **Time-window dedup** (same app + text within 24h). Rejected in favour of
  identity-based dedup: re-routing the same ticket a week later is the same
  work, not new work, and the ticket id is the natural key when present.
- **Forge webhooks instead of `record_commit`.** Automatic and covers human
  commits, but requires external reachability, a webhook secret and
  forge-specific payloads — outside v1's network-restricted, no-auth
  posture. The `commits` table is designed so a webhook can feed it later.
- **Commit-message trailers only, no table.** The server cannot read git,
  so the admin could not show anything. Kept as a recommendation alongside
  `record_commit`.
- **A `close_task` tool to mark trivial work done.** Superseded: a linked
  commit is the done signal, and it carries more information (files, sha).
