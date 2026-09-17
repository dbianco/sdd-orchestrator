# Admin UI: Adoption and Flow Metrics — Design Specification

**Status:** Draft for review
**Date:** 2026-09-17
**Implements:** roadmap item "Adoption and flow metrics" (design spec section
14.1, `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`)

## 1. Summary

An optional, read-only admin web app that lets a human browse the data the
server already stores: features by app/status/phase/framework, gate pass/fail
rates by check, phase-to-phase transition flow, and the memory-proposal
queue. It is a single-page app (React + Vite) served as static assets from
the existing Express server, backed by a small set of new read-only JSON
endpoints. Both the UI and the API are registered only when an admin token is
configured; otherwise they do not exist on the server at all.

This was motivated by a real gap surfaced during a separate investigation:
diagnosing why the `verify->integrate` gate was failing 35% of the time
required hand-written SQL against the production database. This feature
turns that kind of investigation into a page anyone with the admin token can
open.

## 2. Goals

- Let an admin see, without writing SQL: feature counts by status/phase/
  framework/track; gate pass/fail rate by check; phase-to-phase transition
  flow; the memory-proposal queue (pending/approved/rejected); knowledge base
  composition by kind.
- Let an admin drill from an app into its features into one feature's full
  phase-transition history and findings.
- Ship as a genuinely optional layer: absent from the server's behavior,
  routes, and attack surface unless explicitly configured.
- Reuse existing data with no new tables — every view is a query over
  `apps`, `features`, `phase_transitions`, `context_packs`, `proposals`,
  `knowledge_items`.

## 3. Non-goals

- Any action that mutates state (approving/rejecting proposals, editing
  policy, re-ingesting packs). This is a read-only observability surface;
  those actions stay in `sdd-admin`. A follow-up could extend this UI to
  cover them once there's real demand and a stronger auth story.
- A user/role system. Access control is a single shared credential, not
  identity.
- Historical trend storage or a time-series backend. All views compute from
  current table state on demand; this is a monitoring page, not a warehouse.
- Deep-linking to a specific app/feature via URL. Navigation is in-page
  React state; nothing is bookmarkable in v1.
- An MCP resource or `sdd-admin report` exposing this data — this spec is
  scoped to the browser UI. A CLI/agent-facing surface over the same
  `store/analytics.ts` queries is straightforward to add later and is not
  precluded by anything here, but it is out of scope for this change.

