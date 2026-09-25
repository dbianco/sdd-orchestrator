# Trust, Traceability and Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six structural gaps in the 2026-09-25 analysis: CI for this repository, several pinned templates per phase, requirement traceability, token identity, server-side approvals, CI-sourced evidence, a Claude Code enforcement plugin, and measurable verification.

**Architecture:** Three releases, each shippable alone. Release A (tasks 1–10) needs no auth: CI workflow, `templates` lists in phase mappings, and requirement capture and coverage through two new pure gate checks plus a `feature_requirements` table. Release B (tasks 11–24) adds `api_tokens`, an express auth middleware in front of `/mcp` that hands an `AuthContext` into `createMcpServer`, server-side `approval_requests` driven from `advancePhase`, and a `POST /api/ci/evidence` endpoint whose rows are merged into verify evidence. Release C (tasks 25–32) ships the `hosts/claude-code/` plugin (hooks as dependency-free Node scripts), `sdd-admin eval` and a scripted walkthrough.

**Tech Stack:** TypeScript on Node 22 (NodeNext ESM), Express 5, Postgres 16 + pgvector (`pg`, `node-pg-migrate`), zod, MCP TypeScript SDK, commander; React 18 + Vite + Vitest in `admin-ui/`; GitHub Actions; Claude Code plugin format.

**Spec:** `docs/superpowers/specs/2026-09-25-trust-traceability-enforcement-design.md`

**Prerequisite:** PR #4 (`claude/fix-router-and-gate-bugs`) is merged. It changes `packs/*/pack.yaml` (track `intents`, `is_default`) and `src/lifecycle/track.ts`, which tasks 2, 4 and 8 also edit. Rebase this work on `main` after it merges.

## Global Constraints

