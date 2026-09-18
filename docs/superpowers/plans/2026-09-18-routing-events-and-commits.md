# Routing Events and Commits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every `route_task` decision as a deduplicated routing event, link every feature to one, let hosts anchor commits to routings/features via a new `record_commit` tool, and show all routed work in a date/app-filtered **Work** tab of the admin UI.

**Architecture:** One additive migration (`routing_events`, `commits`). Two new store modules (`src/store/routingEvents.ts`, `src/store/commits.ts`) with identity-based upserts. `routeTask` upserts an event and returns `routing_id`; `startFeature` links or creates the event; a new `recordCommit` service + MCP tool anchors commits. Two new admin JSON routes and a new React view. The server never reads git — commits are host-reported, like verify evidence.

**Tech Stack:** TypeScript, Express, Postgres (`pg`, `node-pg-migrate`), zod, MCP SDK; React 18 + Vite + Vitest/Testing Library in `admin-ui/`.

**Spec:** `docs/superpowers/specs/2026-09-18-routing-events-and-commits-design.md`

## Global Constraints

- The server never reads or writes a repository. `record_commit` stores what the host reports.
- Dedup identity: `ticket:<EXTERNAL_REF trimmed, upper-cased>` when `external_ref` is present, else `text:<sha256 of task_description lower-cased, trimmed, whitespace collapsed to single spaces>`. `UNIQUE (app_id, identity_key)`. No time windows.
- `route_count` counts calls to `route_task` only. Events created by `start_feature` start at 0; `start_feature` never increments it.
- Every feature created from now on has exactly one routing event (`routing_events.feature_id`). An event already linked to a different feature cannot be linked again (`VALIDATION_ERROR`).
- `commits`: `UNIQUE (app_id, sha)`, sha stored lower-cased, `CHECK (routing_id IS NOT NULL OR feature_id IS NOT NULL)`. Re-reporting a sha updates `message`/`files_changed`, keeps non-null `branch`/`committed_at` unless a new value is given, and fills null anchors without overwriting existing ones.
- New domain error code `ROUTING_EVENT_NOT_FOUND`, placed right after `FEATURE_NOT_FOUND` in `ERROR_PRECEDENCE`, and mapped to 404 by the admin router.
- Admin `from`/`to` are `YYYY-MM-DD`, UTC day boundaries, inclusive; `from > to` is a 400 (`from must be on or before to`). Date filter is by overlap: `first_routed_at <= to AND last_routed_at >= from`.
- `src/` uses NodeNext ESM (`.js` on relative imports); `admin-ui/src/` uses Bundler resolution (no extension). Never mix.
- Test output must be pristine (no warnings). Backend integration/contract tests need `npm run db:test:up` and `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test` prefixed on `vitest`.
- New id prefixes: `r_` (routing events), `cm_` (commits), via `newId()`.

---

### Task 1: Migration, row types, error code, test helpers

**Files:**
- Create: `migrations/1758153600000_routing_events_and_commits.js`
- Modify: `src/store/rows.ts`, `src/errors.ts`, `test/helpers/db.ts`
- Test: `test/integration/db/migrate.test.ts`

**Interfaces:**
- Produces: tables `routing_events` and `commits`; `RoutingEventRow`, `CommitRow` in `src/store/rows.ts`; error code `'ROUTING_EVENT_NOT_FOUND'` in `ErrorCode`.

- [ ] **Step 1: Write the failing test**

In `test/integration/db/migrate.test.ts`, extend the table list in `'creates every table and the extensions'`:

```ts
    for (const t of ['apps', 'app_policies', 'frameworks', 'embedding_config', 'features', 'context_packs',
      'phase_transitions', 'feature_artifacts', 'knowledge_items', 'knowledge_chunks', 'proposals', 'routing_events', 'commits']) {
      expect(names).toContain(t);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run db:test:up` (if not running), then `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/db/migrate.test.ts`
Expected: FAIL — `routing_events` not in the table list.

- [ ] **Step 3: Write the migration, row types, error code and helper**

Create `migrations/1758153600000_routing_events_and_commits.js`:

```js
export const shorthands = undefined;

const audit = `
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL`;

export const up = (pgm) => {
  pgm.sql(`CREATE TABLE routing_events (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    identity_key text NOT NULL,
    external_ref text,
    trigger_ref text,
    task_description text NOT NULL,
    decision jsonb NOT NULL,
    intent text NOT NULL,
    framework text NOT NULL,
    lite boolean NOT NULL DEFAULT false,
    workspace jsonb,
    route_count integer NOT NULL DEFAULT 1,
    first_routed_at timestamptz NOT NULL DEFAULT now(),
    last_routed_at timestamptz NOT NULL DEFAULT now(),
    feature_id text REFERENCES features(id),
    ${audit},
    UNIQUE (app_id, identity_key)
  )`);
  pgm.sql(`CREATE INDEX routing_events_app_last_idx ON routing_events (app_id, last_routed_at DESC)`);
  pgm.sql(`CREATE INDEX routing_events_feature_idx ON routing_events (feature_id)`);

  pgm.sql(`CREATE TABLE commits (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    sha text NOT NULL,
    branch text,
    message text NOT NULL,
    files_changed text[] NOT NULL DEFAULT '{}',
    committed_at timestamptz,
    routing_id text REFERENCES routing_events(id),
    feature_id text REFERENCES features(id),
    source text NOT NULL DEFAULT 'host' CHECK (source IN ('host', 'webhook')),
    ${audit},
    UNIQUE (app_id, sha),
    CHECK (routing_id IS NOT NULL OR feature_id IS NOT NULL)
  )`);
  pgm.sql(`CREATE INDEX commits_routing_idx ON commits (routing_id)`);
  pgm.sql(`CREATE INDEX commits_feature_idx ON commits (feature_id)`);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS commits CASCADE`);
  pgm.sql(`DROP TABLE IF EXISTS routing_events CASCADE`);
};
```

Append to `src/store/rows.ts`:

```ts
export interface RoutingEventRow extends Audit {
  id: string; app_id: string; identity_key: string; external_ref: string | null; trigger_ref: string | null; task_description: string;
  decision: Decision; intent: string; framework: string; lite: boolean; workspace: Workspace | null; route_count: number;
  first_routed_at: Date; last_routed_at: Date; feature_id: string | null;
}
export interface CommitRow extends Audit {
  id: string; app_id: string; sha: string; branch: string | null; message: string; files_changed: string[]; committed_at: Date | null;
  routing_id: string | null; feature_id: string | null; source: 'host' | 'webhook';
}
```

In `src/errors.ts`, add the new code right after `'FEATURE_NOT_FOUND'`:

```ts
export const ERROR_PRECEDENCE = [
  'VALIDATION_ERROR',
  'APP_NOT_FOUND',
  'FEATURE_NOT_FOUND',
  'ROUTING_EVENT_NOT_FOUND',
  'UNKNOWN_FRAMEWORK',
  'FEATURE_ARCHIVED',
  'STALE_STATE',
  'FEATURE_BLOCKED',
  'PHASE_ORDER_VIOLATION',
  'EMBEDDING_MODEL_MISMATCH',
] as const;
```

In `test/helpers/db.ts`, prepend the two new tables to `truncateAll` (they reference `features`/`apps`, so they must be truncated too):

```ts
export async function truncateAll(p: pg.Pool): Promise<void> {
  await p.query(`TRUNCATE commits, routing_events, proposals, knowledge_chunks, knowledge_items, feature_artifacts, phase_transitions,
    context_packs, features, embedding_config, frameworks, app_policies, apps RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/db/migrate.test.ts test/integration/store` and `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add migrations/1758153600000_routing_events_and_commits.js src/store/rows.ts src/errors.ts test/helpers/db.ts test/integration/db/migrate.test.ts
git commit -m "feat(db): routing_events and commits tables"
```

---

### Task 2: Routing-event store

**Files:**
- Create: `src/store/routingEvents.ts`
- Test: `test/unit/store/routingIdentity.test.ts`, `test/integration/store/routingEvents.test.ts`

**Interfaces:**
- Consumes: `RoutingEventRow`, `newId`, `DomainError`, `Queryable`, `Decision`, `Workspace`.
- Produces:
  - `identityKey(externalRef: string | null | undefined, taskDescription: string): string`
  - `upsertRoutingEvent(q, e: RoutingEventInput, actor: string, opts: { countRoute: boolean }): Promise<RoutingEventRow>` where `RoutingEventInput = { app_id; external_ref: string | null; trigger_ref: string | null; task_description; decision: Decision; lite: boolean; workspace: Workspace | null }`
  - `getRoutingEvent(q, id): Promise<RoutingEventRow | null>`, `requireRoutingEvent(q, id): Promise<RoutingEventRow>` (throws `ROUTING_EVENT_NOT_FOUND`)
  - `findRoutingEventByIdentity(q, appId, key): Promise<RoutingEventRow | null>`, `findRoutingEventByFeature(q, featureId): Promise<RoutingEventRow | null>`
  - `linkRoutingEventToFeature(q, routingId, featureId): Promise<RoutingEventRow>`
  - `listRoutingEvents(q, f: RoutingFilter & { limit: number }): Promise<RoutingEventListRow[]>` where `RoutingFilter = { appId: string | null; from: Date | null; to: Date | null }` and `RoutingEventListRow = RoutingEventRow & { app_slug: string; feature_slug: string | null; feature_status: string | null; feature_phase: string | null; commit_count: number }`
  - `routingSummary(q, f: RoutingFilter): Promise<{ intent: string; count: number }[]>`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/store/routingIdentity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { identityKey } from '../../../src/store/routingEvents.js';

describe('identityKey', () => {
  it('uses the ticket, trimmed and upper-cased, when present', () => {
    expect(identityKey(' yal-123 ', 'anything')).toBe('ticket:YAL-123');
    expect(identityKey('YAL-123', 'other text')).toBe('ticket:YAL-123');
  });
  it('falls back to a hash of the normalized task text', () => {
    const a = identityKey(null, 'Fix the  Date   picker');
    const b = identityKey('', 'fix the date picker ');
    expect(a).toMatch(/^text:[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(identityKey(null, 'fix the date range')).not.toBe(a);
  });
});
```

Create `test/integration/store/routingEvents.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll } from '../../helpers/seed.js';
import { createApp } from '../../../src/store/apps.js';
import { createFeature } from '../../../src/store/features.js';
import {
  identityKey, upsertRoutingEvent, findRoutingEventByIdentity, linkRoutingEventToFeature, listRoutingEvents, routingSummary, requireRoutingEvent,
} from '../../../src/store/routingEvents.js';
import type { Decision } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;
const trivial: Decision = { intent: 'trivial', framework: 'none', track: null, confidence: 'high', rule: '4-trivial', reasons: [], high_risk: false, policy_version: null, framework_pack_version: null };
const feature: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('routing events store', () => {
  let pool: pg.Pool;
  let appId: string;
  let billingId: string;

  beforeEach(async () => {
    pool = await getTestPool();
    await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    billingId = (await createApp(pool, { slug: 'billing', name: 'Billing' }, 'seed')).id;
  });
  afterAll(closeTestPool);

  const base = (over: Partial<Parameters<typeof upsertRoutingEvent>[1]> = {}) => ({
    app_id: appId, external_ref: null, trigger_ref: null, task_description: 'Fix the date picker', decision: trivial, lite: true, workspace: null, ...over,
  });

  // Inserts a feature row directly (no lifecycle, no context pack) so this file tests the store alone.
  const newFeature = (slug: string) => createFeature(pool, {
    app_id: appId, slug, intent: 'feature', framework: 'mini', framework_pack_version: '1.0.0', track: 'default', high_risk: false,
    policy_version: null, policy_override_reason: null, source_task: slug, external_ref: null, trigger_ref: null, decision: feature, workspace: null,
  }, 'd');

  it('dedups by ticket, case-insensitively, bumping route_count and keeping the ticket', async () => {
    const first = await upsertRoutingEvent(pool, base({ external_ref: 'yal-1' }), 'd', { countRoute: true });
    const second = await upsertRoutingEvent(pool, base({ external_ref: 'YAL-1', task_description: 'Fix the date picker (again)' }), 'd', { countRoute: true });
    expect(second.id).toBe(first.id);
    expect(second.route_count).toBe(2);
    expect(second.task_description).toBe('Fix the date picker (again)');
    expect(second.last_routed_at.getTime()).toBeGreaterThanOrEqual(first.last_routed_at.getTime());
    expect((await pool.query('SELECT count(*)::int AS n FROM routing_events')).rows[0].n).toBe(1);
  });

  it('dedups by normalized text when there is no ticket, and countRoute: false does not bump', async () => {
    const a = await upsertRoutingEvent(pool, base(), 'd', { countRoute: true });
    const b = await upsertRoutingEvent(pool, base({ task_description: '  fix THE date   picker ' }), 'd', { countRoute: false });
    expect(b.id).toBe(a.id);
    expect(b.route_count).toBe(1);
    const c = await upsertRoutingEvent(pool, base({ external_ref: 'YAL-2' }), 'd', { countRoute: true });
    expect(c.id).not.toBe(a.id);
  });

  it('keeps the same text in two apps as two events', async () => {
    const a = await upsertRoutingEvent(pool, base(), 'd', { countRoute: true });
    const b = await upsertRoutingEvent(pool, base({ app_id: billingId }), 'd', { countRoute: true });
    expect(b.id).not.toBe(a.id);
    expect(await findRoutingEventByIdentity(pool, billingId, identityKey(null, 'Fix the date picker'))).toMatchObject({ id: b.id });
  });

  it('starts events created without a routing call at route_count 0', async () => {
    const e = await upsertRoutingEvent(pool, base(), 'd', { countRoute: false });
    expect(e.route_count).toBe(0);
  });

  it('lists with app and overlap date filters, joined feature state and commit counts, plus a summary', async () => {
    const old = await upsertRoutingEvent(pool, base({ task_description: 'Old fix' }), 'd', { countRoute: true });
    await pool.query(`UPDATE routing_events SET first_routed_at = '2026-01-10T00:00:00Z', last_routed_at = '2026-01-12T00:00:00Z' WHERE id = $1`, [old.id]);
    const recent = await upsertRoutingEvent(pool, base({ task_description: 'Recent fix', external_ref: 'YAL-9' }), 'd', { countRoute: true });
    const other = await upsertRoutingEvent(pool, base({ app_id: billingId, task_description: 'Billing spike', decision: { ...trivial, intent: 'spike', rule: '3-spike' }, lite: false }), 'd', { countRoute: true });
    const csvEvent = await upsertRoutingEvent(pool, base({ task_description: 'Add CSV export', decision: feature, lite: false }), 'd', { countRoute: true });
    const csvFeature = await newFeature('add-csv-export');
    await linkRoutingEventToFeature(pool, csvEvent.id, csvFeature.id);
    const all = await listRoutingEvents(pool, { appId: null, from: null, to: null, limit: 10 });
    expect(all.map((e) => e.id)).toEqual(expect.arrayContaining([old.id, recent.id, other.id, csvEvent.id]));
    const csv = all.find((e) => e.id === csvEvent.id)!;
    expect(csv).toMatchObject({ feature_id: csvFeature.id, feature_slug: 'add-csv-export', feature_status: 'active', feature_phase: 'specify', commit_count: 0, app_slug: 'checkout' });
    const checkoutOnly = await listRoutingEvents(pool, { appId, from: null, to: null, limit: 10 });
    expect(checkoutOnly.every((e) => e.app_id === appId)).toBe(true);
    expect(checkoutOnly.map((e) => e.id)).not.toContain(other.id);
    const january = await listRoutingEvents(pool, { appId: null, from: new Date('2026-01-11T00:00:00Z'), to: new Date('2026-01-31T23:59:59.999Z'), limit: 10 });
    expect(january.map((e) => e.id)).toEqual([old.id]);
    const future = await listRoutingEvents(pool, { appId: null, from: new Date('2099-01-01T00:00:00Z'), to: null, limit: 10 });
    expect(future).toEqual([]);
    const summary = await routingSummary(pool, { appId: null, from: null, to: null });
    expect(summary).toEqual(expect.arrayContaining([{ intent: 'trivial', count: 2 }, { intent: 'spike', count: 1 }, { intent: 'feature', count: 1 }]));
  });

  it('links to a feature and requires known ids', async () => {
    const e = await upsertRoutingEvent(pool, base(), 'd', { countRoute: true });
    const f = await newFeature('something-else');
    const linked = await linkRoutingEventToFeature(pool, e.id, f.id);
    expect(linked.feature_id).toBe(f.id);
    await expect(requireRoutingEvent(pool, 'r_nope')).rejects.toMatchObject({ code: 'ROUTING_EVENT_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/store/routingIdentity.test.ts` and `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/routingEvents.test.ts`
Expected: FAIL — cannot find module `src/store/routingEvents.js`.

- [ ] **Step 3: Write the store**

Create `src/store/routingEvents.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { Decision, Workspace } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { RoutingEventRow } from './rows.js';

export function identityKey(externalRef: string | null | undefined, taskDescription: string): string {
  const ref = externalRef?.trim();
  if (ref) return `ticket:${ref.toUpperCase()}`;
  const normalized = taskDescription.toLowerCase().trim().replace(/\s+/g, ' ');
  return `text:${createHash('sha256').update(normalized).digest('hex')}`;
}

export interface RoutingEventInput {
  app_id: string; external_ref: string | null; trigger_ref: string | null; task_description: string;
  decision: Decision; lite: boolean; workspace: Workspace | null;
}

export async function upsertRoutingEvent(q: Queryable, e: RoutingEventInput, actor: string, opts: { countRoute: boolean }): Promise<RoutingEventRow> {
  const key = identityKey(e.external_ref, e.task_description);
  const r = await q.query<RoutingEventRow>(
    `INSERT INTO routing_events (id, app_id, identity_key, external_ref, trigger_ref, task_description, decision, intent, framework, lite, workspace, route_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::int, $13)
     ON CONFLICT (app_id, identity_key) DO UPDATE SET
       external_ref = COALESCE(EXCLUDED.external_ref, routing_events.external_ref),
       trigger_ref = COALESCE(EXCLUDED.trigger_ref, routing_events.trigger_ref),
       task_description = EXCLUDED.task_description,
       decision = EXCLUDED.decision, intent = EXCLUDED.intent, framework = EXCLUDED.framework, lite = EXCLUDED.lite,
       workspace = EXCLUDED.workspace,
       route_count = routing_events.route_count + $12::int,
       last_routed_at = CASE WHEN $12::int > 0 THEN now() ELSE routing_events.last_routed_at END,
       updated_at = now()
     RETURNING *`,
    [newId('r'), e.app_id, key, e.external_ref, e.trigger_ref, e.task_description, JSON.stringify(e.decision), e.decision.intent, e.decision.framework,
      e.lite, e.workspace ? JSON.stringify(e.workspace) : null, opts.countRoute ? 1 : 0, actor],
  );
  return r.rows[0]!;
}

export async function getRoutingEvent(q: Queryable, id: string): Promise<RoutingEventRow | null> {
  const r = await q.query<RoutingEventRow>('SELECT * FROM routing_events WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function requireRoutingEvent(q: Queryable, id: string): Promise<RoutingEventRow> {
  const e = await getRoutingEvent(q, id);
  if (!e) throw new DomainError('ROUTING_EVENT_NOT_FOUND', `no routing event with id "${id}"`, { routing_id: id });
  return e;
}

export async function findRoutingEventByIdentity(q: Queryable, appId: string, key: string): Promise<RoutingEventRow | null> {
  const r = await q.query<RoutingEventRow>('SELECT * FROM routing_events WHERE app_id = $1 AND identity_key = $2', [appId, key]);
  return r.rows[0] ?? null;
}

export async function findRoutingEventByFeature(q: Queryable, featureId: string): Promise<RoutingEventRow | null> {
  const r = await q.query<RoutingEventRow>('SELECT * FROM routing_events WHERE feature_id = $1', [featureId]);
  return r.rows[0] ?? null;
}

export async function linkRoutingEventToFeature(q: Queryable, routingId: string, featureId: string): Promise<RoutingEventRow> {
  const r = await q.query<RoutingEventRow>('UPDATE routing_events SET feature_id = $2, updated_at = now() WHERE id = $1 RETURNING *', [routingId, featureId]);
  return r.rows[0]!;
}

export interface RoutingFilter { appId: string | null; from: Date | null; to: Date | null }
export interface RoutingEventListRow extends RoutingEventRow {
  app_slug: string; feature_slug: string | null; feature_status: string | null; feature_phase: string | null; commit_count: number;
}

const FILTER = `($1::text IS NULL OR e.app_id = $1) AND ($2::timestamptz IS NULL OR e.last_routed_at >= $2) AND ($3::timestamptz IS NULL OR e.first_routed_at <= $3)`;

export async function listRoutingEvents(q: Queryable, f: RoutingFilter & { limit: number }): Promise<RoutingEventListRow[]> {
  const r = await q.query<RoutingEventListRow>(
    `SELECT e.*, a.slug AS app_slug, f.slug AS feature_slug, f.status AS feature_status, f.current_phase AS feature_phase,
       (SELECT count(*)::int FROM commits c WHERE c.routing_id = e.id OR (e.feature_id IS NOT NULL AND c.feature_id = e.feature_id)) AS commit_count
     FROM routing_events e
     JOIN apps a ON a.id = e.app_id
     LEFT JOIN features f ON f.id = e.feature_id
     WHERE ${FILTER}
     ORDER BY e.last_routed_at DESC LIMIT $4`,
    [f.appId, f.from, f.to, f.limit],
  );
  return r.rows;
}

export async function routingSummary(q: Queryable, f: RoutingFilter): Promise<{ intent: string; count: number }[]> {
  const r = await q.query<{ intent: string; count: number }>(
    `SELECT e.intent, count(*)::int AS count FROM routing_events e WHERE ${FILTER} GROUP BY e.intent ORDER BY count DESC, e.intent`,
    [f.appId, f.from, f.to],
  );
  return r.rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run the same two commands as Step 2.
Expected: PASS (2 unit, 6 integration); `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/routingEvents.ts test/unit/store/routingIdentity.test.ts test/integration/store/routingEvents.test.ts
git commit -m "feat(store): routing events with identity-based dedup"
```

---

### Task 3: Commits store

**Files:**
- Create: `src/store/commits.ts`
- Test: `test/integration/store/commits.test.ts`

**Interfaces:**
- Produces:
  - `upsertCommit(q, c: NewCommit, actor: string): Promise<{ row: CommitRow; deduplicated: boolean }>` where `NewCommit = { app_id; sha; branch: string | null; message; files_changed: string[]; committed_at: Date | null; routing_id: string | null; feature_id: string | null }`
  - `listCommitsForRouting(q, event: { id: string; feature_id: string | null }): Promise<CommitRow[]>`

- [ ] **Step 1: Write the failing test**

Create `test/integration/store/commits.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll } from '../../helpers/seed.js';
import { upsertRoutingEvent } from '../../../src/store/routingEvents.js';
import { upsertCommit, listCommitsForRouting } from '../../../src/store/commits.js';
import type { Decision } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;
const trivial: Decision = { intent: 'trivial', framework: 'none', track: null, confidence: 'high', rule: '4-trivial', reasons: [], high_risk: false, policy_version: null, framework_pack_version: null };

describe.skipIf(!url)('commits store', () => {
  let pool: pg.Pool;
  let appId: string;
  let routingId: string;

  beforeEach(async () => {
    pool = await getTestPool();
    await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    routingId = (await upsertRoutingEvent(pool, { app_id: appId, external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix', decision: trivial, lite: true, workspace: null }, 'd', { countRoute: true })).id;
  });
  afterAll(closeTestPool);

  it('inserts, then dedups by sha keeping anchors and refreshing message/files', async () => {
    const first = await upsertCommit(pool, { app_id: appId, sha: 'abc1234', branch: 'main', message: 'fix: date picker', files_changed: ['src/a.css'], committed_at: new Date('2026-09-18T10:00:00Z'), routing_id: routingId, feature_id: null }, 'd');
    expect(first.deduplicated).toBe(false);
    expect(first.row).toMatchObject({ sha: 'abc1234', routing_id: routingId, source: 'host' });
    const again = await upsertCommit(pool, { app_id: appId, sha: 'abc1234', branch: null, message: 'fix: date picker (amended)', files_changed: ['src/a.css', 'src/b.css'], committed_at: null, routing_id: null, feature_id: null }, 'd');
    expect(again.deduplicated).toBe(true);
    expect(again.row).toMatchObject({ id: first.row.id, branch: 'main', message: 'fix: date picker (amended)', files_changed: ['src/a.css', 'src/b.css'], routing_id: routingId });
    expect(again.row.committed_at?.toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(await listCommitsForRouting(pool, { id: routingId, feature_id: null })).toHaveLength(1);
  });

  it('rejects a commit with no anchor at the database boundary', async () => {
    await expect(upsertCommit(pool, { app_id: appId, sha: 'deadbee', branch: null, message: 'x', files_changed: [], committed_at: null, routing_id: null, feature_id: null }, 'd')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/commits.test.ts`
Expected: FAIL — cannot find module `src/store/commits.js`.

- [ ] **Step 3: Write the store**

Create `src/store/commits.ts`:

```ts
import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { CommitRow } from './rows.js';

export interface NewCommit {
  app_id: string; sha: string; branch: string | null; message: string; files_changed: string[]; committed_at: Date | null;
  routing_id: string | null; feature_id: string | null;
}

// `xmax = 0` is true only for a row created by this statement's INSERT branch; a row taken by the
// DO UPDATE branch carries the updating transaction id, so it tells insert from update in one round trip.
export async function upsertCommit(q: Queryable, c: NewCommit, actor: string): Promise<{ row: CommitRow; deduplicated: boolean }> {
  const r = await q.query<CommitRow & { inserted: boolean }>(
    `INSERT INTO commits (id, app_id, sha, branch, message, files_changed, committed_at, routing_id, feature_id, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'host', $10)
     ON CONFLICT (app_id, sha) DO UPDATE SET
       branch = COALESCE(EXCLUDED.branch, commits.branch),
       message = EXCLUDED.message,
       files_changed = EXCLUDED.files_changed,
       committed_at = COALESCE(EXCLUDED.committed_at, commits.committed_at),
       routing_id = COALESCE(commits.routing_id, EXCLUDED.routing_id),
       feature_id = COALESCE(commits.feature_id, EXCLUDED.feature_id),
       updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [newId('cm'), c.app_id, c.sha.toLowerCase(), c.branch, c.message, c.files_changed, c.committed_at, c.routing_id, c.feature_id, actor],
  );
  const { inserted, ...row } = r.rows[0]!;
  return { row, deduplicated: !inserted };
}

export async function listCommitsForRouting(q: Queryable, event: { id: string; feature_id: string | null }): Promise<CommitRow[]> {
  const r = await q.query<CommitRow>(
    `SELECT * FROM commits WHERE routing_id = $1 OR ($2::text IS NOT NULL AND feature_id = $2)
     ORDER BY committed_at NULLS LAST, created_at`,
    [event.id, event.feature_id],
  );
  return r.rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/commits.test.ts` and `npm run typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/commits.ts test/integration/store/commits.test.ts
git commit -m "feat(store): host-reported commits with sha dedup"
```

---

### Task 4: `route_task` records an event; `start_feature` links one

**Files:**
- Modify: `src/services/routeTask.ts`, `src/assembler/lite.ts`, `src/services/startFeature.ts`, `src/lifecycle/instructions.ts`, `src/mcp/tools/routeTask.ts`, `src/mcp/tools/startFeature.ts`, `test/contract/routeTask.test.ts`, `test/unit/lifecycle/instructions.test.ts`
- Test: `test/integration/services/routingEvents.test.ts`

**Interfaces:**
- Consumes: Task 2's store functions.
- Produces: `RouteTaskInput` gains `actor?`, `external_ref?`, `trigger_ref?`; `RouteTaskResult` gains `routing_id: string`. `buildLitePack` input gains `routingId?: string`. `StartFeatureInput` gains `routing_id?: string | null`; `StartFeatureResult` gains `routing_id: string`. MCP `route_task` and `start_feature` expose the same fields. Phase instructions carry the line `After each commit, call record_commit with feature_id "<id>".` (the tool itself arrives in Task 5; the instruction text is inert until then).

- [ ] **Step 1: Write the failing tests**

Create `test/integration/services/routingEvents.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { createApp } from '../../../src/store/apps.js';
import { routeTask } from '../../../src/services/routeTask.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { getRoutingEvent } from '../../../src/store/routingEvents.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Decision } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const feature: Decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('routing events through the services', () => {
  let deps: ServiceDeps;
  let appId: string;

  beforeEach(async () => {
    const pool = await getTestPool();
    await truncateAll(pool);
    appId = (await seedAll(pool)).appId;
    await createApp(pool, { slug: 'billing', name: 'Billing' }, 'seed');
    deps = { pool, embedder, tokenBudget: 6000 };
  });
  afterAll(closeTestPool);

  it('route_task records one event per identity and returns a stable routing_id without creating features', async () => {
    const a = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, actor: 'd' });
    const b = await routeTask(deps, { task_description: 'rename a  label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, actor: 'd' });
    expect(a.routing_id).toMatch(/^r_/);
    expect(b.routing_id).toBe(a.routing_id);
    const row = await getRoutingEvent(deps.pool, a.routing_id);
    expect(row).toMatchObject({ app_id: appId, intent: 'trivial', framework: 'none', lite: true, route_count: 2, created_by: 'd', feature_id: null });
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
  });

  it('keeps the ticket on the event and tells the lite pack how to report commits', async () => {
    const r = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'yal-7' });
    expect(await getRoutingEvent(deps.pool, r.routing_id)).toMatchObject({ external_ref: 'yal-7', identity_key: 'ticket:YAL-7', created_by: 'host' });
    expect(r.lite_pack?.rendered.trimEnd().endsWith(`When you commit, call record_commit with routing_id "${r.routing_id}".`)).toBe(true);
  });

  it('start_feature links an explicit routing_id and reports it', async () => {
    const routed = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' });
    const started = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: routed.decision, routing_id: routed.routing_id });
    expect(started.routing_id).toBe(routed.routing_id);
    expect(await getRoutingEvent(deps.pool, routed.routing_id)).toMatchObject({ feature_id: started.feature_id, route_count: 1 });
    expect(started.next_instructions).toContain(`record_commit with feature_id "${started.feature_id}"`);
  });

  it('start_feature auto-links by identity when routing_id is omitted, and creates the event when none exists', async () => {
    const routed = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4 }, framework_preference: 'mini', external_ref: 'YAL-3' });
    const linked = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export (edited)', decision: routed.decision, external_ref: 'yal-3' });
    expect(linked.routing_id).toBe(routed.routing_id);
    const fresh = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Never routed', decision: feature });
    expect(await getRoutingEvent(deps.pool, fresh.routing_id)).toMatchObject({ feature_id: fresh.feature_id, route_count: 0, intent: 'feature', framework: 'mini' });
  });

  it('start_feature rejects a routing_id from another app or already linked to a feature', async () => {
    const other = await routeTask(deps, { task_description: 'Billing thing', app: 'billing', workspace: { estimated_files: 2 }, framework_preference: 'mini' });
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: feature, routing_id: other.routing_id }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'routing_id' } });
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: feature, routing_id: 'r_nope' }))
      .rejects.toMatchObject({ code: 'ROUTING_EVENT_NOT_FOUND' });
    const routed = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4 }, framework_preference: 'mini' });
    await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: routed.decision, routing_id: routed.routing_id });
    await expect(startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: routed.decision, routing_id: routed.routing_id }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(1);
  });
});
```

In `test/contract/routeTask.test.ts`, replace the `'routes, returns structuredContent, and writes nothing'` test with:

```ts
  it('routes, returns structuredContent and a stable routing_id, and creates no feature', async () => {
    await withClient('stdio', async (client) => {
      const args = { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' };
      const r = await client.callTool({ name: 'route_task', arguments: args });
      const s = structuredOf<{ decision: { framework: string }; attached_layers: unknown[]; routing_id: string }>(r);
      expect(s.decision.framework).toBe('mini');
      expect(s.attached_layers).toHaveLength(2);
      expect(s.routing_id).toMatch(/^r_/);
      expect(JSON.parse(textOf(r)).decision.framework).toBe('mini');
      const again = structuredOf<{ routing_id: string }>(await client.callTool({ name: 'route_task', arguments: args }));
      expect(again.routing_id).toBe(s.routing_id);
      const pool = await getTestPool();
      expect((await pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
      expect((await pool.query('SELECT count(*)::int AS n FROM routing_events')).rows[0].n).toBe(1);
    });
  });
```

In `test/unit/lifecycle/instructions.test.ts`, add to the first `renderPhaseInstructions` test (`'restates feature id, phase, alias and command'`):

```ts
    expect(text).toContain('After each commit, call record_commit with feature_id "f_1".');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/lifecycle/instructions.test.ts` and `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/routingEvents.test.ts test/contract/routeTask.test.ts`
Expected: FAIL — `routing_id` undefined; lite pack lacks the instruction; `startFeature` ignores `routing_id`; instruction line missing.

- [ ] **Step 3: Implement**

`src/assembler/lite.ts` — add `routingId` to the input and append the instruction after the stop conditions:

```ts
export async function buildLitePack(deps: AssemblerDeps, input: { app: AppRow; taskDescription: string; stack: string[]; routingId?: string }): Promise<LitePack> {
```

and change the `footer` line to:

```ts
  const footer = `\n\n## Stop conditions\n\n${renderStopConditions(app.stop_conditions)}`
    + (input.routingId ? `\n\nWhen you commit, call record_commit with routing_id "${input.routingId}".` : '');
```

`src/services/routeTask.ts` — full new content:

```ts
import { attachedLayers, resolveStack } from '../assembler/layers.js';
import { buildLitePack, type LitePack } from '../assembler/lite.js';
import type { AttachedLayer, Decision, Workspace } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { route } from '../router/router.js';
import { requireApp } from '../store/apps.js';
import { listCurrentFrameworks, trackNames } from '../store/frameworks.js';
import { currentPolicy } from '../store/policies.js';
import { upsertRoutingEvent } from '../store/routingEvents.js';
import type { ServiceDeps } from './deps.js';

export interface RouteTaskInput {
  task_description: string; app: string; workspace: Workspace; framework_preference?: string | null;
  actor?: string | null; external_ref?: string | null; trigger_ref?: string | null;
}
export interface RouteTaskResult {
  decision: Decision; clarifying_questions: string[]; guidance: string | null; lite_pack: LitePack | null; attached_layers: AttachedLayer[]; warnings: string[];
  routing_id: string;
}

export async function routeTask(deps: ServiceDeps, input: RouteTaskInput): Promise<RouteTaskResult> {
  const q = deps.pool;
  const app = await requireApp(q, input.app);
  const policy = await currentPolicy(q, app.id);
  const frameworks = (await listCurrentFrameworks(q)).map((f) => ({ name: f.name, pack_version: f.pack_version, tracks: trackNames(f) }));
  const out = route({
    task_description: input.task_description, workspace: input.workspace, framework_preference: input.framework_preference ?? null,
    policy: policy?.policy ?? null, policy_version: policy?.version ?? null, app: { compliance: app.compliance, default_stack: app.default_stack }, frameworks,
  });
  deps.metrics?.routed(out.decision.rule);
  const event = await upsertRoutingEvent(q, {
    app_id: app.id, external_ref: input.external_ref ?? null, trigger_ref: input.trigger_ref ?? null, task_description: input.task_description,
    decision: out.decision, lite: out.lite, workspace: input.workspace,
  }, input.actor ?? 'host', { countRoute: true });
  const stack = resolveStack(input.workspace.stack, app.default_stack);
  const { layers, warnings: layerWarnings } = await attachedLayers(q, stack);
  const warnings = [...out.warnings, ...layerWarnings];
  let litePack: LitePack | null = null;
  if (out.lite) {
    if (deps.embedder) await assertEmbeddingConfigMatches(q, deps.embedder);
    litePack = await buildLitePack({ q, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, { app, taskDescription: input.task_description, stack, routingId: event.id });
    warnings.push(...litePack.warnings);
    if (litePack.degraded) deps.metrics?.degradedPack();
    if (litePack.over_budget) deps.metrics?.overBudgetPack();
  }
  return { decision: out.decision, clarifying_questions: out.clarifying_questions, guidance: out.guidance, lite_pack: litePack, attached_layers: layers, warnings, routing_id: event.id };
}
```

`src/lifecycle/instructions.ts` — in `renderPhaseInstructions`, add after the `` `Keep the feature id ${feature_id}; every later call needs it.` `` line:

```ts
    `After each commit, call record_commit with feature_id "${feature_id}".`,
```

`src/services/startFeature.ts` — add the imports, the input/result fields, and the resolve/link steps. Imports (add two lines):

```ts
import { findRoutingEventByIdentity, identityKey, linkRoutingEventToFeature, requireRoutingEvent, upsertRoutingEvent } from '../store/routingEvents.js';
import type { RoutingEventRow } from '../store/rows.js';
```

Interfaces:

```ts
export interface StartFeatureInput {
  app: string; actor: string; task_description: string; decision: Decision; workspace?: Workspace | null; feature_slug?: string | null;
  external_ref?: string | null; trigger_ref?: string | null; policy_override_reason?: string | null; routing_id?: string | null;
}
export interface StartFeatureResult { feature_id: string; routing_id: string; context_pack: string; pack_id: string; feature: FeatureState; next_instructions: string; warnings: string[] }
```

Inside the `attempt` transaction, insert this block immediately **before** `const feature = await createFeature(tx, {`:

```ts
    let routingEvent: RoutingEventRow;
    if (input.routing_id) {
      routingEvent = await requireRoutingEvent(tx, input.routing_id);
      if (routingEvent.app_id !== app.id) throw new DomainError('VALIDATION_ERROR', `routing event ${routingEvent.id} belongs to another app`, { field: 'routing_id' });
    } else {
      const key = identityKey(input.external_ref ?? null, input.task_description);
      routingEvent = (await findRoutingEventByIdentity(tx, app.id, key)) ?? await upsertRoutingEvent(tx, {
        app_id: app.id, external_ref: input.external_ref ?? null, trigger_ref: input.trigger_ref ?? null, task_description: input.task_description,
        decision, lite: false, workspace: input.workspace ?? null,
      }, input.actor, { countRoute: false });
    }
    if (routingEvent.feature_id) throw new DomainError('VALIDATION_ERROR', `routing event ${routingEvent.id} already belongs to feature ${routingEvent.feature_id}`, { field: 'routing_id' });
```

Immediately **after** the `createFeature(...)` call (before `assembleContextPack`):

```ts
    await linkRoutingEventToFeature(tx, routingEvent.id, feature.id);
```

And in the returned object add `routing_id: routingEvent.id` right after `feature_id: feature.id`.

`src/mcp/tools/routeTask.ts` — description, input and output:

Replace the description array's second line with:

```ts
      'Use it first for any new piece of work, and again with better facts when it returns clarifying_questions. It records one routing event per unit of work (deduplicated by external_ref or by task text) and returns its routing_id; it never touches repositories or lifecycle state.',
```

Add to `inputSchema` after `framework_preference`:

```ts
      actor: ActorSchema.optional(),
      external_ref: z.string().min(1).optional().describe('Ticket id (Linear, Jira); becomes the dedup identity for this work'),
      trigger_ref: z.string().min(1).optional().describe('What caused the work: incident id, CVE, alert'),
```

(import `ActorSchema` from `'../schemas.js'` alongside the existing imports.) Add to `outputSchema`: `routing_id: z.string(),`. In the handler pass through `actor: args.actor ?? null, external_ref: args.external_ref ?? null, trigger_ref: args.trigger_ref ?? null` to `routeTask`, and add `routing_id: r.routing_id` to `structured` and to the JSON in `text` (the object passed to `JSON.stringify` when there is no lite pack or guidance).

`src/mcp/tools/startFeature.ts` — add `routing_id: z.string().min(1).optional().describe('The routing_id returned by route_task; when omitted the event is found by external_ref or task text, or created')` to `inputSchema`, `routing_id: z.string()` to `outputSchema`, and `routing_id: args.routing_id ?? null` to the `startFeature` call. Update the description's third line to `'Returns feature_id (keep it), routing_id, context_pack (also in the text block), pack_id, feature state and next_instructions.'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/lifecycle/instructions.test.ts` and `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services test/contract/routeTask.test.ts test/contract/lifecycle.test.ts` and `npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assembler/lite.ts src/services/routeTask.ts src/services/startFeature.ts src/lifecycle/instructions.ts src/mcp/tools/routeTask.ts src/mcp/tools/startFeature.ts test/integration/services/routingEvents.test.ts test/contract/routeTask.test.ts test/unit/lifecycle/instructions.test.ts
git commit -m "feat(routing): route_task records a routing event; start_feature links every feature to one"
```

---

### Task 5: `record_commit` service and tool

**Files:**
- Create: `src/services/recordCommit.ts`, `src/mcp/tools/recordCommit.ts`
- Modify: `src/mcp/server.ts`, `test/integration/services/routingEvents.test.ts`, `test/contract/routeTask.test.ts`, `test/contract/http.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `recordCommit(deps, input: RecordCommitInput): Promise<RecordCommitResult>` with `RecordCommitInput = { app; actor; sha; message; branch?; files_changed?; committed_at?: string | null; routing_id?; feature_id?; external_ref? }` and `RecordCommitResult = { commit_id; routing_id: string | null; feature_id: string | null; deduplicated: boolean }`; MCP tool `record_commit`.

- [ ] **Step 1: Write the failing tests**

Append to `test/integration/services/routingEvents.test.ts` (inside the describe), and add `import { recordCommit } from '../../../src/services/recordCommit.js';` at the top. New tests:

```ts
  it('record_commit anchors by routing_id, feature_id or external_ref, dedups by sha, and lower-cases the sha', async () => {
    const routed = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'YAL-5' });
    const byRouting = await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'ABC1234', message: 'fix: label', files_changed: ['src/a.tsx'], routing_id: routed.routing_id });
    expect(byRouting).toMatchObject({ routing_id: routed.routing_id, feature_id: null, deduplicated: false });
    expect(byRouting.commit_id).toMatch(/^cm_/);
    const byTicket = await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'fix: label (amend)', external_ref: 'yal-5' });
    expect(byTicket).toMatchObject({ commit_id: byRouting.commit_id, deduplicated: true });
    expect((await deps.pool.query('SELECT sha FROM commits')).rows).toEqual([{ sha: 'abc1234' }]);

    const fresh = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision: feature });
    const byFeature = await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'feed123', message: 'feat: csv', feature_id: fresh.feature_id });
    expect(byFeature).toMatchObject({ feature_id: fresh.feature_id, routing_id: fresh.routing_id, deduplicated: false });
  });

  it('record_commit rejects missing, ambiguous, unknown and cross-app anchors', async () => {
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', routing_id: 'r_a', feature_id: 'f_b' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', external_ref: 'YAL-404' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('call route_task first') });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', routing_id: 'r_nope' })).rejects.toMatchObject({ code: 'ROUTING_EVENT_NOT_FOUND' });
    const other = await routeTask(deps, { task_description: 'Billing thing', app: 'billing', workspace: { intent: 'trivial', estimated_files: 1 } });
    await expect(recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x', routing_id: other.routing_id })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM commits')).rows[0].n).toBe(0);
  });
```

In `test/contract/routeTask.test.ts`: the tool list test becomes nine tools —

```ts
  it('lists exactly the nine tools with output schemas', async () => {
    await withClient('stdio', async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['advance_phase', 'get_context', 'get_feature_status', 'list_features', 'propose_memory', 'record_commit', 'route_task', 'search_memory', 'start_feature']);
```

(the rest of that test unchanged) — and add a new test:

```ts
  it('record_commit links a host-reported commit to routed work over stdio', async () => {
    await withClient('stdio', async (client) => {
      const routed = structuredOf<{ routing_id: string }>(await client.callTool({ name: 'route_task', arguments: { task_description: 'Rename', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'YAL-8' } }));
      const r = await client.callTool({ name: 'record_commit', arguments: { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'fix: rename', files_changed: ['src/a.tsx'], external_ref: 'yal-8' } });
      expect(structuredOf<{ routing_id: string; deduplicated: boolean }>(r)).toMatchObject({ routing_id: routed.routing_id, deduplicated: false });
      expect(errorOf(await client.callTool({ name: 'record_commit', arguments: { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'x' } })).code).toBe('VALIDATION_ERROR');
    });
  });
```

In `test/contract/http.test.ts`, change `expect((await client.listTools()).tools).toHaveLength(8);` to `toHaveLength(9)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/routingEvents.test.ts test/contract/routeTask.test.ts test/contract/http.test.ts`
Expected: FAIL — module `recordCommit.js` missing; tool list has 8.

- [ ] **Step 3: Implement**

Create `src/services/recordCommit.ts`:

```ts
import { DomainError } from '../errors.js';
import { requireApp } from '../store/apps.js';
import { upsertCommit } from '../store/commits.js';
import { requireFeature } from '../store/features.js';
import { findRoutingEventByFeature, findRoutingEventByIdentity, identityKey, requireRoutingEvent } from '../store/routingEvents.js';
import type { ServiceDeps } from './deps.js';

export interface RecordCommitInput {
  app: string; actor: string; sha: string; message: string; branch?: string | null; files_changed?: string[] | null; committed_at?: string | null;
  routing_id?: string | null; feature_id?: string | null; external_ref?: string | null;
}
export interface RecordCommitResult { commit_id: string; routing_id: string | null; feature_id: string | null; deduplicated: boolean }

export async function recordCommit(deps: ServiceDeps, input: RecordCommitInput): Promise<RecordCommitResult> {
  const q = deps.pool;
  const app = await requireApp(q, input.app);
  const anchors = [input.routing_id, input.feature_id, input.external_ref].filter((a) => a != null && a !== '').length;
  if (anchors !== 1) {
    throw new DomainError('VALIDATION_ERROR', 'record_commit needs exactly one of routing_id, feature_id or external_ref', { field: 'routing_id' });
  }
  let routingId: string | null = null;
  let featureId: string | null = null;
  if (input.feature_id) {
    const feature = await requireFeature(q, input.feature_id);
    if (feature.app_id !== app.id) throw new DomainError('VALIDATION_ERROR', `feature ${feature.id} belongs to another app`, { field: 'feature_id' });
    featureId = feature.id;
    routingId = (await findRoutingEventByFeature(q, feature.id))?.id ?? null;
  } else if (input.routing_id) {
    const event = await requireRoutingEvent(q, input.routing_id);
    if (event.app_id !== app.id) throw new DomainError('VALIDATION_ERROR', `routing event ${event.id} belongs to another app`, { field: 'routing_id' });
    routingId = event.id;
    featureId = event.feature_id;
  } else {
    const event = await findRoutingEventByIdentity(q, app.id, identityKey(input.external_ref, ''));
    if (!event) {
      throw new DomainError('VALIDATION_ERROR', `no routing event for ${input.external_ref} in ${app.slug}; call route_task first or pass routing_id`, { field: 'external_ref' });
    }
    routingId = event.id;
    featureId = event.feature_id;
  }
  const { row, deduplicated } = await upsertCommit(q, {
    app_id: app.id, sha: input.sha, branch: input.branch ?? null, message: input.message, files_changed: input.files_changed ?? [],
    committed_at: input.committed_at ? new Date(input.committed_at) : null, routing_id: routingId, feature_id: featureId,
  }, input.actor);
  return { commit_id: row.id, routing_id: row.routing_id, feature_id: row.feature_id, deduplicated };
}
```

Create `src/mcp/tools/recordCommit.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { recordCommit } from '../../services/recordCommit.js';
import { guarded } from '../encode.js';
import { ActorSchema } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerRecordCommit(server: McpServer, deps: McpDeps): void {
  server.registerTool('record_commit', {
    title: 'Link a commit to routed work or a feature',
    description: [
      'Records a commit the host made and anchors it to the work it belongs to: pass exactly one of routing_id (from route_task), feature_id (from start_feature) or external_ref (a ticket already routed).',
      'Call it after every commit for trivial work and for features alike. Idempotent per (app, sha): reporting the same commit again refreshes message and files and keeps existing links.',
      'The server never reads git; it stores what you report. Returns commit_id, the resolved routing_id and feature_id, and deduplicated.',
      'Example: record_commit({"app":"checkout","actor":"daniel","sha":"a1b2c3d","message":"fix: date range validation","files_changed":["src/dates.ts"],"routing_id":"r_01j9..."})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1).describe('App slug registered with sdd-admin'),
      actor: ActorSchema,
      sha: z.string().regex(/^[0-9a-fA-F]{7,64}$/, 'sha must be 7-64 hex characters'),
      message: z.string().min(1).max(10_000),
      branch: z.string().min(1).optional(),
      files_changed: z.array(z.string().min(1).max(512)).max(500).optional(),
      committed_at: z.string().datetime({ offset: true }).optional().describe('Author date, ISO 8601'),
      routing_id: z.string().min(1).optional(),
      feature_id: z.string().min(1).optional(),
      external_ref: z.string().min(1).optional().describe('Ticket id already passed to route_task'),
    },
    outputSchema: {
      commit_id: z.string(), routing_id: z.string().nullable(), feature_id: z.string().nullable(), deduplicated: z.boolean(),
    },
  }, async (args) => guarded(deps.logger, 'record_commit', async () => {
    const r = await recordCommit(deps, {
      app: args.app, actor: args.actor, sha: args.sha, message: args.message, branch: args.branch ?? null, files_changed: args.files_changed ?? null,
      committed_at: args.committed_at ?? null, routing_id: args.routing_id ?? null, feature_id: args.feature_id ?? null, external_ref: args.external_ref ?? null,
    });
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
```

`src/mcp/server.ts` — import `registerRecordCommit` from `'./tools/recordCommit.js'` and add it to `registrars` right after `registerStartFeature`.

- [ ] **Step 4: Run tests to verify they pass**

Run the Step 2 command plus `npm run typecheck`, then the full backend suite: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recordCommit.ts src/mcp/tools/recordCommit.ts src/mcp/server.ts test/integration/services/routingEvents.test.ts test/contract/routeTask.test.ts test/contract/http.test.ts
git commit -m "feat(mcp): record_commit tool anchors host-reported commits to routings and features"
```

---

### Task 6: Admin API for routing events

**Files:**
- Modify: `src/web/adminRoutes.ts`
- Test: `test/contract/adminRoutes.test.ts`

**Interfaces:**
- Consumes: `listRoutingEvents`, `routingSummary`, `requireRoutingEvent` (Task 2), `listCommitsForRouting` (Task 3).
- Produces: `GET /admin/api/routing?app=&from=&to=&limit=` → `{ events: RoutingEventListRow[], summary: { intent, count }[] }`; `GET /admin/api/routing/:id` → `{ event, commits }`; `ROUTING_EVENT_NOT_FOUND` → 404.

- [ ] **Step 1: Write the failing test**

Append to `test/contract/adminRoutes.test.ts` (inside the describe; add `import { routeTask } from '../../src/services/routeTask.js';` and `import { recordCommit } from '../../src/services/recordCommit.js';` at the top):

```ts
  it('lists routed work with app/date filters, summarises by intent, and serves one event with its commits', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const headers = { Authorization: authHeader('s3cret') };
    const trivial = await routeTask(deps, { task_description: 'Fix the date picker', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 }, external_ref: 'YAL-1' });
    await recordCommit(deps, { app: 'checkout', actor: 'd', sha: 'abc1234', message: 'fix: date picker', files_changed: ['src/dates.ts'], routing_id: trivial.routing_id });
    const started = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision });

    const all = (await (await fetch(`${listening.origin}/admin/api/routing`, { headers })).json()) as any;
    expect(all.events.map((e: { id: string }) => e.id).sort()).toEqual([trivial.routing_id, started.routing_id].sort());
    const t = all.events.find((e: { id: string }) => e.id === trivial.routing_id);
    expect(t).toMatchObject({ app_slug: 'checkout', intent: 'trivial', lite: true, external_ref: 'YAL-1', commit_count: 1, feature_id: null });
    const f = all.events.find((e: { id: string }) => e.id === started.routing_id);
    expect(f).toMatchObject({ feature_id: started.feature_id, feature_status: 'active', feature_phase: 'specify', commit_count: 0 });
    expect(all.summary).toEqual(expect.arrayContaining([{ intent: 'trivial', count: 1 }, { intent: 'feature', count: 1 }]));

    const scoped = (await (await fetch(`${listening.origin}/admin/api/routing?app=checkout&from=2000-01-01&to=2099-12-31`, { headers })).json()) as any;
    expect(scoped.events).toHaveLength(2);
    const none = (await (await fetch(`${listening.origin}/admin/api/routing?from=2099-01-01`, { headers })).json()) as any;
    expect(none.events).toEqual([]);
    expect(none.summary).toEqual([]);

    const detail = (await (await fetch(`${listening.origin}/admin/api/routing/${trivial.routing_id}`, { headers })).json()) as any;
    expect(detail.event.id).toBe(trivial.routing_id);
    expect(detail.commits).toEqual([expect.objectContaining({ sha: 'abc1234', files_changed: ['src/dates.ts'] })]);

    expect((await fetch(`${listening.origin}/admin/api/routing/r_nope`, { headers })).status).toBe(404);
    expect((await fetch(`${listening.origin}/admin/api/routing?app=nope`, { headers })).status).toBe(404);
  });

  it('rejects an inverted or malformed date range with 400', async () => {
    const app = createHttpApp(deps, { ...baseConfig, adminToken: 's3cret' });
    const listening = await listen(app);
    server = listening.server;
    const headers = { Authorization: authHeader('s3cret') };
    const inverted = await fetch(`${listening.origin}/admin/api/routing?from=2026-02-02&to=2026-01-01`, { headers });
    expect(inverted.status).toBe(400);
    expect(((await inverted.json()) as any).error).toContain('from must be on or before to');
    expect((await fetch(`${listening.origin}/admin/api/routing?from=yesterday`, { headers })).status).toBe(400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/adminRoutes.test.ts`
Expected: FAIL — `/admin/api/routing` returns 404 (no route).

- [ ] **Step 3: Implement**

In `src/web/adminRoutes.ts`:

Add imports:

```ts
import { listCommitsForRouting } from '../store/commits.js';
import { listRoutingEvents, requireRoutingEvent, routingSummary } from '../store/routingEvents.js';
```

Add the query schema next to `ProposalsQuery`:

```ts
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const RoutingQuery = z.object({
  app: z.string().optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to', path: ['from'] });

function dayRange(from: string | undefined, to: string | undefined): { from: Date | null; to: Date | null } {
  return { from: from ? new Date(`${from}T00:00:00.000Z`) : null, to: to ? new Date(`${to}T23:59:59.999Z`) : null };
}
```

In `handle()`, widen the 404 branch:

```ts
        if (isDomainError(e) && (e.code === 'APP_NOT_FOUND' || e.code === 'FEATURE_NOT_FOUND' || e.code === 'ROUTING_EVENT_NOT_FOUND')) {
```

Add the two routes before `router.use(express.static(adminUiDist));`:

```ts
  router.get('/api/routing', handle(async (req, res) => {
    const { app, from, to, limit } = RoutingQuery.parse(req.query);
    const appId = await resolveAppId(deps, app);
    const range = dayRange(from, to);
    const [events, summary] = await Promise.all([
      listRoutingEvents(deps.pool, { appId, ...range, limit }),
      routingSummary(deps.pool, { appId, ...range }),
    ]);
    res.json({ events, summary });
  }));

  router.get('/api/routing/:id', handle(async (req, res) => {
    const event = await requireRoutingEvent(deps.pool, req.params.id as string);
    const commits = await listCommitsForRouting(deps.pool, event);
    res.json({ event, commits });
  }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/adminRoutes.test.ts` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/adminRoutes.ts test/contract/adminRoutes.test.ts
git commit -m "feat(admin): routing events API with app and date-range filters"
```

---

### Task 7: Work view — filters, summary tiles, table

**Files:**
- Modify: `admin-ui/src/types.ts`, `admin-ui/src/api.ts`, `admin-ui/src/App.tsx`, `admin-ui/src/styles.css`
- Create: `admin-ui/src/views/badge.ts`, `admin-ui/src/views/Work.tsx`, `admin-ui/src/views/Work.test.tsx`

**Interfaces:**
- Produces: types `RoutingEvent`, `RoutingSummary`, `Commit`; `getRouting(params)`, `getRoutingDetail(id)` in `api.ts`; `typeBadge(e: RoutingEvent): string` in `views/badge.ts`; `Work` component wired into a new `work` tab. Row click sets `selectedId` and renders a placeholder `Routing detail coming soon.` that Task 8 replaces with `RoutingDetail`.

- [ ] **Step 1: Write the failing test**

Create `admin-ui/src/views/Work.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Work } from './Work';

const event = {
  id: 'r_1', app_id: 'a_1', app_slug: 'checkout', external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix the date picker', intent: 'trivial', framework: 'none',
  lite: true, route_count: 2, first_routed_at: '2026-09-18T10:00:00.000Z', last_routed_at: '2026-09-18T12:00:00.000Z', feature_id: null, feature_slug: null,
  feature_status: null, feature_phase: null, commit_count: 1, decision: { track: null, rule: '4-trivial', reasons: ['host set intent trivial'] }, workspace: null,
};
const featureEvent = { ...event, id: 'r_2', external_ref: null, task_description: 'Add CSV export', intent: 'feature', framework: 'mini', lite: false, feature_id: 'f_1', feature_slug: 'add-csv-export', feature_status: 'active', feature_phase: 'specify', commit_count: 0 };
const unstarted = { ...event, id: 'r_3', external_ref: null, task_description: 'Plan the reports page', intent: 'feature', framework: 'mini', lite: false, commit_count: 0 };

function stubFetch(calls: string[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    calls.push(url);
    if (url === '/admin/api/apps') return Promise.resolve({ ok: true, json: () => Promise.resolve({ apps: [{ id: 'a_1', slug: 'checkout', name: 'Checkout', features: [] }] }) });
    if (url.startsWith('/admin/api/routing')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [event, featureEvent, unstarted], summary: [{ intent: 'trivial', count: 1 }, { intent: 'feature', count: 2 }] }) });
    throw new Error(`unexpected fetch: ${url}`);
  }));
}

describe('Work', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders summary tiles and routed work with type badges', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    expect(await screen.findByText('Fix the date picker')).toBeInTheDocument();
    expect(screen.getByText('YAL-1')).toBeInTheDocument();
    expect(screen.getByText('lite')).toBeInTheDocument();
    // 'feature' appears both as the summary tile label and as the linked feature's badge.
    expect(screen.getAllByText('feature')).toHaveLength(2);
    expect(screen.getByText('feature · not started')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(calls).toContain('/admin/api/routing');
  });

  it('applies app and date filters as query params and blocks an inverted range', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    await screen.findByText('Fix the date picker');
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'checkout' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls).toContain('/admin/api/routing?app=checkout&from=2026-09-01&to=2026-09-30'));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText('From must be on or before To.')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/admin/api/apps') return Promise.resolve({ ok: true, json: () => Promise.resolve({ apps: [] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [], summary: [] }) });
    }));
    render(<Work />);
    expect(await screen.findByText('No routed work in this range.')).toBeInTheDocument();
  });

  it('opens the detail placeholder on row click', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    fireEvent.click(await screen.findByText('Add CSV export'));
    expect(await screen.findByText('Routing detail coming soon.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix admin-ui test`
Expected: FAIL — cannot find module `./Work`.

- [ ] **Step 3: Implement**

Append to `admin-ui/src/types.ts`:

```ts
export interface RoutingEvent {
  id: string;
  app_id: string;
  app_slug: string;
  external_ref: string | null;
  trigger_ref: string | null;
  task_description: string;
  intent: string;
  framework: string;
  lite: boolean;
  route_count: number;
  first_routed_at: string;
  last_routed_at: string;
  feature_id: string | null;
  feature_slug: string | null;
  feature_status: string | null;
  feature_phase: string | null;
  commit_count: number;
  decision: { track: string | null; rule: string; reasons: string[] };
  workspace: { paths_touched?: string[] | null } | null;
}

export interface RoutingSummary { intent: string; count: number }

export interface Commit {
  id: string;
  sha: string;
  branch: string | null;
  message: string;
  files_changed: string[];
  committed_at: string | null;
  created_at: string;
}
```

Append to `admin-ui/src/api.ts` (and extend the type import line with `Commit, RoutingEvent, RoutingSummary`):

```ts
export interface RoutingParams { app?: string; from?: string; to?: string }

export function getRouting(params: RoutingParams = {}): Promise<{ events: RoutingEvent[]; summary: RoutingSummary[] }> {
  const qs = new URLSearchParams();
  if (params.app) qs.set('app', params.app);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const s = qs.toString();
  return get<{ events: RoutingEvent[]; summary: RoutingSummary[] }>(`/admin/api/routing${s ? `?${s}` : ''}`);
}

export function getRoutingDetail(id: string): Promise<{ event: RoutingEvent; commits: Commit[] }> {
  return get<{ event: RoutingEvent; commits: Commit[] }>(`/admin/api/routing/${encodeURIComponent(id)}`);
}
```

Append to `admin-ui/src/styles.css`:

```css
.filters { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 1rem; }
.filter { display: flex; flex-direction: column; font-size: 0.85rem; gap: 0.2rem; }
.badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 4px; background: #e5e7eb; font-size: 0.85em; white-space: nowrap; }
.row-link { cursor: pointer; }
.row-link:hover { background: #f3f4f6; }
```

Create `admin-ui/src/views/badge.ts`:

```ts
import type { RoutingEvent } from '../types';

export function typeBadge(e: RoutingEvent): string {
  if (e.feature_id) return 'feature';
  if (e.lite) return 'lite';
  if (e.intent === 'feature' || e.intent === 'product') return `${e.intent} · not started`;
  return e.intent;
}
```

Create `admin-ui/src/views/Work.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getApps, getRouting, type RoutingParams } from '../api';
import type { AppSummary, RoutingEvent, RoutingSummary } from '../types';
import { typeBadge } from './badge';

export function Work() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [draft, setDraft] = useState<RoutingParams>({});
  const [applied, setApplied] = useState<RoutingParams>({});
  const [events, setEvents] = useState<RoutingEvent[] | null>(null);
  const [summary, setSummary] = useState<RoutingSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getApps().then((r) => setApps(r.apps)).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setEvents(null);
    getRouting(applied).then((r) => { setEvents(r.events); setSummary(r.summary); }).catch((e: Error) => setError(e.message));
  }, [applied]);

  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);

  if (error) return <p className="error">Could not load routed work: {error}</p>;

  if (selectedId) {
    return (
      <section>
        <button className="link" onClick={() => setSelectedId(null)}>&larr; Back</button>
        <p>Routing detail coming soon.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Work</h2>
      <div className="filters">
        <div className="filter">
          <label htmlFor="work-app">App</label>
          <select id="work-app" value={draft.app ?? ''} onChange={(ev) => setDraft({ ...draft, app: ev.target.value || undefined })}>
            <option value="">All apps</option>
            {apps.map((a) => <option key={a.id} value={a.slug}>{a.slug}</option>)}
          </select>
        </div>
        <div className="filter">
          <label htmlFor="work-from">From</label>
          <input id="work-from" type="date" value={draft.from ?? ''} onChange={(ev) => setDraft({ ...draft, from: ev.target.value || undefined })} />
        </div>
        <div className="filter">
          <label htmlFor="work-to">To</label>
          <input id="work-to" type="date" value={draft.to ?? ''} onChange={(ev) => setDraft({ ...draft, to: ev.target.value || undefined })} />
        </div>
        <button onClick={() => setApplied(draft)} disabled={invalidRange}>Apply</button>
        {invalidRange && <span className="error">From must be on or before To.</span>}
      </div>
      {!events ? (
        <p>Loading…</p>
      ) : events.length === 0 ? (
        <p>No routed work in this range.</p>
      ) : (
        <>
          <div className="tiles">
            {summary.map((s) => (
              <div className="tile" key={s.intent}>
                <span className="tile-value">{s.count}</span>
                <span className="tile-label">{s.intent}</span>
              </div>
            ))}
          </div>
          <table>
            <thead>
              <tr><th>Last routed</th><th>App</th><th>Type</th><th>Ticket</th><th>Task</th><th>Framework</th><th>Feature</th><th>Commits</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="row-link" onClick={() => setSelectedId(e.id)}>
                  <td>{e.last_routed_at.slice(0, 10)}</td>
                  <td>{e.app_slug}</td>
                  <td><span className="badge">{typeBadge(e)}</span></td>
                  <td>{e.external_ref ?? '—'}</td>
                  <td>{e.task_description.length > 80 ? `${e.task_description.slice(0, 80)}…` : e.task_description}</td>
                  <td>{e.framework === 'none' ? '—' : `${e.framework}${e.decision.track ? `:${e.decision.track}` : ''}`}</td>
                  <td>{e.feature_id ? `${e.feature_status} · ${e.feature_phase}` : '—'}</td>
                  <td>{e.commit_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
```

`admin-ui/src/App.tsx` — add `import { Work } from './views/Work';`, extend `type Tab` with `| 'work'`, add `{ id: 'work', label: 'Work' }` to `TABS` after `proposals`, and add `{tab === 'work' && <Work />}` after the proposals line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix admin-ui test && npm --prefix admin-ui run typecheck`
Expected: PASS, no warnings.

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/types.ts admin-ui/src/api.ts admin-ui/src/styles.css admin-ui/src/views/badge.ts admin-ui/src/views/Work.tsx admin-ui/src/views/Work.test.tsx admin-ui/src/App.tsx
git commit -m "feat(admin-ui): Work tab listing routed work with app and date filters"
```

---

### Task 8: Routing detail with commits

**Files:**
- Create: `admin-ui/src/views/RoutingDetail.tsx`, `admin-ui/src/views/RoutingDetail.test.tsx`
- Modify: `admin-ui/src/views/Work.tsx`, `admin-ui/src/views/Work.test.tsx`

**Interfaces:**
- Consumes: `getRoutingDetail` (Task 7), `FeatureDetail` (existing).
- Produces: `RoutingDetail({ routingId, onBack })`, replacing the placeholder in `Work.tsx`.

- [ ] **Step 1: Write the failing test**

Create `admin-ui/src/views/RoutingDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoutingDetail } from './RoutingDetail';

const payload = {
  event: {
    id: 'r_1', app_id: 'a_1', app_slug: 'checkout', external_ref: 'YAL-1', trigger_ref: null, task_description: 'Fix the date picker', intent: 'trivial', framework: 'none',
    lite: true, route_count: 2, first_routed_at: '2026-09-18T10:00:00.000Z', last_routed_at: '2026-09-18T12:00:00.000Z', feature_id: null, feature_slug: null,
    feature_status: null, feature_phase: null, commit_count: 1, decision: { track: null, rule: '4-trivial', reasons: ['host set intent trivial'] }, workspace: { paths_touched: ['src/dates.ts'] },
  },
  commits: [{ id: 'cm_1', sha: 'abc1234def', branch: 'main', message: 'fix: date picker\n\nDetails', files_changed: ['src/dates.ts', 'src/dates.test.ts'], committed_at: '2026-09-18T11:00:00.000Z', created_at: '2026-09-18T11:01:00.000Z' }],
};

describe('RoutingDetail', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the decision, workspace paths, and commits with expandable files, and calls onBack', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const onBack = vi.fn();
    render(<RoutingDetail routingId="r_1" onBack={onBack} />);
    expect(await screen.findByText('Fix the date picker')).toBeInTheDocument();
    expect(screen.getByText('host set intent trivial')).toBeInTheDocument();
    expect(screen.getByText('src/dates.ts')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('fix: date picker')).toBeInTheDocument();
    fireEvent.click(screen.getByText('2 file(s)'));
    expect(screen.getByText('src/dates.test.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('← Back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows an empty commits state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...payload, commits: [] }) }));
    render(<RoutingDetail routingId="r_1" onBack={() => undefined} />);
    expect(await screen.findByText('No commits reported yet.')).toBeInTheDocument();
  });
});
```

In `admin-ui/src/views/Work.test.tsx`, add this branch to `stubFetch` **before** the `url.startsWith('/admin/api/routing')` line:

```tsx
    if (url === '/admin/api/routing/r_2') return Promise.resolve({ ok: true, json: () => Promise.resolve({ event: featureEvent, commits: [] }) });
```

and rename/rewrite the last test:

```tsx
  it('opens the routing detail on row click', async () => {
    const calls: string[] = [];
    stubFetch(calls);
    render(<Work />);
    fireEvent.click(await screen.findByText('Add CSV export'));
    expect(await screen.findByText('No commits reported yet.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix admin-ui test`
Expected: FAIL — cannot find module `./RoutingDetail`; Work test expects the real detail.

- [ ] **Step 3: Implement**

Create `admin-ui/src/views/RoutingDetail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getRoutingDetail } from '../api';
import type { Commit, RoutingEvent } from '../types';
import { typeBadge } from './badge';
import { FeatureDetail } from './FeatureDetail';

function CommitRow({ c }: { c: Commit }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td><code>{c.sha.slice(0, 7)}</code></td>
        <td>{c.branch ?? '—'}</td>
        <td>{c.message.split('\n')[0]}</td>
        <td>{c.committed_at ? c.committed_at.slice(0, 10) : '—'}</td>
        <td><button className="link" onClick={() => setOpen(!open)}>{c.files_changed.length} file(s)</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <ul>{c.files_changed.map((f) => <li key={f}>{f}</li>)}</ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function RoutingDetail({ routingId, onBack }: { routingId: string; onBack: () => void }) {
  const [data, setData] = useState<{ event: RoutingEvent; commits: Commit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFeature, setShowFeature] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    getRoutingDetail(routingId).then(setData).catch((e: Error) => setError(e.message));
  }, [routingId]);

  if (showFeature && data?.event.feature_id) {
    return <FeatureDetail featureId={data.event.feature_id} onBack={() => setShowFeature(false)} />;
  }

  return (
    <section>
      <button className="link" onClick={onBack}>&larr; Back</button>
      {error && <p className="error">Could not load routing {routingId}: {error}</p>}
      {!error && !data && <p>Loading…</p>}
      {data && (
        <>
          <h3>{data.event.task_description}</h3>
          <p>
            <span className="badge">{typeBadge(data.event)}</span>{' '}
            {data.event.app_slug} · {data.event.external_ref ?? 'no ticket'} · routed {data.event.route_count} time(s), first {data.event.first_routed_at.slice(0, 10)}, last {data.event.last_routed_at.slice(0, 10)}
          </p>
          {data.event.feature_id && (
            <p>
              Feature: <button className="link" onClick={() => setShowFeature(true)}>{data.event.feature_slug}</button> — {data.event.feature_status} · {data.event.feature_phase}
            </p>
          )}
          <h4>Decision</h4>
          <p>{data.event.framework === 'none' ? 'no framework' : `${data.event.framework}${data.event.decision.track ? `:${data.event.decision.track}` : ''}`} · rule {data.event.decision.rule}</p>
          <ul>{data.event.decision.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {data.event.workspace?.paths_touched && data.event.workspace.paths_touched.length > 0 && (
            <>
              <h4>Paths touched</h4>
              <ul>{data.event.workspace.paths_touched.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
          <h4>Commits</h4>
          {data.commits.length === 0 ? (
            <p>No commits reported yet.</p>
          ) : (
            <table>
              <thead><tr><th>Sha</th><th>Branch</th><th>Message</th><th>Date</th><th>Files</th></tr></thead>
              <tbody>{data.commits.map((c) => <CommitRow key={c.id} c={c} />)}</tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
```

In `admin-ui/src/views/Work.tsx`, add `import { RoutingDetail } from './RoutingDetail';` and replace the placeholder block:

```tsx
  if (selectedId) {
    return (
      <section>
        <button className="link" onClick={() => setSelectedId(null)}>&larr; Back</button>
        <p>Routing detail coming soon.</p>
      </section>
    );
  }
```

with:

```tsx
  if (selectedId) return <RoutingDetail routingId={selectedId} onBack={() => setSelectedId(null)} />;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix admin-ui test && npm --prefix admin-ui run typecheck && npm --prefix admin-ui run build`
Expected: PASS, no warnings; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/views/RoutingDetail.tsx admin-ui/src/views/RoutingDetail.test.tsx admin-ui/src/views/Work.tsx admin-ui/src/views/Work.test.tsx
git commit -m "feat(admin-ui): routing detail with decision, paths and linked commits"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/verification/host-integration.md`, `README.md`, `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`

**Interfaces:** none — documentation only. No automated test; verified by reading the rendered Markdown and by the full suites still passing (Step 3).

- [ ] **Step 1: Update the host integration guide**

In `docs/verification/host-integration.md`, replace steps 2–5 of "Session flow" with:

```markdown
2. Otherwise call `route_task` with the ticket as `external_ref` and your
   name as `actor`. It returns a `routing_id`; the same task routed again
   returns the same id. Show the decision. If there are clarifying
   questions, answer them and call `route_task` again. For trivial work the
   lite pack is the whole context: do the change, then go to step 6.
   For everything else call `start_feature` with the accepted decision and
   the `routing_id`, and write the returned feature id to `.sdd/feature.json`.
3. Work from the context pack. Before `advance_phase`, read `current_phase`
   from `.sdd/feature.json` and pass it as `expected_phase`. On `STALE_STATE`,
   call `get_feature_status`, update the cache, and retry once.
4. After every successful `advance_phase`, update `.sdd/feature.json` from the
   returned `feature` state.
5. When the feature is archived, delete `.sdd/feature.json`.
6. After every commit — trivial fix or feature — call `record_commit` with
   the sha, message, `files_changed` (from `git show --name-only`) and the
   `routing_id` or `feature_id`. Add a trailer `SDD-Ref: <that id>` to the
   commit message so the history is self-describing; the server does not
   parse it, but a future forge webhook can.
```

- [ ] **Step 2: Update the README**

In `README.md`, section 4, after the sentence that ends `…and the stop conditions plus the checks the next gate will run.`, add:

```markdown
`route_task` also returns a `routing_id`: the server records one routing
event per unit of work (deduplicated by `external_ref` or by task text), so
trivial fixes that never become features still show up in the admin. Pass
the `routing_id` to `start_feature`, and call `record_commit` after each
commit to link it to the work.
```

In section 8, replace the first paragraph with:

```markdown
Set `SDD_ADMIN_TOKEN` and restart the server to turn on a read-only admin
page at `/admin` — feature counts, gate blocker counts by check, a
phase-to-phase flow heatmap, the memory-proposal queue, and a **Work** tab
listing everything routed (features and trivial fixes alike) with linked
commits, filterable by app and date range. It is absent entirely (a plain
404) when the token is unset.
```

- [ ] **Step 3: Note the revision in the v1 spec**

In `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`, change the line `**`route_task`** (read-only)` to:

```markdown
**`route_task`** (read-only in v1; since `docs/superpowers/specs/2026-09-18-routing-events-and-commits-design.md` it records one routing event per unit of work)
```

Then run the full suites once to confirm nothing regressed:
`npm run typecheck && SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run && npm --prefix admin-ui test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/verification/host-integration.md README.md docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md
git commit -m "docs: routing events, record_commit and the Work tab"
```