## 4. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │      Express app (src/mcp/http.ts)       │
                    │                                           │
  MCP host  ──POST──►  /mcp  (existing, unauthenticated)        │
                    │                                           │
  anyone    ──GET───►  /healthz, /metrics  (existing)            │
                    │                                           │
                    │  ── only when SDD_ADMIN_TOKEN is set ──   │
  admin     ──GET───►  /admin/*        (adminAuth middleware)   │
                    │      ├─ static assets (admin-ui/dist)     │
                    │      └─ /admin/api/*  (JSON, read-only)   │
                    └─────────────────┬─────────────────────────┘
                                       │
                                       ▼
                         src/store/analytics.ts
                         (aggregate SQL over existing tables)
                                       │
                                       ▼
                               Postgres (existing)
```

`admin-ui/` is a standalone Vite + React + TypeScript project at the repo
root, with its own `package.json`, `tsconfig.json` and `vite.config.ts`. It
is built independently of the server (`npm run build` for the server does
not depend on it) and produces static assets consumed only by
`src/web/adminRoutes.ts`.

## 5. Configuration and gating

`Config` (`src/config.ts`) gains one optional field:

```ts
adminToken: z.string().min(1).optional() // SDD_ADMIN_TOKEN
```

`createHttpApp` (`src/mcp/http.ts`) registers the `/admin` router only when
`config.adminToken` is set:

```ts
if (config.adminToken) app.use('/admin', createAdminRouter(deps, config.adminToken));
```

When unset, any request to `/admin/*` gets Express's normal 404 — there is
no code path that even checks for credentials. This is the same posture as
`SDD_LISTEN`/`SDD_ALLOWED_HOSTS` already gating the MCP HTTP transport: a
feature is either fully wired or fully absent, never present-but-disabled.

`.env.example` and `docker-compose.yml` both gain `SDD_ADMIN_TOKEN=` (blank),
documenting the opt-in without turning it on for anyone who copies the
example file verbatim.

## 6. Authentication

HTTP Basic Auth, applied by `src/web/adminAuth.ts` to every request under
`/admin` (static assets and API alike):

- Missing or malformed `Authorization` header → `401` with
  `WWW-Authenticate: Basic realm="sdd-admin"`, so the browser shows its
  native login prompt.
- Present but wrong credential → `401`, same header, no distinction in the
  response between "wrong" and "malformed" (nothing for an attacker to learn
  from the difference).
- Comparison uses `crypto.timingSafeEqual` on the decoded password against
  `config.adminToken`, so response timing does not leak how many characters
  matched. The username portion of Basic Auth is not checked — the token is
  a shared secret, not an identity.

No sessions, no cookies. The browser caches the credential per-origin after
the first prompt and replays it automatically on every subsequent same-origin
`fetch()` the SPA makes, so the frontend never handles the token directly.
This also means there is no cookie-based CSRF surface to reason about; the
only mutating verb accepted anywhere under `/admin` is none — every route is
`GET`.

## 7. Data model and API

No new tables. `src/store/analytics.ts` adds read-only aggregate queries
over existing tables:

| Function | Reads | Returns |
|---|---|---|
| `featureCounts(appId?)` | `features` | counts grouped by status, current_phase, framework, track |
| `gateCheckStats(appId?)` | `phase_transitions.findings` (unnested) | per check name: how many transitions it contributed a blocker finding to vs. only a warning finding, across all transitions where that check ran |
| `flowCounts(appId?)` | `phase_transitions` | counts grouped by `(from_phase, to_phase, result)` |
| `proposalsSummary()` | `proposals` | counts by status |
| `listProposals()` *(existing, `src/store/proposals.ts`)* | `proposals` | full rows for one status, reused as-is for the Proposals list view |
| `knowledgeCounts()` | `knowledge_items` | counts by kind/memory_type |
| `featureTimeline(featureId)` | `phase_transitions` for one feature | ordered transition history with findings |

`src/web/adminRoutes.ts` exposes these directly, with `appId`/`app` as an
optional query-string filter, validated with the same zod-in-the-handler
convention the CLI commands already use:

| Route | Backs |
|---|---|
| `GET /admin/api/overview` | `featureCounts` + `gateCheckStats` + `proposalsSummary` + `knowledgeCounts`, one combined payload for the dashboard's single fetch |
| `GET /admin/api/apps` | apps list, each with its `featureCounts` rollup |
| `GET /admin/api/apps/:app/features` | that app's features (status, phase, framework, track, updated_at) |
| `GET /admin/api/features/:id` | feature header + `featureTimeline` |
| `GET /admin/api/flow?app=` | `flowCounts`, globally or scoped to one app |
| `GET /admin/api/proposals?status=` | existing `listProposals` (default: all statuses), for the Proposals list view |

Route handlers call `store/analytics.ts` directly; there is no separate
service layer, since there is no domain logic or transaction beyond a
validated read.

## 8. Frontend

Single page, no client-side router — navigation is a `useState` tab
(`'overview' | 'apps' | 'flow' | 'proposals'`) plus a `selectedFeatureId` for
the drill-down view, all held in React state. This avoids needing an
SPA-fallback route in Express for something explicitly optional.

**Views:**
- **Overview** — tiles from `/admin/api/overview`: features by status,
  proposals pending/approved, knowledge item counts, and the checks with the
  worst pass rate.
- **Apps & Features** — apps table → one app's features → one feature's
  transition timeline (from→to, result, findings, human_approved,
  timestamp).
- **Flow** — a heatmap matrix (rows = `from_phase`, columns = `to_phase`,
  cell = count tinted by fail rate), hand-built as inline SVG. With at most
  8 phases (7 + `archived`) a matrix needs no graph-layout library and reads
  more directly than a force-directed diagram for "which gate fails a lot."
- **Proposals** — pending/approved/rejected list.

**Data fetching:** plain `fetch()` to `/admin/api/*`, no state-management
library — the credential is replayed automatically by the browser.

**Styling:** hand-written CSS, no UI kit — the surface area is tables and
tiles, not enough to justify a component library's weight.

**Types:** `admin-ui/src/types.ts` hand-declares the response shapes from
section 7. This duplicates a handful of small, stable interfaces rather than
sharing types across the two independently-built packages, trading a little
duplication for avoiding TS project-reference wiring between them.

## 9. Error handling

- Database unreachable → analytics routes return `503 {error: "unreachable"}`
  (mirrors `/healthz`'s existing degraded pattern); the frontend shows an
  error banner instead of a blank page.
- Unknown `feature_id` → `404`; frontend shows "feature not found".
- Empty states (no apps, no features, no proposals yet) render an explicit
  "nothing yet" message rather than an empty table.

## 10. Testing

**Backend:**
- `test/integration/store/analytics.test.ts` — seeds features/
  phase_transitions/proposals against the real test database and asserts
  each aggregate query, following the existing `test/integration/store/*`
  pattern.
- `test/unit/web/adminAuth.test.ts` — 401 with no/wrong credentials
  (asserting the `WWW-Authenticate` header), pass-through with the correct
  token.
- `test/contract/adminRoutes.test.ts` — exercises `/admin/api/*` end to end
  through the real Express app (style of the existing
  `test/contract/http.test.ts`), and asserts the routes return a plain `404`
  — not `401` — when `SDD_ADMIN_TOKEN` is unset, proving the feature is
  absent, not merely locked.

**Frontend:** `admin-ui/` gets its own Vitest config (Vitest +
`@testing-library/react` + jsdom), run via `npm --prefix admin-ui test`,
separate from the root `vitest.config.ts` so the server's test run stays
scoped to the server. Component tests mock `fetch` and assert each view
renders its key numbers/rows from sample JSON; not exhaustive, one or two
tests per view. No Playwright/e2e in this iteration; a manual click-through
of a built preview in a browser is the acceptance check for the UI itself,
consistent with how UI changes are normally verified in this workflow.

## 11. Build and deployment

- New root script `build:admin-ui` (`npm --prefix admin-ui run build`). The
  server's own `build` script is untouched, so local server dev/test never
  requires the frontend toolchain.
- `Dockerfile`'s build stage runs both `npm run build` and
  `npm run build:admin-ui`; the final stage copies `admin-ui/dist` in
  alongside the server's `dist/`. The assets are always present in the
  image but inert unless `SDD_ADMIN_TOKEN` is set at runtime.
- `.env.example` and `docker-compose.yml` gain `SDD_ADMIN_TOKEN` (blank by
  default).
- No `.gitignore` changes: its unscoped `node_modules/` and `dist/` entries
  already match `admin-ui/node_modules` and `admin-ui/dist`.

## 12. Alternatives considered

- **Server-rendered HTML, no client framework.** Would have avoided adding a
  build pipeline entirely (template literals, matching
  `src/assembler/render.ts`'s style). Rejected in favor of the richer,
  filterable interactivity a real frontend gives, which the requester
  explicitly wanted over the smaller-footprint option.
- **Defer the UI; ship `sdd-admin report` / an MCP resource only.** Smallest
  possible change and still delivers the underlying metrics. Rejected
  because it doesn't satisfy the actual ask — browsing the data in a
  browser — though nothing here precludes adding a CLI/agent-facing surface
  over the same `store/analytics.ts` queries later.
- **Separate process/service for the admin app.** Cleaner security
  perimeter, independent scaling. Rejected as disproportionate to an
  explicitly optional, read-only feature — it would double the deployment
  surface (a second container, a second port to document and firewall) for
  a page most installs will never turn on.
- **Session-based auth (login form + cookie) instead of HTTP Basic.**
  Would look more like a "real" web app login. Rejected because it adds
  session storage and CSRF considerations for no real benefit over Basic
  Auth, given the credential is a shared secret rather than an identity.

## 13. Rollout

No migration, no data backfill. The feature is inert until an operator sets
`SDD_ADMIN_TOKEN`. Existing deployments are unaffected by upgrading past
this change unless they opt in.