- The server never reads or writes a repository. CI evidence and commits are reported to it.
- `SDD_AUTH_MODE` is `warn` by default (`enforce`, `warn`, `off`). Server-side approvals are active in `enforce` and `warn`; `off` keeps v1 behaviour exactly, including the host-asserted `human_approved`.
- Tokens: `sdd_` + 32 random bytes base64url; only `sha256(token)` hex is stored; comparisons are by hash lookup, never by string comparison of secrets. Revoked or expired tokens behave exactly like unknown ones.
- Scopes are exactly `host`, `ci`, `approver`, `admin`. `admin` implies `approver`.
- Gate checks stay pure functions of `CheckInput`. Anything from the database (captured requirements) is loaded by the service and passed in.
- A feature pins its framework version; gate changes ship as new pack versions (`1.1.0` in release A), never as edits to an ingested version's gates.
- New domain error codes: `FORBIDDEN` right after `VALIDATION_ERROR`; `APPROVAL_NOT_FOUND` and `APPROVAL_NOT_PENDING` right after `ROUTING_EVENT_NOT_FOUND`. Unauthenticated or invalid-token HTTP requests are 401 responses, never tool results.
- New id prefixes via `newId()`: `tk_` (tokens), `ap_` (approval requests), `ce_` (CI evidence).
- Migrations are one per release step that needs one (the spec's single migration is split so each release ships alone). Timestamps: `1758758400000` (task 5), `1758758460000` (task 11), `1758758520000` (task 16), `1758758580000` (task 21). Each adds its tables to `truncateAll` in `test/helpers/db.ts` and to the table list in `test/integration/db/migrate.test.ts`.
- `src/` uses NodeNext ESM (`.js` on relative imports); `admin-ui/src/` uses Bundler resolution (no extension); plugin hook scripts are plain `.mjs` with no dependencies.
- Test output must be pristine. Integration and contract tests need `npm run db:test:up` and `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test`.
- Commit after each task with a conventional message (`feat(scope): …`, `fix(scope): …`, `docs: …`), ending with the session attribution lines.

---

# Release A: CI, templates, traceability

### Task 1: CI workflow for this repository

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: jobs `check`, `integration`, `admin-ui`, `image`. Jobs `plugin` and `eval` are added by tasks 28 and 30.

- [ ] **Step 1: Write the workflow**

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_USER: sdd, POSTGRES_PASSWORD: sdd, POSTGRES_DB: sdd_test }
        ports: ['55432:5432']
        options: >-
          --health-cmd "pg_isready -U sdd -d sdd_test" --health-interval 2s --health-timeout 5s --health-retries 30
    env:
      SDD_TEST_DATABASE_URL: postgres://sdd:sdd@localhost:55432/sdd_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test:integration
      - run: npm run test:contract
  admin-ui:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: admin-ui/package-lock.json }
      - run: npm --prefix admin-ui ci
      - run: npm run test:admin-ui
      - run: npm run build:admin-ui
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build .
```

The service values match `docker-compose.test.yml` (user `sdd`, password `sdd`, database `sdd_test`). `test/contract/adminRoutes.test.ts` skips its static-file test when `admin-ui/dist` is absent, which is the case in this job; the `admin-ui` job covers the build.

- [ ] **Step 2: Verify locally what can be verified**

Run: `npm run typecheck && npm run test:unit`, then with the test database up, `npm run test:integration && npm run test:contract`, `npm run test:admin-ui && npm run build:admin-ui`, `docker build .`
Expected: all pass. These are the exact commands the jobs run.

- [ ] **Step 3: Push and confirm on GitHub**

Push the branch and confirm all four jobs are green on the pull request. A failing job is fixed in this task, not deferred.

- [ ] **Step 4: Commit**

`ci: typecheck, unit, integration, contract, admin-ui and image jobs`

---

### Task 2: `templates` in phase mappings

**Files:**
- Modify: `src/domain/types.ts` (`PhaseMapping`), `src/lifecycle/track.ts` (`PhaseMappingSchema`, new `phaseTemplates`), `src/ingest/validate.ts`
- Test: `test/unit/lifecycle/track.test.ts`, `test/unit/ingest/validate.test.ts`

**Interfaces:**
- Produces: `PhaseMapping.templates?: string[]`; `phaseTemplates(mapping: PhaseMapping): string[]` returning `templates ?? (template ? [template] : [])`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

In `track.test.ts`:

```ts
describe('phaseTemplates', () => {
  it('returns the templates list, the single template, or nothing', () => {
    expect(phaseTemplates({ templates: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(phaseTemplates({ template: 'a' })).toEqual(['a']);
    expect(phaseTemplates({ alias: 'x' })).toEqual([]);
  });
});
```

In `validate.test.ts`, three cases against a framework pack fixture built in the test:
- a phase with both `template` and `templates` → error `track default: phase specify declares both template and templates`;
- `templates` naming an id not in the pack → error `track default: phase specify names template "missing" which is not in this pack`;
- two templates whose combined body exceeds `TEMPLATE_WARN_TOKENS` → warning `templates for phase specify total <n> tokens, above 3000`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/lifecycle/track.test.ts test/unit/ingest/validate.test.ts`
Expected: FAIL — `phaseTemplates` is not exported; no error for both fields.

- [ ] **Step 3: Implement**

`PhaseMappingSchema` gains `templates: z.array(z.string().min(1)).min(1).optional()`; keep the compile-time equality test in `track.test.ts` passing by adding `templates?: string[]` to `PhaseMapping`. In `validate.ts`, replace the per-phase `entry.template` block with a loop over `phaseTemplates(entry)`, add the both-fields error, and compute the token warning on the sum of the phase's templates (one warning per phase, message as above).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/unit`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(packs): phase mappings accept a templates list`

---

### Task 3: Assembler pins every template

**Files:**
- Modify: `src/assembler/assemble.ts` (`pinnedTemplate` → `pinnedTemplates`), `src/assembler/render.ts`
- Test: `test/integration/assembler/assemble.test.ts`

**Interfaces:**
- Consumes: `phaseTemplates` (task 2).
- Produces: position 3 of a pack holds each pinned template, in order, each under `### <title> (<stable_id>)`; `context_packs.items` lists every pinned template.

- [ ] **Step 1: Write the failing test**

Seed a framework pack whose specify phase declares `templates: [t.proposal, t.spec]` (extend `test/helpers/seedPacks.ts` with an option for it). Assert that `rendered` contains both template bodies, in order, each under its heading; that `items` contains both stable ids; and that a missing second template produces the warning `phase template "t.spec" not found for <fw>@<ver>` while the first is still pinned.

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=… npx vitest run test/integration/assembler/assemble.test.ts`
Expected: FAIL — only the first template is present.

- [ ] **Step 3: Implement**

`pinnedTemplates(deps, feature, ids, warnings)` maps `pinnedTemplate` over the ids and drops nulls. `PackSections.template` stays a string: `assemble.ts` joins the rendered templates with a blank line, each as `### ${item.title} (${item.stable_id})\n\n${item.body}`. `excludeItemIds` excludes every pinned template from retrieval. When a phase pins exactly one template, keep today's output unchanged (no extra heading), so existing snapshots and host expectations hold.

- [ ] **Step 4: Run to verify it passes**

Run the assembler test and `npx vitest run test/unit/assembler`.
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(assembler): pin every template a phase declares`

---

### Task 4: Seed packs pin every document their gates need

**Files:**
- Modify: `packs/openspec/pack.yaml`, `packs/bmad/pack.yaml`, `packs/sdlc/pack.yaml`, `docs/verification/host-integration.md`, `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md` (one-line note in §9.1 pointing to the new spec)
- Test: `test/unit/packs/openspec.test.ts`, `bmad.test.ts`, `sdlc.test.ts`, `test/integration/packs/lifecycle.test.ts`

**Interfaces:**
- Produces: pack version `1.1.0` for `openspec`, `spec-kit`, `bmad`, `sdlc`, `kiro` (bumped once for release A; task 8 adds gates under the same version before release).

- [ ] **Step 1: Write the failing tests**

Pack unit tests assert, per the spec's table in §8:

```ts
expect(tracks.default!.phases.specify).toMatchObject({ templates: ['openspec.template.proposal', 'openspec.template.spec', 'openspec.template.tasks'] });
expect(tracks.refactor!.phases.specify).toMatchObject({ templates: ['openspec.template.refactor-proposal', 'openspec.template.spec'] });
```

and the equivalents for `bmad` `full` (`prd`, `architecture`) and `sdlc` `default` (`prd`, `scoping`). In `lifecycle.test.ts`, assert the specify pack for openspec `default` contains the text of the spec and tasks templates.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — phases still declare `template`.

- [ ] **Step 3: Edit the packs and docs**

Replace `template:` with `templates: [...]` on those phases; bump `version` to `1.1.0` in the five framework packs. Remove the "One template is pinned per phase" subsection from `host-integration.md`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/unit/packs` and the lifecycle integration test.
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(packs): pin proposal, spec and tasks templates where the gate needs them`

---

### Task 5: `feature_requirements` table and store

**Files:**
- Create: `migrations/1758758400000_feature_requirements.js`, `src/store/requirements.ts`
- Modify: `src/store/rows.ts`, `test/helpers/db.ts`
- Test: `test/integration/db/migrate.test.ts`, `test/integration/store/requirements.test.ts`

**Interfaces:**
- Produces:
  - table `feature_requirements (feature_id text REFERENCES features(id), req_id text, artifact text, line int, transition_id text REFERENCES phase_transitions(id), <audit>, PRIMARY KEY (feature_id, req_id))`;
  - `replaceRequirements(q, featureId, transitionId, reqs: {id: string; artifact: string; line: number}[], actor)`: delete then insert in the caller's transaction;
  - `listRequirements(q, featureId): Promise<FeatureRequirementRow[]>` ordered by `line`.

- [ ] **Step 1: Failing tests**: table exists; replace twice leaves only the second set; list orders by line.
- [ ] **Step 2: Run** — FAIL (no table).
- [ ] **Step 3: Implement** the migration (with `down`), row type, store, and add `feature_requirements` first in the `TRUNCATE` list.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(store): feature_requirements captured from accepted specs`

---

### Task 6: Gate checks `requirement_ids` and `requirement_coverage`

**Files:**
- Create: `src/gates/checks/requirementIds.ts`, `src/gates/checks/requirementCoverage.ts`
- Modify: `src/gates/types.ts` (`CheckInput.requirements: string[]`), `src/gates/run.ts` (`GateContext.requirements?: string[]`), `src/gates/library.ts` (register both; `GATE_LIBRARY_VERSION = '2'`)
- Test: `test/unit/gates/checks/requirements.test.ts`, `test/unit/gates/run.test.ts`, `test/unit/ingest/validate.test.ts`

**Interfaces:**
- Produces:
  - `extractRequirementIds(text: string, idRegex: string): { id: string; line: number }[]` (exported, used by task 7);
  - `requirement_ids` params `{ artifact: string; id_regex: string; min: number = 1 }`. The zod schema refines `id_regex`: it must compile with flags `gm` and contain the named group `(?<id>`; otherwise ingestion reports `check requirement_ids has invalid params: id_regex …`;
  - `requirement_coverage` params `{}`.

- [ ] **Step 1: Write the failing tests**

```ts
const spec = '## Functional Requirements\n- **FR-001**: The system MUST export CSV.\n- **FR-002**: The system MUST stream.\n- **FR-002**: duplicate\n';
it('extracts ids with line numbers', () => {
  expect(extractRequirementIds(spec, String.raw`\*\*(?<id>FR-\d{3})\*\*`)).toEqual([
    { id: 'FR-001', line: 2 }, { id: 'FR-002', line: 3 }, { id: 'FR-002', line: 4 }]);
});
it('requirement_ids blocks below min and on duplicates', () => { /* findings at spec.md:4 "duplicate requirement id FR-002"; min 5 → "found 3 requirement ids, expected at least 5" */ });
it('requirement_coverage reports uncovered and unknown ids, case-insensitively', () => {
  // requirements ['FR-001','FR-002'], evidence.implements [' fr-001 ', 'FR-009']
  // → blocker "FR-002 is not covered by evidence.implements"; warning "FR-009 in evidence.implements is not a requirement of this feature"
});
it('requirement_coverage warns once when nothing was captured', () => { /* requirements [] → one warning, no blocker */ });
it('rejects an id_regex without a named id group at ingestion', () => { /* validateGateDecl */ });
```

- [ ] **Step 2: Run** — FAIL (modules missing).
- [ ] **Step 3: Implement.** `runGate` passes `ctx.requirements ?? []` in `base`. Coverage reads `implements` from `evidence` defensively (the check may run before `verify_evidence` has validated the shape).
- [ ] **Step 4: Run** `npx vitest run test/unit` — PASS.
- [ ] **Step 5: Commit** — `feat(gates): requirement_ids and requirement_coverage checks`

---

### Task 7: Capture requirements on pass; feed them to verify

**Files:**
- Modify: `src/services/advancePhase.ts`, `src/services/featureState.ts`, `src/services/featureStatus.ts`, `src/mcp/schemas.ts`, `src/mcp/tools/getFeatureStatus.ts`
- Test: `test/integration/services/advance.test.ts`, `test/contract/lifecycle.test.ts`

**Interfaces:**
- Consumes: `extractRequirementIds`, `replaceRequirements`, `listRequirements`.
- Produces: `get_feature_status` → `requirements: { id: string; covered: boolean | null }[]`. `covered` is `null` until a forward transition out of `verify` has passed, then derived from that transition's evidence `implements` (case-insensitive).

- [ ] **Step 1: Failing tests**: a feature whose specify gate declares `requirement_ids` stores the ids on pass and not on fail; a backward move to specify and a new pass replaces them; the verify gate receives them (coverage blocker when `implements` misses one); `get_feature_status` reports coverage.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In `advancePhase`, before `runGate`, load `listRequirements(tx, feature.id)` and pass their ids. After a forward `pass` whose gate contains `requirement_ids`, call `replaceRequirements` with the ids extracted from that check's artifact, deduplicated by first occurrence. Task 17 must call the same capture code when an approval applies a transition; put it in a helper `captureRequirements(tx, gate, artifacts, featureId, transitionId, actor)` in `src/services/requirements.ts` now.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(lifecycle): capture requirements at the spec gate and check coverage out of verify`

---

### Task 8: Seed packs declare requirement checks

**Files:**
- Modify: `packs/spec-kit/pack.yaml`, `packs/openspec/pack.yaml`, `packs/bmad/pack.yaml`, `packs/sdlc/pack.yaml`, `packs/kiro/pack.yaml`
- Test: pack unit tests; `test/integration/packs/lifecycle.test.ts` (fixtures gain requirement ids and matching `implements`)

Add to the spec gate and to the gate out of `verify`, with the regexes from spec §7.1:

| Pack / track | Spec gate check | Verify gate check |
|---|---|---|
| spec-kit `default` | `{ name: requirement_ids, params: { artifact: spec.md, id_regex: '\*\*(?<id>FR-\d{3})\*\*' } }` | `{ name: requirement_coverage }` |
| openspec `default` | `{ … artifact: spec.md, id_regex: '^###\s+Requirement:\s+(?<id>.+?)\s*$' }` | `{ name: requirement_coverage, severity: warning }` |
| bmad `full` | `{ … artifact: prd.md, id_regex: '\*\*(?<id>N?FR\d+)\*\*' }` | `{ name: requirement_coverage }` |
| sdlc `default` | `{ … artifact: prd.md, id_regex: '\*\*(?<id>R\d+)\*\*' }` | `{ name: requirement_coverage }` |
| kiro `default` | `{ … artifact: requirements.md, id_regex: '^###\s+Requirement\s+(?<id>\d+)\s*$' }` | `{ name: requirement_coverage }` |

- [ ] **Step 1: Failing tests**: pack tests assert the declarations; the lifecycle walk for every seed track still reaches `archived` with fixtures that carry ids, and a spec-kit walk with a missing id in `implements` fails at verify.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Edit packs** (single-quoted YAML strings so backslashes survive); `npx vitest run test/unit/packs/allPacks.test.ts` validates every pack.
- [ ] **Step 4: Run** unit and integration — PASS.
- [ ] **Step 5: Commit** — `feat(packs): capture and check requirement ids in every functional track`

---

### Task 9: Traceability matrix: store, resource, CLI, admin API and UI

**Files:**
- Create: `src/store/rtm.ts`, `src/cli/commands/export.ts`, `admin-ui/src/views/Requirements.tsx` (section used by `FeatureDetail` and by a per-app table in `AppsFeatures`)
- Modify: `src/mcp/resources.ts`, `src/cli/index.ts`, `src/web/adminRoutes.ts`, `admin-ui/src/api.ts`, `admin-ui/src/types.ts`, `admin-ui/src/views/FeatureDetail.tsx`, `admin-ui/src/views/AppsFeatures.tsx`
- Test: `test/integration/store/rtm.test.ts`, `test/contract/resources.test.ts`, `test/integration/cli/cli.test.ts`, `test/contract/adminRoutes.test.ts`, admin-ui view tests

**Interfaces:**
- Produces: `rtmRows(q, appId): Promise<RtmRow[]>` with `{ feature_id, slug, external_ref, req_id, covered: boolean | null, files_changed: string[], tests_passed: number | null, tests_failed: number | null, evidence_source: 'ci' | 'host' | null, spec_approved_by: string | null, verify_approved_by: string | null, archived_at: string | null }`. Until release B, `evidence_source` is `'host'` when evidence exists and the two `approved_by` fields come from `phase_transitions.created_by` on the passing transitions with `human_approved = true`; task 22 and task 17 switch them to the new columns.
- Resource `sdd://apps/{slug}/rtm` (JSON), `sdd-admin export rtm <app> [--format csv|json]` (CSV header in the field order above), `GET /admin/api/apps/:app/rtm`.

- [ ] **Step 1: Failing tests** for the query (one covered and one uncovered requirement; a feature with no requirements yields no rows), the resource, the CLI CSV output, the admin route (404 on unknown app), and the UI rendering covered/uncovered/pending badges.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** One SQL query over `feature_requirements`, `features`, and the latest passing forward transition out of `verify` per feature (`DISTINCT ON (feature_id) … ORDER BY feature_id, created_at DESC`).
- [ ] **Step 4: Run** all suites including `npm run test:admin-ui` — PASS.
- [ ] **Step 5: Commit** — `feat(rtm): requirement traceability matrix per app`

---

### Task 10: Release A documentation

**Files:** `README.md` (use cases: traceability; repository layout: `.github/`), `docs/verification/host-integration.md` (requirement ids and `implements`), `docs/operations.md` (re-ingest to `1.1.0`; pinned features keep `1.0.0` gates).

- [ ] **Step 1:** Update the three documents; run `npx vitest run test/unit/docs` (the workspace-facts doc test) — PASS.
- [ ] **Step 2: Commit** — `docs: templates per phase, requirement traceability and CI`

Open the release A pull request here.

---

# Release B: tokens, approvals, CI evidence

### Task 11: `api_tokens` table and store

**Files:**
- Create: `migrations/1758758460000_api_tokens.js`, `src/store/tokens.ts`, `src/auth/tokens.ts`
- Modify: `src/store/rows.ts`, `test/helpers/db.ts`
- Test: `test/unit/auth/tokens.test.ts`, `test/integration/store/tokens.test.ts`, migrate test

**Interfaces:**
- Produces:
  - table `api_tokens` per spec §12, plus column `phase_transitions.token_id text REFERENCES api_tokens(id)` (nullable) in the same migration;
  - `src/auth/tokens.ts`: `generateToken(): string`, `hashToken(token: string): string` (sha256 hex), `SCOPES = ['host','ci','approver','admin'] as const`, `type Scope`;
  - `src/store/tokens.ts`: `createToken(q, {actor, name, scopes, app_ids, expires_at}, createdBy): Promise<{ row: ApiTokenRow; secret: string }>`, `findActiveTokenByHash(q, hash)` (not revoked, not expired), `listTokens(q, {actor?})`, `revokeToken(q, id, reason, actor)`, `touchToken(q, id)` which updates `last_used_at` only when it is null or older than 60 s (single `UPDATE … WHERE last_used_at IS NULL OR last_used_at < now() - interval '60 seconds'`).

- [ ] **Step 1: Failing tests**: generated tokens match `/^sdd_[A-Za-z0-9_-]{43}$/` and differ; only the hash is stored; revoked and expired tokens are not found; `touchToken` twice within a minute writes once (compare `updated_at`); scopes `CHECK` rejects `root`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with `crypto.randomBytes(32).toString('base64url')`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(auth): api tokens stored as hashes`

---

### Task 12: `sdd-admin token`

**Files:**
- Create: `src/cli/commands/token.ts`
- Modify: `src/cli/index.ts`
- Test: `test/integration/cli/cli.test.ts`

Commands per spec §4.1. `--expires` accepts `<n>d`; `--scope` is comma-separated and validated against `SCOPES`; `create` prints the secret on its own line after a line saying it will not be shown again; `list` never prints hashes.

- [ ] **Step 1: Failing CLI tests** for create (secret printed once, row stored with scopes and apps), unknown app slug refused, list output, revoke.
- [ ] **Step 2–4:** Implement and run — PASS.
- [ ] **Step 5: Commit** — `feat(cli): sdd-admin token create, list and revoke`

---

### Task 13: Auth modes and the `/mcp` middleware

**Files:**
- Create: `src/auth/context.ts`, `src/web/mcpAuth.ts`
- Modify: `src/config.ts` (`authMode`), `src/mcp/http.ts`, `src/mcp/server.ts` (`createMcpServer(deps, auth)`), `src/mcp/stdio.ts`, `src/services/deps.ts` (`authMode` on `ServiceDeps`), `.env.example`, `docker-compose.yml`
- Test: `test/unit/config.test.ts`, `test/unit/web/mcpAuth.test.ts`, `test/contract/http.test.ts`

**Interfaces:**
- Produces:
  - `type AuthMode = 'enforce' | 'warn' | 'off'`; `Config.authMode`, parsed from `SDD_AUTH_MODE`, default `'warn'`;
  - `type AuthContext = { kind: 'token'; token_id: string; actor: string; scopes: Scope[]; app_ids: string[] | null } | { kind: 'anonymous'; mode: AuthMode } | { kind: 'local' }` (stdio);
  - `mcpAuth(deps, mode): RequestHandler` sets `res.locals.auth`. `enforce`: missing token → 401 `{ error: 'unauthorized' }` with `WWW-Authenticate: Bearer realm="sdd"`; `warn`: missing → anonymous; `off`: header ignored → anonymous; invalid token → 401 in `enforce` and `warn`. Increments `sdd_auth_rejections_total{reason}` with `reason` in `missing`, `invalid`, and, in `warn`, `would_reject` for accepted anonymous calls.

- [ ] **Step 1: Failing tests**: config default `warn` and rejection of `strict`; middleware matrix (3 modes × no header / valid / invalid / revoked); HTTP contract: in `enforce` an unauthenticated `tools/list` is 401 and an authenticated one lists tools.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `createHttpApp` mounts `mcpAuth` on the three `/mcp` routes; `handle` reads `res.locals.auth` and calls `createMcpServer(deps, auth)`. Registrars get `(server, deps, auth)`. stdio passes `{ kind: 'local' }`. `.env.example` and compose set `SDD_AUTH_MODE=warn` with a comment recommending `enforce`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(auth): SDD_AUTH_MODE and bearer tokens on /mcp`

---

### Task 14: Actor resolution, scopes, app restriction, `FORBIDDEN`

**Files:**
- Create: `src/auth/authorize.ts`
- Modify: `src/errors.ts`, `src/mcp/schemas.ts` (`ActorSchema` optional), every file in `src/mcp/tools/`, `src/mcp/resources.ts`, `src/mcp/prompts.ts`, `src/store/transitions.ts` (`token_id`)
- Test: `test/unit/auth/authorize.test.ts`, `test/unit/errors.test.ts`, `test/contract/auth.test.ts` (new)

**Interfaces:**
- Produces:
  - `resolveActor(auth, payloadActor: string | undefined, warnings: string[]): string`. Token → token actor, plus a warning when the payload differs. Anonymous in `warn` → payload actor, plus the warning `unauthenticated call accepted because SDD_AUTH_MODE=warn`. Anonymous in `off`, or local → payload actor or `SDD_ACTOR`. A missing actor where one is needed → `VALIDATION_ERROR` field `actor`;
  - `authorize(auth, { scope: Scope; apps: string[] | 'company' }): void`. Throws `FORBIDDEN` for a missing scope (`admin` satisfies `approver`), a disallowed app, or `company` with an app-restricted token. Anonymous and local pass;
  - `ERROR_PRECEDENCE` gains `FORBIDDEN` after `VALIDATION_ERROR`.

- [ ] **Step 1: Failing tests**: unit matrix for both helpers; contract over HTTP in `enforce`: a `ci` token calling `route_task` gets `FORBIDDEN`; an app-restricted token calling `get_context` for another app's feature gets `FORBIDDEN`; the recorded `created_by` is the token actor even when the payload says otherwise, with the warning; `phase_transitions.token_id` is set.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Each tool handler resolves the feature's or payload's app before calling the service, calls `authorize`, resolves the actor, and merges its warnings into the result's `warnings`. Services keep `actor: string` and gain an optional `token_id`.
- [ ] **Step 4: Run** all suites — PASS.
- [ ] **Step 5: Commit** — `feat(auth): actor from token, scopes and app restriction on every tool`

---

### Task 15: Admin login with personal tokens

**Files:**
- Modify: `src/web/adminAuth.ts`, `src/web/adminRoutes.ts`
- Test: `test/unit/web/adminAuth.test.ts`, `test/contract/adminRoutes.test.ts`

**Interfaces:**
- Produces: `adminAuth(deps, legacyToken: string | null)` sets `res.locals.admin = { actor: string; canApprove: boolean; apps: string[] | null }`. The Basic password is checked first as a personal token (hash lookup; needs `approver` or `admin`), then against `SDD_ADMIN_TOKEN` with timing-safe comparison (`actor: 'admin-token'`, `canApprove: false`). The admin router is mounted when either `SDD_ADMIN_TOKEN` is set or any mode other than `off` is active.

- [ ] **Step 1–4:** Failing tests (personal approver token logs in with `canApprove: true`; host-only token is 401; legacy token logs in read-only), implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(admin): log in with a personal approver token`

---

### Task 16: `approval_requests` table and store

**Files:**
- Create: `migrations/1758758520000_approval_requests.js`, `src/store/approvals.ts`
- Modify: `src/store/rows.ts`, `src/store/transitions.ts`, `test/helpers/db.ts`
- Test: migrate test, `test/integration/store/approvals.test.ts`

**Interfaces:**
- Produces:
  - table per spec §12; migration also runs `ALTER TABLE phase_transitions DROP CONSTRAINT phase_transitions_result_check, ADD CONSTRAINT phase_transitions_result_check CHECK (result IN ('pass','fail','awaiting_approval'))`, and adds nullable `approval_id`, `approved_by`; partial unique index `approval_requests_one_pending ON approval_requests (feature_id) WHERE status = 'pending'`;
  - `createApproval`, `pendingApproval(q, featureId)`, `supersedePending(q, featureId, actor)`, `getApproval(q, id, {forUpdate})`, `decideApproval(q, id, {status, decided_by, comment})`, `listApprovals(q, {appId?, status?})`.

The init migration declares the check inline, so Postgres names it `phase_transitions_result_check`; confirm with `\d phase_transitions` before writing the `DROP CONSTRAINT`.

- [ ] **Step 1–4:** Failing tests (two pending for one feature is refused by the index; supersede then create works; `awaiting_approval` accepted by the transitions check), implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(store): approval requests and awaiting_approval transitions`

---

### Task 17: `advance_phase` requests approval

**Files:**
- Modify: `src/services/advancePhase.ts`, `src/services/featureState.ts` (`pending_approval`), `src/mcp/tools/advancePhase.ts` (output schema: `result` enum adds `awaiting_approval`; optional `approval_id`), `src/mcp/schemas.ts` (`FeatureStateShape.pending_approval`), `src/metrics.ts`
- Test: `test/integration/services/advance.test.ts`, `test/contract/lifecycle.test.ts`

**Interfaces:**
- Produces: when `deps.authMode !== 'off'` and the move needs approval (`mandatesApproval(...)` or the gate declares `human_approved`):
  1. run the gate with `human_approved` removed from its checks and `mandatedApproval = false`;
  2. blocker → `fail` as today;
  3. otherwise supersede any pending request, insert the transition with `result: 'awaiting_approval'`, store the artifacts, create the request, return `{ result: 'awaiting_approval', approval_id, findings, next_instructions, feature, warnings }` with the instruction text from spec §5.2;
  4. a `human_approved: true` input adds the warning `human_approved is ignored; approval is requested from a person on the server`;
  5. `dry_run` returns `awaiting_approval` without writing;
  6. a backward move supersedes a pending request.
- `FeatureState.pending_approval: { approval_id, from, to, requested_by, requested_at } | null`.

- [ ] **Step 1: Failing tests** for each numbered behaviour, plus `authMode: 'off'` keeping v1 behaviour exactly (existing tests run with `off` via the service deps helper; add a helper option).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all suites — PASS.
- [ ] **Step 5: Commit** — `feat(lifecycle): mandated approvals wait for a person on the server`

---

### Task 18: Deciding approvals; distinct approver

**Files:**
- Create: `src/services/decideApproval.ts`
- Modify: `src/errors.ts` (`APPROVAL_NOT_FOUND`, `APPROVAL_NOT_PENDING`), `src/domain/types.ts` and the policy zod schema (`approval: { distinct_approver: boolean }` optional), `src/metrics.ts` (`sdd_approvals_total{decision}`, `sdd_approval_wait_seconds`)
- Test: `test/integration/services/approvals.test.ts`

**Interfaces:**
- Produces: `approveRequest(deps, { approval_id, actor, comment?, apps: string[] | null })` and `rejectRequest(deps, { approval_id, actor, reason, apps })` per spec §5.3–5.4. Approve locks the feature, checks pending status, phase and archive state, and distinct approver (`policy.approval?.distinct_approver || app.compliance || feature.high_risk`). It inserts a `pass` transition with `human_approved: true`, `approved_by`, `approval_id`, copying `evidence`, `artifact_hashes` and `pack_id` from the awaiting transition, moves the feature, and calls `captureRequirements` (task 7) when the gate declares `requirement_ids`. It returns `{ feature, next_instructions }`.

- [ ] **Step 1–4:** Failing tests for approve, reject (fail transition with the rejection finding), not pending, stale phase, archived, self-approval on a compliance app → `FORBIDDEN`, self-approval allowed on a normal app, app-restricted approver → `FORBIDDEN`; implement; run — PASS.
- [ ] **Step 5: Commit** — `feat(approvals): approve and reject with distinct-approver policy`

---

### Task 19: `sdd-admin approvals`

**Files:** Create `src/cli/commands/approvals.ts`; modify `src/cli/index.ts`; test `test/integration/cli/cli.test.ts`.

Commands per spec §5.3. `show` prints the move, requester, age, findings, evidence and each artifact (name, size, first 40 lines; `--full` for all). CLI decisions use `--actor` and are unrestricted by app (administrator tier).

- [ ] **Step 1–4:** Failing tests, implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(cli): sdd-admin approvals list, show, approve and reject`

---

### Task 20: Approvals in the admin API and UI

**Files:**
- Create: `admin-ui/src/views/Approvals.tsx`, `admin-ui/src/views/ApprovalDetail.tsx`
- Modify: `src/web/adminRoutes.ts` (`GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/approve`, `POST /api/approvals/:id/reject`), `admin-ui/src/App.tsx` (sixth tab), `admin-ui/src/api.ts`, `admin-ui/src/types.ts`
- Test: `test/contract/adminRoutes.test.ts`, `admin-ui` view tests

**Interfaces:**
- POST routes need `res.locals.admin.canApprove` (else 403 `{ error: 'approver scope required' }`); `FORBIDDEN` → 403, `APPROVAL_NOT_FOUND` → 404, `APPROVAL_NOT_PENDING` and `STALE_STATE` → 409. The admin router needs `express.json()` for the POST bodies (`{ comment? }`, `{ reason }`).
- `GET /api/me` returns `{ actor, canApprove }` so the UI can disable buttons.

- [ ] **Step 1–4:** Failing tests (routes: list, detail with artifacts, approve, reject without reason → 400, read-only login → 403; UI: list, detail, buttons disabled for read-only, reject requires a reason, success refreshes the list), implement, run all including `npm run test:admin-ui` — PASS.
- [ ] **Step 5: Commit** — `feat(admin-ui): Approvals tab`

---

### Task 21: CI evidence endpoint

**Files:**
- Create: `migrations/1758758580000_ci_evidence.js`, `src/store/ciEvidence.ts`, `src/web/ciRoutes.ts`
- Modify: `src/mcp/http.ts` (mount `/api/ci` with `express.json({ limit: '1mb' })` and bearer auth requiring scope `ci`), `src/store/commits.ts` (`source: 'ci'`), `src/store/rows.ts`, `test/helpers/db.ts`
- Test: migrate test, `test/integration/store/ciEvidence.test.ts`, `test/contract/ciEvidence.test.ts`

**Interfaces:**
- Migration: table `ci_evidence` per spec §12; `commits.source` check adds `ci`; `phase_transitions` adds nullable `ci_evidence_id`, `evidence_sources jsonb`.
- `POST /api/ci/evidence` body schema: `{ app, feature_id, commit_sha (7–64 hex), branch?, run_url? (url), evidence: VerifyEvidenceSchema.deepPartial() }`. Responses: 201 `{ ci_evidence_id, commit_id }`; 400 schema; 401 no or invalid token (in every mode except `off`, where the route is disabled with 404 — CI evidence needs an identity); 403 wrong scope or app, or feature not in `app`; 404 unknown app or feature.
- The commit upsert uses `source = 'ci'`, anchors `feature_id` (and `routing_id` from the feature's event), and fills null anchors as `record_commit` does.

- [ ] **Step 1–4:** Failing tests, implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(ci): authenticated endpoint for CI evidence`

---

### Task 22: Evidence merge and CI requirement at the verify gate

**Files:**
- Create: `src/gates/mergeEvidence.ts`
- Modify: `src/services/advancePhase.ts`, `src/services/decideApproval.ts` (copy `ci_evidence_id`, `evidence_sources`), policy schema (`evidence: 'ci' | 'host'` optional), `src/store/rtm.ts` (evidence source from `evidence_sources`)
- Test: `test/unit/gates/mergeEvidence.test.ts`, `test/integration/services/advance.test.ts`

**Interfaces:**
- `requiresCiEvidence({ compliance, high_risk, policyEvidence }): boolean`: compliance → true; else `policyEvidence === 'host'` → false; else `policyEvidence === 'ci' || high_risk`.
- `mergeEvidence(host: unknown, ci: Record<string, unknown> | null, required: boolean): { evidence: Record<string, unknown>; sources: Record<string, 'ci' | 'host'>; findings: Finding[] }`. When required, `tests`, `lint` and `security` are taken only from CI; a missing one is a `verify_evidence` blocker naming the field.
- In `advancePhase`, for a forward move whose gate declares `verify_evidence`, and only when `authMode !== 'off'`:
  1. load the latest `ci_evidence` for the feature created after its last transition into `verify`;
  2. when required, add blockers for no evidence and for a commit mismatch against the feature's latest commit (spec §6.3);
  3. pass the merged evidence to `runGate` and store it with `evidence_sources` and `ci_evidence_id`.

- [ ] **Step 1–4:** Failing unit tests for every branch of both functions; integration tests (compliance app blocks without CI evidence; stale commit blocks; CI evidence overrides host tests on a normal app; `evidence: 'host'` opts a high-risk feature out; `off` ignores CI rows). Implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(evidence): prefer CI evidence and require it for compliance and high-risk work`

---

### Task 23: CI script and GitHub Actions example

**Files:**
- Create: `scripts/sdd-ci-evidence.mjs`, `docs/ci/github-actions.md`
- Test: `test/integration/scripts/ciEvidence.test.ts` (runs the script with `node` against the contract-test HTTP server, in a temporary git repository with an `SDD-Ref` trailer)

Behaviour per spec §6.2: reads `SDD_URL`, `SDD_CI_TOKEN`, `SDD_APP`; `--evidence <file>` (required), `--run-url`, `--feature`, `--branch`. It exits 0 with `no SDD-Ref trailer on HEAD; nothing to report` when no feature is found; exits 1 with the server's message on 4xx/5xx. It uses global `fetch`; no dependencies.

- [ ] **Step 1–4:** Failing tests (trailer found → 201 and row stored; no trailer → exit 0, nothing stored; bad token → exit 1), implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(ci): sdd-ci-evidence script and GitHub Actions guide`

---

### Task 24: Release B documentation and metrics check

**Files:** `README.md` (tokens, approvals, CI evidence; the security posture paragraph), `docs/operations.md` (rollout steps from spec §14, auth modes, token rotation), `docs/verification/host-integration.md` (Authorization header, `awaiting_approval` handling, `SDD-Ref` trailer now used by CI), `docs/verification/feature-matrix.md` (rows for approvals and CI evidence), `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md` (§11.3 note pointing to the new spec).

- [ ] **Step 1:** Assert in `test/unit/metrics.test.ts` that every metric named in spec §13 is registered; run — PASS after adding any missing.
- [ ] **Step 2:** Update the documents.
- [ ] **Step 3: Commit** — `docs: tokens, approvals and CI evidence`

Open the release B pull request here.

---

# Release C: enforcement in Claude Code, verification

### Task 25: Confirm the PostToolUse contract

**Files:** this plan (record the result under this task).

- [ ] **Step 1:** In a scratch project, install a PostToolUse hook matching `mcp__.*` that writes its stdin to a file; call a tool of any MCP server; inspect the payload with the installed Claude Code version.
- [ ] **Step 2:** If the payload carries the tool result (`tool_response`, with `structuredContent` or the text content), tasks 27–28 read it. If not, add **Task 25a** before task 26: `route_task` accepts optional `branch` (stored on `routing_events`, migration column), and a `host`-scoped `GET /api/host/state?app=&branch=&external_ref=` returns `{ routing_id, lite, feature: FeatureState | null }` for the caller's most recent match; the hooks call it with the plugin token.
- [ ] **Step 3:** Record the Claude Code version, the observed payload shape and the chosen path here, and commit — `docs(plan): record the PostToolUse payload contract`.

**Result (2026-09-25, Claude Code 2.1.282):** a headless session with a PostToolUse hook matching `mcp__.*` received, for `mcp__sdd__list_features` and `mcp__sdd__start_feature`, a payload with `hook_event_name`, `tool_name` (`mcp__sdd__<tool>` for a project-configured server), `tool_input`, `tool_use_id`, `cwd`, `session_id`, `mcp_server: { name, source }` and `tool_response`. `tool_response` is a **string holding the tool's `structuredContent` as JSON** (for `start_feature` it carried `feature_id`, `routing_id`, `context_pack` and `feature`), not the text content block. PostToolUse does not fire for tool results with `isError: true`. **Chosen path:** hooks `JSON.parse` the `tool_response` string (accepting an object too). Task 25a is not needed.

---

### Task 26: Plugin scaffold

**Files:**
- Create: `.claude-plugin/marketplace.json`, `hosts/claude-code/.claude-plugin/plugin.json`, `hosts/claude-code/skills/sdd-workflow/SKILL.md`, `hosts/claude-code/commands/status.md`, `hosts/claude-code/commands/route.md`, `hosts/claude-code/README.md`
- Test: `test/unit/plugin/manifest.test.ts` (JSON parses; every file the manifests reference exists; hook matchers compile as regexes)

`plugin.json`: `name: "sdd"`, `userConfig` for `server_url` and `token` (token marked sensitive if the format supports it; check the manifest reference at implementation time), `mcpServers.sdd` of type `http` with the URL and `Authorization: Bearer` header from that config. The skill restates the host-integration session flow in imperative steps, and says to set `workspace.intent` for spike, incident, refactor, product and trivial work.

- [ ] **Step 1–4:** Failing manifest test, write files, run — PASS.
- [ ] **Step 5: Commit** — `feat(plugin): Claude Code plugin scaffold with MCP server, skill and commands`

---

### Task 27: Hook library: state and edit decisions

**Files:**
- Create: `hosts/claude-code/hooks/lib/state.mjs`, `hosts/claude-code/hooks/lib/decide.mjs`
- Test: `hosts/claude-code/test/decide.test.mjs` (run by vitest via an `include` added to `vitest.config.ts`)

**Interfaces:**
- `readConfig(projectDir)`, `readState(projectDir)`, `writeState(projectDir, patch)` (atomic write: temp file and rename; `.sdd/state.json` keyed by current branch from `git rev-parse --abbrev-ref HEAD`);
- `stateFromToolResult(toolName, result)` for the five tools (path chosen in task 25);
- `decideEdit({ state, config, relPath }): { allow: true } | { allow: false; reason: string }` implementing the table in spec §9.3, with spec-library prefixes `openspec/`, `specs/`, `.specify/`, `_bmad-output/`, `.kiro/specs/`, `.sdlc/` and `docs/**/*.md`;
- `bashWriteTargets(command): string[]` for `>`, `>>` and `tee [-a]` targets (best effort, documented as such).

- [ ] **Step 1: Failing tests**: one test per row of spec §9.3; `.sdd/` always denied; `enforcement: warn` returns allow with a `warning`; `off` allows everything; `bashWriteTargets('echo x > src/a.ts && cat y | tee -a b.txt')` → `['src/a.ts', 'b.txt']`.
- [ ] **Step 2–4:** Implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(plugin): state cache and edit rules`

---

### Task 28: Hooks

**Files:**
- Create: `hosts/claude-code/hooks/hooks.json`, `session-start.mjs`, `post-sdd-tool.mjs`, `pre-edit.mjs`, `pre-bash.mjs`, `post-bash.mjs` under `hosts/claude-code/hooks/`
- Modify: `.github/workflows/ci.yml` (job `plugin`: `npx vitest run hosts/claude-code/test`)
- Test: `hosts/claude-code/test/hooks.test.mjs` (spawns each script with fixture stdin and a temporary project dir; asserts stdout JSON and files written)

Matchers: `^mcp__(plugin_sdd_)?sdd__(route_task|start_feature|advance_phase|get_feature_status|get_context)$` for `post-sdd-tool`; `^(Edit|Write|MultiEdit|NotebookEdit)$` for `pre-edit`; `^Bash$` for `pre-bash` and `post-bash`. Outputs use `hookSpecificOutput` with `permissionDecision: "deny"` plus `permissionDecisionReason` for denials, and `additionalContext` for context. `post-bash` acts only when `tool_input.command` matches `\bgit\s+commit\b`, reads `git rev-parse HEAD`, and checks the message for an `SDD-Ref` trailer. Every script exits 0 on its own errors, writing to stderr, so a broken hook never blocks work silently (except `pre-edit` and `pre-bash` decisions, which are deliberate).

- [ ] **Step 1–4:** Failing tests per hook (including: no `.sdd/config.json` → no output), implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(plugin): hooks that enforce the lifecycle in Claude Code`

---

### Task 29: Manual check in Claude Code

**Files:** `docs/verification/feature-matrix.md`, `hosts/claude-code/README.md`

- [ ] **Step 1:** A person installs the plugin from the branch (`/plugin marketplace add <path or repo>`), runs the OpenSpec walkthrough in `docs/verification/walkthrough-openspec.md`, and confirms: an edit before routing is denied with a useful reason; state follows `advance_phase`; a pending approval blocks code edits; `git commit` prompts `record_commit`.
- [ ] **Step 2:** Record the date, Claude Code version and deviations in the matrix's Claude Code column; fix what fails before continuing.
- [ ] **Step 3: Commit** — `docs: Claude Code verification with the sdd plugin`

---

### Task 30: `sdd-admin eval`

**Files:**
- Create: `src/eval/run.ts`, `src/cli/commands/eval.ts`, `packs/evals/seed.yaml`
- Modify: `src/cli/index.ts`, `.github/workflows/ci.yml` (job `eval`: ingest seed packs into the service database with the fake provider, run `sdd-admin eval packs/evals/seed.yaml --min-recall 0`; a second step with `if: ${{ secrets.VOYAGE_API_KEY != '' }}` via an env check runs with Voyage and `--min-recall 0.8`)
- Test: `test/unit/eval/metrics.test.ts` (recall@k, MRR), `test/integration/cli/eval.test.ts`

**Interfaces:**
- Case schema: `{ query: string; phase: Phase; framework: string; framework_pack_version?: string; app?: string; scope?: Scope; expect: string[] }`.
- `runEval(deps, cases, { k: 8 }): { cases: { query, recall, rr, got: string[] }[]; recall: number; mrr: number }`, using `retrieve()` with the same filter the assembler builds (extract the filter construction from `assemble.ts` into `buildRetrievalFilter` so both share it).
- Exit code 1 when `recall < --min-recall` or `mrr < --min-mrr` (default 0).

- [ ] **Step 1–4:** Failing tests, implement, run — PASS. Write at least ten seed cases covering templates, quality layer, EARS and one stack guide.
- [ ] **Step 5: Commit** — `feat(eval): retrieval evaluation with golden cases`

---

### Task 31: Scripted walkthrough

**Files:**
- Create: `docs/verification/walkthrough.mjs`
- Modify: `docs/verification/feature-matrix.md` (Scripted column), `test/contract/walkthrough.test.ts` (runs the script against the contract-test server and asserts every line is `pass`)

The script takes `--url`, `--host-token`, `--approver-token`, `--ci-token`, `--app` and walks spec §10.2 end to end, printing `<matrix row>\tpass|fail\t<detail>`, exit 1 on any fail.

- [ ] **Step 1–4:** Failing contract test, implement, run — PASS.
- [ ] **Step 5: Commit** — `feat(verification): scripted walkthrough of the host contract`

---

### Task 32: Release C documentation

**Files:** `README.md` (plugin install, eval, walkthrough), `docs/verification/host-integration.md` (plugin as the recommended Claude Code setup; `.sdd/state.json` replaces `feature.json`), `docs/operations.md` (running the eval before `reindex`).

- [ ] **Step 1:** Update the documents; run the full suite and `npm run typecheck`.
- [ ] **Step 2: Commit** — `docs: Claude Code plugin, retrieval eval and scripted walkthrough`

Open the release C pull request here.

---

## Self-review against the spec

| Spec section | Tasks |
|---|---|
| §4 Identity and tokens | 11, 12, 13, 14, 15 |
| §5 Server-side approvals | 16, 17, 18, 19, 20 |
| §6 CI evidence | 21, 22, 23 |
| §7 Traceability | 5, 6, 7, 8, 9 |
| §8 Several templates | 2, 3, 4 |
| §9 Plugin | 25, 26, 27, 28, 29 |
| §10 Verification | 30, 31 |
| §11 CI | 1, 28, 30 |
| §12 Data model | 5, 11, 16, 21 |
| §13 Configuration, errors, metrics | 13, 14, 18, 24 |
| §14 Rollout | 10, 24 |

Open questions 2 to 5 in spec §18 are implemented with the spec's current defaults (self-approval allowed outside compliance and high-risk; CI evidence required only there; OpenSpec coverage as a warning; plugin `enforcement: block`). Each is a one-line default change if the review decides otherwise: task 18, task 22, task 8 and task 27 respectively.
