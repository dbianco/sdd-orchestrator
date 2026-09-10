# SDD Orchestrator v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `sdd-orchestrator` MCP server and `sdd-admin` CLI described in the design spec: rule-based routing, per-feature lifecycle with deterministic gates, budgeted context packs from a Postgres + pgvector knowledge base, seed packs, and host verification docs.

**Architecture:** One TypeScript service on Node 22. Pure modules first (domain types, router, gate library, lifecycle reachability) with no I/O, then a thin repository layer over `pg`, then the assembler and lifecycle engine that compose them, then the MCP surface (tools, resources, prompts) over stdio and Streamable HTTP, then ingestion CLI, seed packs and docs. Every unit has its own tests; integration and contract tests run against Postgres in Docker.

**Tech Stack:** TypeScript 5 (ESM, `NodeNext`), Node 22, `@modelcontextprotocol/sdk` 1.29+, `zod` 3.25+, `pg` + `pgvector`, `node-pg-migrate`, `js-tiktoken`, `express` 5, `pino`, `prom-client`, `commander`, `yaml`, `gray-matter`, `picomatch`, `ulid`, `vitest`, `tsx`. Postgres 16 with pgvector 0.8 via the `pgvector/pgvector:pg16` image.

**Spec:** `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md` (revision 6). Section numbers below (for example "spec §8.2") refer to it. Read the spec section before starting a task.

## Global Constraints

- Node 22, TypeScript, ESM only (`"type": "module"`, `moduleResolution: NodeNext`, relative imports end in `.js`).
- Postgres 16, pgvector 0.8 or later, `pg_trgm`. Embedding column is `vector(1024)`; every accepted model produces 1,024 dimensions (spec §11.1).
- Token counting is always `cl100k_base` through `js-tiktoken`; tokenizer name stored per chunk (spec §9.3).
- Default pack budget 6,000 tokens; chunk hard cap 512 tokens; retrieval 12 candidates, min similarity 0.35, top 8 after dedup (spec §9.2, §9.3).
- Always-on warning threshold 1,200 tokens; phase template warning threshold 3,000 tokens (half the default budget).
- Artifact text stored only up to 256 KB per artifact; larger artifacts store hash and length only (spec §6).
- Exact-id pattern is `\b(ADR|REQ|US|INC)-\d+\b` (spec §9.2).
- Default risk paths: `**/payments/**`, `**/billing/**`, `**/auth/**`, `**/*crypto*`, `**/migrations/**`, `infra/**`, `**/*.tf`, `.github/workflows/**` (spec §8.1).
- Default stop conditions, verbatim: "Ambiguity between valid approaches", "Three failed fix attempts", "Existing behaviour contradicts the acceptance criteria", "Irreversible data changes" (spec §9.1 position 6).
- Error codes and precedence exactly as spec §7.5: `VALIDATION_ERROR`, `APP_NOT_FOUND`, `FEATURE_NOT_FOUND`, `UNKNOWN_FRAMEWORK`, `FEATURE_ARCHIVED`, `STALE_STATE`, `FEATURE_BLOCKED`, `PHASE_ORDER_VIOLATION`, `EMBEDDING_MODEL_MISMATCH`.
- Eight tools, named exactly: `route_task`, `start_feature`, `get_context`, `advance_phase`, `search_memory`, `propose_memory`, `get_feature_status`, `list_features` (spec §7.1). No admin tool over MCP.
- Abstract phases, in order: `specify`, `plan`, `tasks`, `implement`, `verify`, `integrate`, `learn`; terminal state `archived` (spec §10.1).
- Gate check names, exactly: `missing_artifact`, `placeholder_scan`, `required_sections`, `measurable_criteria`, `task_done_checks`, `task_ordering`, `delta_markers`, `verify_evidence`, `scope_drift`, `human_approved` (spec §10.2). `GATE_LIBRARY_VERSION` starts at `"1"`.
- Environment variables exactly as spec §11.1: `SDD_DATABASE_URL`, `SDD_EMBEDDING_PROVIDER`, `SDD_EMBEDDING_MODEL`, `VOYAGE_API_KEY`, `OLLAMA_URL`, `SDD_LISTEN`, `SDD_ALLOWED_HOSTS`, `SDD_TOKEN_BUDGET`.
- The server never reads or writes a repository. Tool results never contain secrets.
- Commit after every task with a conventional-commit message. Never commit `.env`.

## Decisions this plan makes where the spec leaves room

These are implementation choices, not spec changes. If a later spec revision contradicts one, the spec wins.

- **Ids** are text: `a_` (apps), `f_` (features), `k_` (knowledge items), `c_` (chunks), `cp_` (context packs), `t_` (transitions), `fa_` (artifacts), `p_` (proposals), `fw_` (frameworks), `pol_` (policies), each followed by a lowercase ULID.
- **Naming a track in a policy or preference:** `framework_preference` and `policy.framework` accept `name` or `name:track` (for example `bmad:quick`). This is how "the preference or policy names one" (spec §8.2) is expressed.
- **Gate transition keys** are `from->to`, for example `specify->implement`, `learn->archived`.
- **Phase template lookup:** a track's `template` names a `stable_id` that must exist in the same pack; the assembler loads that item at the pinned `pack_version`.
- **Over-budget behaviour** (spec §9.3): when positions 1, 2, 3 and 6 alone exceed the budget, all six positions are rendered untrimmed, `over_budget` is true, and a warning is added.
- **Evidence absent on the move out of `verify`** is reported as a `verify_evidence` blocker finding (gate failure), not a `VALIDATION_ERROR`, because the spec says a missing required field is a blocker.
- **Test database:** integration and contract tests need `SDD_TEST_DATABASE_URL`; `docker-compose.test.yml` provides it on port 55432.
- **Provenance wrapper** for retrieved chunks is `<retrieved id=".." version=".." path=".." match="..">` … `</retrieved>`.

## File structure

```
package.json  tsconfig.json  vitest.config.ts  .env.example  .gitignore
docker-compose.yml  docker-compose.test.yml  Dockerfile
migrations/1757462400000_init.js         schema (single migration for v1)
src/
  index.ts                               entry: `sdd-orchestrator` (HTTP) and `--stdio`
  config.ts                              env parsing (zod)
  errors.ts                              DomainError, ErrorCode, precedence
  ids.ts                                 newId(prefix)
  tokens.ts                              countTokens (cl100k_base)
  logging.ts                             pino logger
  metrics.ts                             prom-client registry and counters
  domain/types.ts                        shared types and constants
  domain/phases.ts                       phase helpers
  router/intent.ts                       inferIntent + default phrase lists
  router/signals.ts                      size, greenfield, risk paths, policy path rules
  router/router.ts                       route() rules 1..12, track selection, lite decision
  gates/types.ts                         Finding, CheckInput, CheckDefinition
  gates/markdown.ts                      section parser, fence-aware line iterator
  gates/checks/<check>.ts                one file per check
  gates/library.ts                       GATE_LIBRARY, GATE_LIBRARY_VERSION
  gates/run.ts                           runGate()
  lifecycle/track.ts                     TrackDecl zod schema, phaseOrder, gateFor
  lifecycle/reachability.ts              allowedTargets, classifyMove, mandatesApproval
  lifecycle/cycles.ts                    applyBackwardMove (failed_cycles, blocked)
  lifecycle/instructions.ts              renderPhaseInstructions, renderNextGate
  lifecycle/slug.ts                      slugify
  db/pool.ts                             createPool, Queryable, withTransaction
  db/migrate.ts                          runMigrations()
  store/apps.ts store/policies.ts store/frameworks.ts store/embeddingConfig.ts
  store/knowledge.ts store/chunks.ts store/features.ts store/packs.ts
  store/transitions.ts store/proposals.ts store/retrieval.ts
  embedding/provider.ts                  EmbeddingProvider interface, ACCEPTED_MODELS
  embedding/fake.ts embedding/voyage.ts embedding/ollama.ts embedding/index.ts
  assembler/exactIds.ts                  extractExactIds
  assembler/budget.ts                    trimToBudget
  assembler/render.ts                    renderPack, renderChunk
  assembler/stopConditions.ts            DEFAULT_STOP_CONDITIONS
  assembler/assemble.ts                  assembleContextPack
  assembler/lite.ts                      buildLitePack
  services/startFeature.ts services/advancePhase.ts services/featureStatus.ts
  services/listFeatures.ts services/proposeMemory.ts services/searchMemory.ts
  services/routeTask.ts services/getContext.ts
  mcp/encode.ts                          okResult, errorResult, guarded
  mcp/schemas.ts                         zod shapes shared by tools
  mcp/server.ts                          createMcpServer(deps)
  mcp/tools/<tool>.ts                    one file per tool
  mcp/resources.ts mcp/prompts.ts
  mcp/http.ts                            express app, /mcp, /healthz, /metrics
  mcp/stdio.ts
  ingest/schema.ts                       pack.yaml and front-matter zod schemas
  ingest/load.ts                         loadPack(dir)
  ingest/validate.ts                     validatePack()
  ingest/chunk.ts                        chunkMarkdown()
  ingest/ingest.ts                       ingestPack()
  ingest/reindex.ts                      reindexAll()
  cli/index.ts  cli/commands/*.ts        sdd-admin
packs/company packs/quality-layer packs/stack-guides/<stack>
packs/openspec packs/spec-kit packs/bmad packs/kiro packs/sdlc
docs/verification/host-integration.md feature-matrix.md workspace-facts.sh
docs/verification/walkthrough-openspec.md walkthrough-spec-kit.md
test/unit/**  test/integration/**  test/contract/**  test/fixtures/**
test/helpers/db.ts                       test database setup and truncate
```

Test layout mirrors `src/`: `src/router/router.ts` is tested by `test/unit/router/router.test.ts`.

---

## Part A: Foundation

### Task 1: Project scaffold and test runner

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore` (modify existing), `src/ids.ts`
- Test: `test/unit/ids.test.ts`

**Interfaces:**
- Produces: `newId(prefix: string): string` returning `${prefix}_${lowercase ULID}`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "sdd-orchestrator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": {
    "sdd-orchestrator": "dist/index.js",
    "sdd-admin": "dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx src/index.ts",
    "dev:stdio": "tsx src/index.ts --stdio",
    "admin": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:contract": "vitest run test/contract",
    "db:test:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "db:test:down": "docker compose -f docker-compose.test.yml down -v"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "commander": "^14.0.0",
    "express": "^5.1.0",
    "gray-matter": "^4.0.3",
    "js-tiktoken": "^1.0.20",
    "node-pg-migrate": "^8.0.0",
    "pg": "^8.16.0",
    "pgvector": "^0.2.1",
    "picomatch": "^4.0.2",
    "pino": "^9.7.0",
    "prom-client": "^15.1.3",
    "ulid": "^3.0.0",
    "yaml": "^2.8.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.15.0",
    "@types/pg": "^8.15.0",
    "@types/picomatch": "^4.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json and vitest.config.ts**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
```

`fileParallelism: false` because integration tests share one database and truncate it between tests.

- [ ] **Step 3: Create .env.example and update .gitignore**

`.env.example`:

```
SDD_DATABASE_URL=postgres://sdd:sdd@localhost:5432/sdd
SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test
SDD_EMBEDDING_PROVIDER=voyage
SDD_EMBEDDING_MODEL=voyage-3.5
VOYAGE_API_KEY=
OLLAMA_URL=http://localhost:11434
SDD_LISTEN=127.0.0.1:8080
SDD_ALLOWED_HOSTS=localhost,127.0.0.1
SDD_TOKEN_BUDGET=6000
```

Append to `.gitignore`:

```
node_modules/
dist/
.env
coverage/
```

- [ ] **Step 4: Write the failing test for newId**

`test/unit/ids.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newId } from '../../src/ids.js';

describe('newId', () => {
  it('prefixes a lowercase ulid', () => {
    const id = newId('f');
    expect(id).toMatch(/^f_[0-9a-hjkmnp-tv-z]{26}$/);
  });

  it('is unique across calls', () => {
    const a = newId('k');
    const b = newId('k');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 5: Install and run the test to verify it fails**

Run: `npm install && npx vitest run test/unit/ids.test.ts`
Expected: FAIL with "Cannot find module '../../src/ids.js'"

- [ ] **Step 6: Implement src/ids.ts**

```ts
import { ulid } from 'ulid';

export function newId(prefix: string): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}
```

- [ ] **Step 7: Run the test and typecheck**

Run: `npx vitest run test/unit/ids.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore src/ids.ts test/unit/ids.test.ts
git commit -m "chore: scaffold TypeScript project with vitest"
```

### Task 2: Domain types and phase helpers

**Files:**
- Create: `src/domain/types.ts`, `src/domain/phases.ts`
- Test: `test/unit/domain/phases.test.ts`

**Interfaces:**
- Produces every shared type used by later tasks. Later tasks import from `src/domain/types.ts` by these exact names: `PHASES`, `Phase`, `INTENTS`, `Intent`, `Confidence`, `Size`, `Workspace`, `Policy`, `PhaseMapping`, `GateCheckDecl`, `GateDecl`, `TrackDecl`, `Decision`, `Finding`, `Severity`, `Scope`, `VerifyEvidence`, `AttachedLayer`, `FeatureStatus`, `KnowledgeKind`, `MemoryType`, `Tier`.
- Produces `phaseIndex(phase): number` and `isPhase(x): x is Phase`.

- [ ] **Step 1: Write the failing test**

`test/unit/domain/phases.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PHASES } from '../../../src/domain/types.js';
import { phaseIndex, isPhase } from '../../../src/domain/phases.js';

describe('phases', () => {
  it('lists the seven abstract phases in order', () => {
    expect(PHASES).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
  });
  it('indexes phases', () => {
    expect(phaseIndex('specify')).toBe(0);
    expect(phaseIndex('learn')).toBe(6);
  });
  it('recognises phase names', () => {
    expect(isPhase('verify')).toBe(true);
    expect(isPhase('archived')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/domain`
Expected: FAIL, module not found.

- [ ] **Step 3: Create src/domain/types.ts**

```ts
export const PHASES = ['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn'] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseOrArchived = Phase | 'archived';

export const INTENTS = ['feature', 'product', 'spike', 'trivial', 'incident', 'remediation', 'refactor'] as const;
export type Intent = (typeof INTENTS)[number];

export type Confidence = 'high' | 'medium';
export type Size = 'small' | 'medium' | 'large' | 'unknown';
export type Severity = 'blocker' | 'warning';
export type FeatureStatus = 'active' | 'blocked' | 'archived';
export type KnowledgeKind = 'framework_pack' | 'standard' | 'stack_guide' | 'app_memory';
export type MemoryType = 'adr' | 'decision' | 'constraint' | 'incident';
export type Tier = 'always_on' | 'retrieved';
export type Scope = 'app' | 'company' | string[];

export interface Workspace {
  stack?: string[] | null;
  intent?: Intent | 'auto' | null;
  is_greenfield?: boolean | null;
  has_spec_library?: boolean | null;
  estimated_files?: number | null;
  paths_touched?: string[] | null;
  repositories?: number | null;
  new_subsystem?: boolean | null;
  host?: string | null;
}

export interface PathRule { glob: string; framework: string }
export interface Policy {
  framework: string | null;
  path_rules: PathRule[];
  risk_paths: string[];
}

export interface PhaseMapping {
  alias?: string;
  command?: string;
  template?: string;
}
export type PhaseEntry = PhaseMapping | 'skipped';

export interface GateCheckDecl {
  name: string;
  params?: Record<string, unknown>;
  severity?: Severity;
}
export interface GateDecl {
  transition: string;
  artifacts: string[];
  checks: GateCheckDecl[];
}
export interface TrackDecl {
  spec_review?: 'required' | 'deferred';
  phases: Record<Phase, PhaseEntry>;
  gates: GateDecl[];
}

export interface Decision {
  intent: Intent;
  framework: string;
  track: string | null;
  confidence: Confidence;
  rule: string;
  reasons: string[];
  high_risk: boolean;
  policy_version: number | null;
  framework_pack_version: string | null;
}

export interface Finding {
  check: string;
  severity: Severity;
  location: string | null;
  message: string;
}

export interface VerifyEvidence {
  tests: { command: string; passed: number; failed: number };
  lint: 'pass' | 'fail';
  security: { status: 'pass' | 'fail' | 'skipped'; new_high: number; skipped_reason?: string | null };
  files_changed?: string[];
  implements?: string[];
  existing_tests_modified?: number;
  characterization_tests?: string[];
}

export interface AttachedLayer {
  pack_name: string;
  pack_version: string;
  kind: KnowledgeKind;
}
```

- [ ] **Step 4: Create src/domain/phases.ts**

```ts
import { PHASES, type Phase } from './types.js';

export function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/unit/domain && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain test/unit/domain
git commit -m "feat(domain): shared types and phase helpers"
```

### Task 3: Domain errors with precedence

**Files:**
- Create: `src/errors.ts`
- Test: `test/unit/errors.test.ts`

**Interfaces:**
- Produces `ErrorCode` union, `class DomainError extends Error { code; details }`, `ERROR_PRECEDENCE: ErrorCode[]`, `firstByPrecedence(errors: DomainError[]): DomainError`.

- [ ] **Step 1: Write the failing test**

`test/unit/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DomainError, ERROR_PRECEDENCE, firstByPrecedence } from '../../src/errors.js';

describe('DomainError', () => {
  it('carries code, message and details', () => {
    const e = new DomainError('APP_NOT_FOUND', 'no app "x"', { app: 'x' });
    expect(e.code).toBe('APP_NOT_FOUND');
    expect(e.message).toBe('no app "x"');
    expect(e.details).toEqual({ app: 'x' });
    expect(e.toJSON()).toEqual({ code: 'APP_NOT_FOUND', message: 'no app "x"', details: { app: 'x' } });
  });

  it('orders codes as in spec 7.5', () => {
    expect(ERROR_PRECEDENCE).toEqual([
      'VALIDATION_ERROR', 'APP_NOT_FOUND', 'FEATURE_NOT_FOUND', 'UNKNOWN_FRAMEWORK',
      'FEATURE_ARCHIVED', 'STALE_STATE', 'FEATURE_BLOCKED', 'PHASE_ORDER_VIOLATION',
      'EMBEDDING_MODEL_MISMATCH',
    ]);
  });

  it('picks the first applicable error', () => {
    const stale = new DomainError('STALE_STATE', 'stale');
    const archived = new DomainError('FEATURE_ARCHIVED', 'archived');
    expect(firstByPrecedence([stale, archived])).toBe(archived);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/errors.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/errors.ts**

```ts
export const ERROR_PRECEDENCE = [
  'VALIDATION_ERROR',
  'APP_NOT_FOUND',
  'FEATURE_NOT_FOUND',
  'UNKNOWN_FRAMEWORK',
  'FEATURE_ARCHIVED',
  'STALE_STATE',
  'FEATURE_BLOCKED',
  'PHASE_ORDER_VIOLATION',
  'EMBEDDING_MODEL_MISMATCH',
] as const;
export type ErrorCode = (typeof ERROR_PRECEDENCE)[number];

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function firstByPrecedence(errors: DomainError[]): DomainError {
  if (errors.length === 0) throw new Error('firstByPrecedence called with no errors');
  return [...errors].sort(
    (a, b) => ERROR_PRECEDENCE.indexOf(a.code) - ERROR_PRECEDENCE.indexOf(b.code),
  )[0]!;
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts test/unit/errors.test.ts
git commit -m "feat: domain error type with spec precedence"
```

### Task 4: Token counter

**Files:**
- Create: `src/tokens.ts`
- Test: `test/unit/tokens.test.ts`

**Interfaces:**
- Produces `countTokens(text: string): number` and `TOKENIZER = 'cl100k_base'`.

- [ ] **Step 1: Write the failing test**

`test/unit/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { countTokens, TOKENIZER } from '../../src/tokens.js';

describe('countTokens', () => {
  it('names the tokenizer', () => {
    expect(TOKENIZER).toBe('cl100k_base');
  });
  it('counts zero for empty text', () => {
    expect(countTokens('')).toBe(0);
  });
  it('counts a short sentence in the expected range', () => {
    const n = countTokens('The quick brown fox jumps over the lazy dog.');
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/tokens.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/tokens.ts**

```ts
import { getEncoding } from 'js-tiktoken';

export const TOKENIZER = 'cl100k_base' as const;
const encoding = getEncoding(TOKENIZER);

export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return encoding.encode(text).length;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tokens.ts test/unit/tokens.test.ts
git commit -m "feat: cl100k_base token counter"
```

### Task 5: Configuration from environment

**Files:**
- Create: `src/config.ts`
- Test: `test/unit/config.test.ts`

**Interfaces:**
- Produces `loadConfig(env: NodeJS.ProcessEnv): Config` and the `Config` type: `{ databaseUrl, embedding: { provider: 'voyage'|'ollama'|'fake', model, voyageApiKey?, ollamaUrl }, listen: { host, port }, allowedHosts: string[], tokenBudget: number }`.
- Produces `ACCEPTED_MODELS: Record<'voyage'|'ollama'|'fake', string[]>`.

- [ ] **Step 1: Write the failing test**

`test/unit/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig, ACCEPTED_MODELS } from '../../src/config.js';

const base = { SDD_DATABASE_URL: 'postgres://u:p@h/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ ...base, VOYAGE_API_KEY: 'k' });
    expect(c.embedding.provider).toBe('voyage');
    expect(c.embedding.model).toBe('voyage-3.5');
    expect(c.listen).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(c.allowedHosts).toEqual(['localhost', '127.0.0.1']);
    expect(c.tokenBudget).toBe(6000);
  });

  it('refuses an unknown model for the provider', () => {
    expect(() => loadConfig({ ...base, SDD_EMBEDDING_PROVIDER: 'ollama', SDD_EMBEDDING_MODEL: 'voyage-3' }))
      .toThrow(/model "voyage-3" is not accepted for provider "ollama"/);
  });

  it('requires VOYAGE_API_KEY for voyage', () => {
    expect(() => loadConfig({ ...base })).toThrow(/VOYAGE_API_KEY/);
  });

  it('parses listen and allowed hosts', () => {
    const c = loadConfig({ ...base, SDD_EMBEDDING_PROVIDER: 'fake', SDD_LISTEN: '0.0.0.0:9000', SDD_ALLOWED_HOSTS: 'sdd.internal, localhost' });
    expect(c.listen).toEqual({ host: '0.0.0.0', port: 9000 });
    expect(c.allowedHosts).toEqual(['sdd.internal', 'localhost']);
  });

  it('lists accepted models', () => {
    expect(ACCEPTED_MODELS.voyage).toEqual(['voyage-3', 'voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3']);
    expect(ACCEPTED_MODELS.ollama).toEqual(['mxbai-embed-large', 'bge-m3']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/config.ts**

```ts
import { z } from 'zod';

export const ACCEPTED_MODELS = {
  voyage: ['voyage-3', 'voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3'],
  ollama: ['mxbai-embed-large', 'bge-m3'],
  fake: ['fake-1024'],
} as const satisfies Record<string, readonly string[]>;

export type EmbeddingProviderName = keyof typeof ACCEPTED_MODELS;

export interface Config {
  databaseUrl: string;
  embedding: {
    provider: EmbeddingProviderName;
    model: string;
    voyageApiKey?: string;
    ollamaUrl: string;
  };
  listen: { host: string; port: number };
  allowedHosts: string[];
  tokenBudget: number;
}

const EnvSchema = z.object({
  SDD_DATABASE_URL: z.string().min(1, 'SDD_DATABASE_URL is required'),
  SDD_EMBEDDING_PROVIDER: z.enum(['voyage', 'ollama', 'fake']).default('voyage'),
  SDD_EMBEDDING_MODEL: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  SDD_LISTEN: z.string().default('127.0.0.1:8080'),
  SDD_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
  SDD_TOKEN_BUDGET: z.coerce.number().int().positive().default(6000),
});

const DEFAULT_MODEL: Record<EmbeddingProviderName, string> = {
  voyage: 'voyage-3.5',
  ollama: 'mxbai-embed-large',
  fake: 'fake-1024',
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const e = EnvSchema.parse(env);
  const provider = e.SDD_EMBEDDING_PROVIDER;
  const model = e.SDD_EMBEDDING_MODEL ?? DEFAULT_MODEL[provider];
  if (!(ACCEPTED_MODELS[provider] as readonly string[]).includes(model)) {
    throw new Error(`model "${model}" is not accepted for provider "${provider}"; accepted: ${ACCEPTED_MODELS[provider].join(', ')}`);
  }
  if (provider === 'voyage' && !e.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is required when SDD_EMBEDDING_PROVIDER=voyage');
  }
  const [host, portText] = e.SDD_LISTEN.split(':');
  const port = Number(portText);
  if (!host || !Number.isInteger(port)) throw new Error(`SDD_LISTEN must be host:port, got "${e.SDD_LISTEN}"`);
  return {
    databaseUrl: e.SDD_DATABASE_URL,
    embedding: { provider, model, voyageApiKey: e.VOYAGE_API_KEY, ollamaUrl: e.OLLAMA_URL },
    listen: { host, port },
    allowedHosts: e.SDD_ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
    tokenBudget: e.SDD_TOKEN_BUDGET,
  };
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run test/unit/config.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/unit/config.test.ts
git commit -m "feat: environment configuration with accepted embedding models"
```

---

## Part B: Router (pure, no I/O)

### Task 6: Intent inference from task text

**Files:**
- Create: `src/router/intent.ts`
- Test: `test/unit/router/intent.test.ts`

**Interfaces:**
- Produces `DEFAULT_PHRASE_LISTS`, `IntentPhraseLists`, `inferIntent(text: string, lists?: IntentPhraseLists): { intent: Intent; matched: string | null }`.
- `trivial` is never returned by `inferIntent` (spec §8.1).

- [ ] **Step 1: Write the failing test**

`test/unit/router/intent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inferIntent, DEFAULT_PHRASE_LISTS } from '../../../src/router/intent.js';

describe('inferIntent', () => {
  it('defaults to feature', () => {
    expect(inferIntent('Add CSV export to the orders page')).toEqual({ intent: 'feature', matched: null });
  });
  it('detects incident phrases including INC ids', () => {
    expect(inferIntent('Checkout is broken, see INC-204').intent).toBe('incident');
    expect(inferIntent('production is down for EU').intent).toBe('incident');
    expect(inferIntent('P1: payments failing').intent).toBe('incident');
  });
  it('detects remediation', () => {
    expect(inferIntent('Fix CVE-2026-1234 in lodash').intent).toBe('remediation');
    expect(inferIntent('Snyk flagged a vulnerability').intent).toBe('remediation');
  });
  it('detects refactor, spike and product', () => {
    expect(inferIntent('Refactor the export module, no behaviour change').intent).toBe('refactor');
    expect(inferIntent('Can we stream exports? prototype it').intent).toBe('spike');
    expect(inferIntent('Write the PRD for a new product').intent).toBe('product');
  });
  it('applies precedence incident > remediation > refactor > spike > product', () => {
    expect(inferIntent('hotfix: refactor after CVE-1 prototype for new product').intent).toBe('incident');
    expect(inferIntent('refactor after CVE-1, can we prototype').intent).toBe('remediation');
    expect(inferIntent('untangle this, can we prototype the PRD').intent).toBe('refactor');
  });
  it('never infers trivial', () => {
    expect(inferIntent('trivial: bump a version').intent).toBe('feature');
  });
  it('reports the matched phrase', () => {
    expect(inferIntent('is it possible to cache this?').matched).toBe('is it possible');
  });
  it('accepts custom phrase lists', () => {
    const lists = { ...DEFAULT_PHRASE_LISTS, spike: ['explore'] };
    expect(inferIntent('explore caching', lists).intent).toBe('spike');
    expect(inferIntent('can we cache', lists).intent).toBe('feature');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/router/intent.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/router/intent.ts**

```ts
import type { Intent } from '../domain/types.js';

export type InferableIntent = 'incident' | 'remediation' | 'refactor' | 'spike' | 'product';
export type IntentPhraseLists = Record<InferableIntent, string[]>;

// Order matters: the first list with a match wins (spec §8.1).
export const INFERENCE_ORDER: InferableIntent[] = ['incident', 'remediation', 'refactor', 'spike', 'product'];

export const DEFAULT_PHRASE_LISTS: IntentPhraseLists = {
  incident: ['outage', 'production is down', 'hotfix', 'P1', 'INC-\\d+'],
  remediation: ['CVE-\\d+', 'vulnerability', 'Snyk', 'deprecated library'],
  refactor: ['refactor', 'no behaviour change', 'no behavior change', 'extract', 'untangle'],
  spike: ['can we', 'prototype', 'spike', 'is it possible'],
  product: ['whole product', 'new product', 'PRD'],
};

function toRegex(phrase: string): RegExp {
  // Phrases are regex fragments (some contain \d+). Wrap with word boundaries, case-insensitive.
  return new RegExp(`\\b(?:${phrase})\\b`, 'i');
}

export function inferIntent(
  text: string,
  lists: IntentPhraseLists = DEFAULT_PHRASE_LISTS,
): { intent: Intent; matched: string | null } {
  for (const intent of INFERENCE_ORDER) {
    for (const phrase of lists[intent]) {
      if (toRegex(phrase).test(text)) return { intent, matched: phrase };
    }
  }
  return { intent: 'feature', matched: null };
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/router/intent.test.ts`
Expected: PASS. If `is it possible` reports `matched` as the regex source rather than the phrase, the phrase is returned as written in the list, which is what the test expects.

- [ ] **Step 5: Commit**

```bash
git add src/router/intent.ts test/unit/router/intent.test.ts
git commit -m "feat(router): intent inference with ordered phrase lists"
```

### Task 7: Workspace signals: size, greenfield, risk paths, policy path rules

**Files:**
- Create: `src/router/signals.ts`
- Test: `test/unit/router/signals.test.ts`

**Interfaces:**
- Produces `DEFAULT_RISK_PATHS: string[]`, `sizeOf(ws: Workspace): Size`, `greenfieldOf(ws: Workspace): boolean | null`, `matchRiskPaths(paths: string[], extra: string[]): string[]` (returns matched paths), `matchPolicyPathRule(policy: Policy | null, paths: string[]): PathRule | null`, `topLevelDir(path: string): string`.

- [ ] **Step 1: Write the failing test**

`test/unit/router/signals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RISK_PATHS, sizeOf, greenfieldOf, matchRiskPaths, matchPolicyPathRule, topLevelDir,
} from '../../../src/router/signals.js';

describe('sizeOf', () => {
  it('is small for <=3 files in one top-level dir', () => {
    expect(sizeOf({ estimated_files: 3, paths_touched: ['src/a.ts', 'src/b/c.ts'] })).toBe('small');
  });
  it('is small for <=3 files with no paths given', () => {
    expect(sizeOf({ estimated_files: 2 })).toBe('small');
  });
  it('is medium for <=3 files spread over two top-level dirs', () => {
    expect(sizeOf({ estimated_files: 2, paths_touched: ['src/a.ts', 'docs/b.md'] })).toBe('medium');
  });
  it('is large for >=20 files, >=2 repositories or a new subsystem', () => {
    expect(sizeOf({ estimated_files: 20 })).toBe('large');
    expect(sizeOf({ estimated_files: 5, repositories: 2 })).toBe('large');
    expect(sizeOf({ estimated_files: 5, new_subsystem: true })).toBe('large');
    expect(sizeOf({ estimated_files: null, new_subsystem: true })).toBe('large');
  });
  it('is medium otherwise', () => {
    expect(sizeOf({ estimated_files: 8 })).toBe('medium');
  });
  it('is unknown when estimated_files is null and new_subsystem is not true', () => {
    expect(sizeOf({})).toBe('unknown');
    expect(sizeOf({ repositories: 3 })).toBe('unknown');
  });
});

describe('greenfieldOf', () => {
  it('uses is_greenfield first', () => {
    expect(greenfieldOf({ is_greenfield: true, has_spec_library: true })).toBe(true);
  });
  it('falls back to not has_spec_library', () => {
    expect(greenfieldOf({ has_spec_library: true })).toBe(false);
    expect(greenfieldOf({ has_spec_library: false })).toBe(true);
  });
  it('is null when both unknown', () => {
    expect(greenfieldOf({})).toBeNull();
  });
});

describe('matchRiskPaths', () => {
  it('ships the default list', () => {
    expect(DEFAULT_RISK_PATHS).toEqual([
      '**/payments/**', '**/billing/**', '**/auth/**', '**/*crypto*', '**/migrations/**',
      'infra/**', '**/*.tf', '.github/workflows/**',
    ]);
  });
  it('matches defaults and policy extras', () => {
    expect(matchRiskPaths(['src/payments/charge.ts', 'src/orders/x.ts'], [])).toEqual(['src/payments/charge.ts']);
    expect(matchRiskPaths(['lib/crypto.ts'], [])).toEqual(['lib/crypto.ts']);
    expect(matchRiskPaths(['infra/main.tf'], [])).toEqual(['infra/main.tf']);
    expect(matchRiskPaths(['.github/workflows/ci.yml'], [])).toEqual(['.github/workflows/ci.yml']);
    expect(matchRiskPaths(['src/webhooks/stripe.ts'], ['**/webhooks/**'])).toEqual(['src/webhooks/stripe.ts']);
    expect(matchRiskPaths(['src/orders/x.ts'], [])).toEqual([]);
  });
});

describe('matchPolicyPathRule', () => {
  const policy = { framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: [] };
  it('returns the first matching rule', () => {
    expect(matchPolicyPathRule(policy, ['src/payments/x.ts'])).toEqual({ glob: '**/payments/**', framework: 'bmad' });
  });
  it('returns null with no match or no policy', () => {
    expect(matchPolicyPathRule(policy, ['src/orders/x.ts'])).toBeNull();
    expect(matchPolicyPathRule(null, ['src/payments/x.ts'])).toBeNull();
  });
});

describe('topLevelDir', () => {
  it('returns the first segment', () => {
    expect(topLevelDir('src/a/b.ts')).toBe('src');
    expect(topLevelDir('README.md')).toBe('README.md');
    expect(topLevelDir('./src/x')).toBe('src');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/router/signals.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/router/signals.ts**

```ts
import picomatch from 'picomatch';
import type { PathRule, Policy, Size, Workspace } from '../domain/types.js';

export const DEFAULT_RISK_PATHS: string[] = [
  '**/payments/**', '**/billing/**', '**/auth/**', '**/*crypto*', '**/migrations/**',
  'infra/**', '**/*.tf', '.github/workflows/**',
];

const matchOptions = { dot: true };

export function topLevelDir(path: string): string {
  const cleaned = path.replace(/^\.\//, '').replace(/^\/+/, '');
  return cleaned.split('/')[0] ?? cleaned;
}

export function sizeOf(ws: Workspace): Size {
  const files = ws.estimated_files ?? null;
  const newSubsystem = ws.new_subsystem === true;
  if (files === null && !newSubsystem) return 'unknown';
  if ((files !== null && files >= 20) || (ws.repositories ?? 0) >= 2 || newSubsystem) return 'large';
  const paths = ws.paths_touched ?? [];
  const oneDir = paths.length === 0 || new Set(paths.map(topLevelDir)).size === 1;
  if (files !== null && files <= 3 && oneDir) return 'small';
  return 'medium';
}

export function greenfieldOf(ws: Workspace): boolean | null {
  if (typeof ws.is_greenfield === 'boolean') return ws.is_greenfield;
  if (typeof ws.has_spec_library === 'boolean') return !ws.has_spec_library;
  return null;
}

export function matchRiskPaths(paths: string[], extra: string[]): string[] {
  const isRisk = picomatch([...DEFAULT_RISK_PATHS, ...extra], matchOptions);
  return paths.filter((p) => isRisk(p.replace(/^\.\//, '')));
}

export function matchPolicyPathRule(policy: Policy | null, paths: string[]): PathRule | null {
  if (!policy) return null;
  for (const rule of policy.path_rules) {
    const m = picomatch(rule.glob, matchOptions);
    if (paths.some((p) => m(p.replace(/^\.\//, '')))) return rule;
  }
  return null;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/router/signals.test.ts`
Expected: PASS. If `**/*crypto*` fails to match `lib/crypto.ts`, check picomatch's `basename`-less behaviour: `**/*crypto*` must match a file whose basename contains `crypto`; it does with `dot: true`.

- [ ] **Step 5: Commit**

```bash
git add src/router/signals.ts test/unit/router/signals.test.ts
git commit -m "feat(router): size, greenfield, risk path and policy path signals"
```

### Task 8: Router rules 1 to 12 with track selection

**Files:**
- Create: `src/router/router.ts`
- Test: `test/unit/router/router.test.ts`

**Interfaces:**
- Consumes `inferIntent`, `sizeOf`, `greenfieldOf`, `matchRiskPaths`, `matchPolicyPathRule` from Tasks 6 and 7; `DomainError` from Task 3.
- Produces:

```ts
export interface KnownFramework { name: string; pack_version: string; tracks: string[] }
export interface RouterInput {
  task_description: string;
  workspace: Workspace;
  framework_preference?: string | null;
  policy: Policy | null;
  policy_version: number | null;
  app: { compliance: boolean; default_stack: string[] };
  frameworks: KnownFramework[];          // current versions only
  phraseLists?: IntentPhraseLists;
}
export interface RouterOutput {
  decision: Decision;
  clarifying_questions: string[];
  warnings: string[];
  guidance: string | null;               // spike only
  lite: boolean;                         // rule 4 fired
  signals: { size: Size; greenfield: boolean | null; risk_paths: string[]; intent_source: 'host' | 'inferred' };
}
export function route(input: RouterInput): RouterOutput
export function parseFrameworkRef(ref: string): { name: string; track: string | null }
export const SPIKE_GUIDANCE: string
```

- Rule names recorded in `decision.rule`: `1-policy`, `2-preference`, `3-spike`, `4-trivial`, `5-product`, `6-incident`, `7-refactor-small-medium`, `8-refactor-large`, `9-large-compliance-or-subsystem`, `10-brownfield-small-medium`, `11-greenfield-or-large`, `12-unknown`.
- Seed framework names: `openspec`, `spec-kit`, `bmad`, `kiro`, `sdlc`.

- [ ] **Step 1: Write the failing test**

`test/unit/router/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { route, parseFrameworkRef, type RouterInput } from '../../../src/router/router.js';
import { DomainError } from '../../../src/errors.js';

const frameworks = [
  { name: 'openspec', pack_version: '1.0.0', tracks: ['default', 'hotfix', 'refactor'] },
  { name: 'spec-kit', pack_version: '1.0.0', tracks: ['default', 'refactor'] },
  { name: 'bmad', pack_version: '1.0.0', tracks: ['quick', 'full'] },
  { name: 'kiro', pack_version: '1.0.0', tracks: ['default'] },
  { name: 'sdlc', pack_version: '1.0.0', tracks: ['default'] },
];

function input(over: Partial<RouterInput> = {}): RouterInput {
  return {
    task_description: 'Add CSV export to the orders page',
    workspace: { estimated_files: 4, paths_touched: ['src/orders/a.ts'], is_greenfield: false },
    framework_preference: null,
    policy: null,
    policy_version: null,
    app: { compliance: false, default_stack: ['typescript'] },
    frameworks,
    ...over,
  };
}

describe('parseFrameworkRef', () => {
  it('splits name and optional track', () => {
    expect(parseFrameworkRef('bmad')).toEqual({ name: 'bmad', track: null });
    expect(parseFrameworkRef('bmad:quick')).toEqual({ name: 'bmad', track: 'quick' });
  });
});

describe('route: rules in order', () => {
  it('rule 1: policy framework wins with high confidence and track from intent', () => {
    const out = route(input({ policy: { framework: 'openspec', path_rules: [], risk_paths: [] }, policy_version: 3,
      workspace: { intent: 'incident', estimated_files: 2 } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', track: 'hotfix', confidence: 'high', rule: '1-policy', policy_version: 3, framework_pack_version: '1.0.0', high_risk: true });
  });
  it('rule 1: policy path rule matches paths_touched', () => {
    const out = route(input({ policy: { framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: [] },
      workspace: { estimated_files: 4, paths_touched: ['src/payments/x.ts'] } }));
    expect(out.decision).toMatchObject({ framework: 'bmad', track: 'full', rule: '1-policy', high_risk: true });
    expect(out.decision.reasons.join(' ')).toContain('**/payments/**');
  });
  it('rule 1: policy naming a track uses it', () => {
    const out = route(input({ policy: { framework: 'bmad:quick', path_rules: [], risk_paths: [] } }));
    expect(out.decision).toMatchObject({ framework: 'bmad', track: 'quick' });
  });
  it('rule 1 and 2: unknown framework fails with UNKNOWN_FRAMEWORK', () => {
    expect(() => route(input({ policy: { framework: 'aiup', path_rules: [], risk_paths: [] } }))).toThrow(DomainError);
    try { route(input({ framework_preference: 'aiup' })); } catch (e) { expect((e as DomainError).code).toBe('UNKNOWN_FRAMEWORK'); }
  });
  it('rule 2: explicit preference with a warning when later rules differ', () => {
    const out = route(input({ framework_preference: 'spec-kit' }));
    expect(out.decision).toMatchObject({ framework: 'spec-kit', track: 'default', rule: '2-preference', confidence: 'high' });
    expect(out.decision.reasons.some((r) => r.includes('would have chosen openspec'))).toBe(true);
  });
  it('rule 2: BMAD preference defaults to full', () => {
    expect(route(input({ framework_preference: 'bmad' })).decision.track).toBe('full');
  });
  it('rule 3: spike returns none with guidance and no track', () => {
    const out = route(input({ task_description: 'Can we stream exports?' }));
    expect(out.decision).toMatchObject({ intent: 'spike', framework: 'none', track: null, rule: '3-spike', framework_pack_version: null });
    expect(out.guidance).toMatch(/prototype/i);
  });
  it('rule 4: trivial accepted when small, no risk, no compliance', () => {
    const out = route(input({ workspace: { intent: 'trivial', estimated_files: 1, paths_touched: ['src/a.ts'] } }));
    expect(out.decision).toMatchObject({ intent: 'trivial', framework: 'none', rule: '4-trivial' });
    expect(out.lite).toBe(true);
  });
  it('rule 4: trivial downgraded on size', () => {
    const out = route(input({ workspace: { intent: 'trivial', estimated_files: 8, is_greenfield: false } }));
    expect(out.decision.intent).toBe('feature');
    expect(out.decision.rule).toBe('10-brownfield-small-medium');
    expect(out.decision.reasons.some((r) => /trivial.*downgraded.*size/i.test(r))).toBe(true);
    expect(out.lite).toBe(false);
  });
  it('rule 4: trivial downgraded on risk path', () => {
    const out = route(input({ workspace: { intent: 'trivial', estimated_files: 1, paths_touched: ['src/auth/x.ts'], is_greenfield: false } }));
    expect(out.decision.intent).toBe('feature');
    expect(out.decision.high_risk).toBe(true);
    expect(out.decision.reasons.some((r) => /trivial.*downgraded.*risk/i.test(r))).toBe(true);
  });
  it('rule 4: trivial downgraded on compliance', () => {
    const out = route(input({ app: { compliance: true, default_stack: [] }, workspace: { intent: 'trivial', estimated_files: 1, is_greenfield: false } }));
    expect(out.decision.intent).toBe('feature');
    expect(out.decision.reasons.some((r) => /trivial.*downgraded.*compliance/i.test(r))).toBe(true);
  });
  it('rule 4: trivial in text is not honoured', () => {
    const out = route(input({ task_description: 'trivial: rename a variable' }));
    expect(out.decision.intent).toBe('feature');
  });
  it('rule 5: product routes to sdlc', () => {
    expect(route(input({ task_description: 'PRD for a new product' })).decision).toMatchObject({ framework: 'sdlc', track: 'default', rule: '5-product' });
  });
  it('rule 6: incident routes to openspec hotfix at any size and forces high_risk', () => {
    const out = route(input({ task_description: 'production is down', workspace: { estimated_files: 30 } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', track: 'hotfix', rule: '6-incident', high_risk: true });
  });
  it('rule 7 and 8: refactor by size', () => {
    expect(route(input({ task_description: 'refactor exports', workspace: { estimated_files: 5 } })).decision).toMatchObject({ framework: 'openspec', track: 'refactor', rule: '7-refactor-small-medium' });
    expect(route(input({ task_description: 'refactor exports', workspace: { estimated_files: 25 } })).decision).toMatchObject({ framework: 'spec-kit', track: 'refactor', rule: '8-refactor-large' });
  });
  it('rule 9: large with compliance or new subsystem routes to bmad with track by size', () => {
    expect(route(input({ app: { compliance: true, default_stack: [] }, workspace: { estimated_files: 25 } })).decision).toMatchObject({ framework: 'bmad', track: 'full', rule: '9-large-compliance-or-subsystem' });
    expect(route(input({ workspace: { estimated_files: 12, new_subsystem: true } })).decision).toMatchObject({ framework: 'bmad', track: 'quick' });
    expect(route(input({ workspace: { estimated_files: null, new_subsystem: true } })).decision).toMatchObject({ framework: 'bmad', track: 'full' });
  });
  it('rule 10: brownfield small or medium routes to openspec default', () => {
    expect(route(input()).decision).toMatchObject({ framework: 'openspec', track: 'default', rule: '10-brownfield-small-medium', confidence: 'high' });
  });
  it('rule 11: greenfield small/medium or any large routes to spec-kit default', () => {
    expect(route(input({ workspace: { estimated_files: 4, is_greenfield: true } })).decision).toMatchObject({ framework: 'spec-kit', track: 'default', rule: '11-greenfield-or-large' });
    expect(route(input({ workspace: { estimated_files: 40, is_greenfield: false } })).decision).toMatchObject({ framework: 'spec-kit', rule: '11-greenfield-or-large' });
  });
  it('rule 12: unknown greenfield yields medium confidence with questions', () => {
    const out = route(input({ workspace: { estimated_files: 4 } }));
    expect(out.decision).toMatchObject({ framework: 'spec-kit', confidence: 'medium', rule: '12-unknown' });
    expect(out.clarifying_questions.length).toBeGreaterThan(0);
    expect(out.clarifying_questions.length).toBeLessThanOrEqual(3);
  });
  it('rule 12: unknown size with spec library prefers openspec', () => {
    const out = route(input({ workspace: { has_spec_library: true } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', confidence: 'medium', rule: '12-unknown' });
  });
  it('remediation routes by size like a feature and keeps the intent', () => {
    const out = route(input({ task_description: 'Fix CVE-2026-1 in lodash' }));
    expect(out.decision).toMatchObject({ intent: 'remediation', framework: 'openspec', rule: '10-brownfield-small-medium' });
  });
  it('kiro is only reachable by rules 1 and 2', () => {
    const out = route(input({ framework_preference: 'kiro' }));
    expect(out.decision).toMatchObject({ framework: 'kiro', track: 'default' });
  });
  it('a deprecated framework (absent from the current list) fails on preference', () => {
    expect(() => route(input({ framework_preference: 'kiro', frameworks: frameworks.filter((f) => f.name !== 'kiro') }))).toThrow(/UNKNOWN_FRAMEWORK|no current version/);
  });
  it('names asserted facts in reasons', () => {
    const out = route(input());
    expect(out.decision.reasons.some((r) => r.includes('asserted by host'))).toBe(true);
  });
  it('sets high_risk from risk paths without changing the framework', () => {
    const out = route(input({ workspace: { estimated_files: 4, paths_touched: ['src/billing/x.ts'], is_greenfield: false } }));
    expect(out.decision).toMatchObject({ framework: 'openspec', high_risk: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/router/router.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/router/router.ts**

```ts
import type { Decision, Intent, Policy, Size, Workspace } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { inferIntent, type IntentPhraseLists } from './intent.js';
import { greenfieldOf, matchPolicyPathRule, matchRiskPaths, sizeOf } from './signals.js';

export interface KnownFramework { name: string; pack_version: string; tracks: string[] }
export interface RouterInput {
  task_description: string;
  workspace: Workspace;
  framework_preference?: string | null;
  policy: Policy | null;
  policy_version: number | null;
  app: { compliance: boolean; default_stack: string[] };
  frameworks: KnownFramework[];
  phraseLists?: IntentPhraseLists;
}
export interface RouterSignals {
  size: Size;
  greenfield: boolean | null;
  risk_paths: string[];
  intent_source: 'host' | 'inferred';
}
export interface RouterOutput {
  decision: Decision;
  clarifying_questions: string[];
  warnings: string[];
  guidance: string | null;
  lite: boolean;
  signals: RouterSignals;
}

export const SPIKE_GUIDANCE =
  'Prototype first. Time-box the spike, keep the code disposable, write down what you learned and what you would build next. ' +
  'When the question is answered, route the follow-up as a feature; no lifecycle state is kept for a spike.';

export function parseFrameworkRef(ref: string): { name: string; track: string | null } {
  const [name, track] = ref.split(':', 2);
  return { name: name!, track: track ?? null };
}

interface Ctx {
  intent: Intent;
  size: Size;
  greenfield: boolean | null;
  risk: string[];
  compliance: boolean;
  ws: Workspace;
  frameworks: Map<string, KnownFramework>;
  reasons: string[];
}

function requireFramework(ctx: Ctx, name: string, source: string): KnownFramework {
  const fw = ctx.frameworks.get(name);
  if (!fw) {
    throw new DomainError('UNKNOWN_FRAMEWORK', `${source} names framework "${name}" which has no current version`, {
      framework: name, known: [...ctx.frameworks.keys()],
    });
  }
  return fw;
}

function trackForIntent(fw: KnownFramework, ctx: Ctx, named: string | null): string | null {
  if (fw.tracks.length === 0) return null;
  if (named) {
    if (!fw.tracks.includes(named)) {
      throw new DomainError('UNKNOWN_FRAMEWORK', `framework "${fw.name}" has no track "${named}"`, { framework: fw.name, tracks: fw.tracks });
    }
    return named;
  }
  if (fw.name === 'openspec') {
    if (ctx.intent === 'incident' && fw.tracks.includes('hotfix')) return 'hotfix';
    if (ctx.intent === 'refactor' && fw.tracks.includes('refactor')) return 'refactor';
  }
  if (fw.name === 'spec-kit' && ctx.intent === 'refactor' && fw.tracks.includes('refactor')) return 'refactor';
  if (fw.name === 'bmad') return fw.tracks.includes('full') ? 'full' : fw.tracks[0]!;
  return fw.tracks.includes('default') ? 'default' : fw.tracks[0]!;
}

interface RulePick { framework: string; track: string | null; rule: string; confidence: 'high' | 'medium'; questions: string[]; guidance: string | null; lite: boolean }

function rulesThreeToTwelve(ctx: Ctx): RulePick {
  const none = (rule: string, guidance: string | null, lite: boolean): RulePick => ({ framework: 'none', track: null, rule, confidence: 'high', questions: [], guidance, lite });
  const pick = (name: string, rule: string, track?: string): RulePick => {
    const fw = requireFramework(ctx, name, `rule ${rule}`);
    return { framework: name, track: track ?? trackForIntent(fw, ctx, null), rule, confidence: 'high', questions: [], guidance: null, lite: false };
  };

  if (ctx.intent === 'spike') return none('3-spike', SPIKE_GUIDANCE, false);

  if (ctx.intent === 'trivial') {
    const causes: string[] = [];
    if (ctx.size !== 'small') causes.push(`size is ${ctx.size}`);
    if (ctx.risk.length > 0) causes.push(`risk path matched (${ctx.risk.join(', ')})`);
    if (ctx.compliance) causes.push('app is under compliance');
    if (causes.length === 0) return none('4-trivial', null, true);
    ctx.reasons.push(`intent trivial downgraded to feature: ${causes.join('; ')}`);
    ctx.intent = 'feature';
  }

  if (ctx.intent === 'product') return pick('sdlc', '5-product');
  if (ctx.intent === 'incident') return pick('openspec', '6-incident', 'hotfix');
  if (ctx.intent === 'refactor' && (ctx.size === 'small' || ctx.size === 'medium')) return pick('openspec', '7-refactor-small-medium', 'refactor');
  if (ctx.intent === 'refactor' && ctx.size === 'large') return pick('spec-kit', '8-refactor-large', 'refactor');
  if (ctx.size === 'large' && (ctx.compliance || ctx.ws.new_subsystem === true)) {
    const files = ctx.ws.estimated_files ?? null;
    const quick = files !== null && files <= 15 && !ctx.compliance;
    return pick('bmad', '9-large-compliance-or-subsystem', quick ? 'quick' : 'full');
  }
  if (ctx.greenfield === false && (ctx.size === 'small' || ctx.size === 'medium')) return pick('openspec', '10-brownfield-small-medium', 'default');
  if ((ctx.greenfield === true && (ctx.size === 'small' || ctx.size === 'medium')) || ctx.size === 'large') return pick('spec-kit', '11-greenfield-or-large', 'default');

  const questions: string[] = [];
  if (ctx.greenfield === null) questions.push('Is this a greenfield repository (fewer than 20 commits) or does it already have a spec library?');
  if (ctx.size === 'unknown') questions.push('Roughly how many files will this change touch?');
  if (ctx.size === 'unknown' && ctx.ws.new_subsystem == null) questions.push('Does this introduce a new subsystem or a second repository?');
  const candidate = ctx.ws.has_spec_library === true ? 'openspec' : 'spec-kit';
  const fw = requireFramework(ctx, candidate, 'rule 12');
  return { framework: candidate, track: trackForIntent(fw, ctx, null), rule: '12-unknown', confidence: 'medium', questions: questions.slice(0, 3), guidance: null, lite: false };
}

export function route(input: RouterInput): RouterOutput {
  const ws = input.workspace;
  const reasons: string[] = [];
  const warnings: string[] = [];

  let intent: Intent;
  let intentSource: 'host' | 'inferred';
  if (ws.intent && ws.intent !== 'auto') {
    intent = ws.intent;
    intentSource = 'host';
    reasons.push(`intent ${intent} (asserted by host)`);
  } else {
    const inferred = inferIntent(input.task_description, input.phraseLists);
    intent = inferred.intent;
    intentSource = 'inferred';
    reasons.push(inferred.matched ? `intent ${intent} (matched "${inferred.matched}")` : 'intent feature (no phrase matched)');
  }

  const size = sizeOf(ws);
  const greenfield = greenfieldOf(ws);
  const risk = matchRiskPaths(ws.paths_touched ?? [], input.policy?.risk_paths ?? []);
  reasons.push(`size ${size}${ws.estimated_files != null ? ` (${ws.estimated_files} files, estimate asserted by host)` : ''}`);
  if (greenfield !== null) reasons.push(`${greenfield ? 'greenfield' : 'brownfield'} (asserted by host)`);
  if (risk.length > 0) reasons.push(`risk paths: ${risk.join(', ')}`);
  if (input.app.compliance) reasons.push('app under compliance');

  const ctx: Ctx = {
    intent, size, greenfield, risk, compliance: input.app.compliance, ws,
    frameworks: new Map(input.frameworks.map((f) => [f.name, f])), reasons,
  };

  let partial: RulePick | null = null;

  // Rule 1: policy
  if (input.policy) {
    const pathRule = matchPolicyPathRule(input.policy, ws.paths_touched ?? []);
    const ref = input.policy.framework ?? pathRule?.framework ?? null;
    if (ref) {
      const { name, track } = parseFrameworkRef(ref);
      const fw = requireFramework(ctx, name, 'policy');
      if (ctx.intent === 'trivial') { ctx.intent = 'feature'; reasons.push('intent trivial downgraded to feature: policy names a framework'); }
      reasons.push(pathRule && !input.policy.framework ? `policy path rule ${pathRule.glob} -> ${name}` : `policy names ${name}`);
      partial = { framework: name, track: trackForIntent(fw, ctx, track), rule: '1-policy', confidence: 'high', questions: [], guidance: null, lite: false };
    }
  }

  // Rule 2: explicit preference
  if (!partial && input.framework_preference) {
    const { name, track } = parseFrameworkRef(input.framework_preference);
    const fw = requireFramework(ctx, name, 'framework_preference');
    if (ctx.intent === 'trivial') { ctx.intent = 'feature'; reasons.push('intent trivial downgraded to feature: explicit preference'); }
    let wouldHave: RulePick | null = null;
    try { wouldHave = rulesThreeToTwelve({ ...ctx, reasons: [] }); } catch { wouldHave = null; }
    if (wouldHave && wouldHave.framework !== name) {
      reasons.push(`preference ${name} honoured; rule ${wouldHave.rule} would have chosen ${wouldHave.framework}`);
    } else {
      reasons.push(`preference ${name} honoured`);
    }
    partial = { framework: name, track: trackForIntent(fw, ctx, track), rule: '2-preference', confidence: 'high', questions: [], guidance: null, lite: false };
  }

  if (!partial) partial = rulesThreeToTwelve(ctx);

  const highRisk = risk.length > 0 || ctx.intent === 'incident';
  const fw = partial.framework === 'none' ? null : ctx.frameworks.get(partial.framework) ?? null;

  const decision: Decision = {
    intent: ctx.intent,
    framework: partial.framework,
    track: partial.track,
    confidence: partial.confidence,
    rule: partial.rule,
    reasons: ctx.reasons,
    high_risk: highRisk,
    policy_version: input.policy_version,
    framework_pack_version: fw?.pack_version ?? null,
  };

  return {
    decision,
    clarifying_questions: partial.questions,
    warnings,
    guidance: partial.guidance,
    lite: partial.lite,
    signals: { size, greenfield, risk_paths: risk, intent_source: intentSource },
  };
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run test/unit/router && npm run typecheck`
Expected: PASS. If the "would have chosen" test fails, check that `rulesThreeToTwelve` is invoked with a copy of `ctx` so its trivial-downgrade side effects do not leak.

- [ ] **Step 5: Commit**

```bash
git add src/router/router.ts test/unit/router/router.test.ts
git commit -m "feat(router): rules 1-12, track selection, trivial downgrade, clarifying questions"
```

---

## Part C: Gate check library (pure)

Common conventions (spec §10.2): markers and patterns are regular expressions, case-sensitive unless stated; headings match at any level, case-insensitively; a section is non-empty when it contains at least one non-blank, non-heading line before the next heading of the same or higher level; a task block is the lines from one `task_regex` match to the next.

### Task 9: Gate types and Markdown section parser

**Files:**
- Create: `src/gates/types.ts`, `src/gates/markdown.ts`
- Test: `test/unit/gates/markdown.test.ts`

**Interfaces:**
- Produces in `src/gates/types.ts`:

```ts
export interface CheckInput {
  artifacts: Record<string, string>;
  declaredArtifacts: string[];
  evidence: VerifyEvidence | Record<string, unknown> | null;   // raw, validated by verify_evidence itself
  human_approved: boolean;
  params: Record<string, unknown>;
  severity: Severity;             // default severity for this check's findings
}
export type CheckFn = (input: CheckInput) => Finding[];
export interface CheckDefinition { name: string; defaultSeverity: Severity; params: z.ZodTypeAny; run: CheckFn }
```

- Produces in `src/gates/markdown.ts`: `Line { n: number; text: string; inFence: boolean }`, `lines(md): Line[]`, `Section { heading: string; level: number; startLine: number; endLine: number; body: Line[] }`, `parseSections(md): Section[]`, `findSection(sections, name): Section | undefined`, `isNonEmpty(section): boolean`, `normalizeHeading(text): string`.

- [ ] **Step 1: Write the failing test**

`test/unit/gates/markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lines, parseSections, findSection, isNonEmpty, normalizeHeading } from '../../../src/gates/markdown.js';

const md = `# Title
intro

## Goal
Ship exports.

## Acceptance Criteria

### Sub
- item

## Empty

## Code
\`\`\`md
## not a heading
\`\`\`
`;

describe('lines', () => {
  it('numbers lines from 1 and marks fenced lines', () => {
    const ls = lines(md);
    expect(ls[0]).toEqual({ n: 1, text: '# Title', inFence: false });
    const fenced = ls.find((l) => l.text === '## not a heading');
    expect(fenced?.inFence).toBe(true);
  });
});

describe('parseSections', () => {
  it('finds headings outside fences with levels and line ranges', () => {
    const s = parseSections(md);
    expect(s.map((x) => [x.heading, x.level])).toEqual([
      ['Title', 1], ['Goal', 2], ['Acceptance Criteria', 2], ['Sub', 3], ['Empty', 2], ['Code', 2],
    ]);
    expect(findSection(s, 'goal')?.startLine).toBe(4);
  });
  it('treats a section as non-empty only with body text before the next same-or-higher heading', () => {
    const s = parseSections(md);
    expect(isNonEmpty(findSection(s, 'Goal')!)).toBe(true);
    expect(isNonEmpty(findSection(s, 'Acceptance Criteria')!)).toBe(true); // "- item" under ### Sub counts
    expect(isNonEmpty(findSection(s, 'Empty')!)).toBe(false);
    expect(isNonEmpty(findSection(s, 'Code')!)).toBe(true);
  });
  it('normalizes numbering and trailing hashes', () => {
    expect(normalizeHeading('## 1. Goal ##')).toBe('goal');
    expect(normalizeHeading('ADDED Requirements')).toBe('added requirements');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gates/markdown.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create src/gates/types.ts**

```ts
import type { z } from 'zod';
import type { Finding, Severity, VerifyEvidence } from '../domain/types.js';

export interface CheckInput {
  artifacts: Record<string, string>;
  declaredArtifacts: string[];
  evidence: VerifyEvidence | Record<string, unknown> | null;
  human_approved: boolean;
  params: Record<string, unknown>;
  severity: Severity;
}

export type CheckFn = (input: CheckInput) => Finding[];

export interface CheckDefinition {
  name: string;
  defaultSeverity: Severity;
  params: z.ZodTypeAny;
  run: CheckFn;
}

export function finding(check: string, severity: Severity, location: string | null, message: string): Finding {
  return { check, severity, location, message };
}
```

- [ ] **Step 4: Create src/gates/markdown.ts**

```ts
export interface Line { n: number; text: string; inFence: boolean }
export interface Section { heading: string; level: number; startLine: number; endLine: number; body: Line[] }

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function lines(md: string): Line[] {
  const out: Line[] = [];
  let inFence = false;
  md.split(/\r?\n/).forEach((text, i) => {
    if (FENCE.test(text)) {
      out.push({ n: i + 1, text, inFence: true });
      inFence = !inFence;
      return;
    }
    out.push({ n: i + 1, text, inFence });
  });
  return out;
}

export function normalizeHeading(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s*#+\s*$/, '')
    .replace(/^\d+(\.\d+)*\.?\s+/, '')
    .trim()
    .toLowerCase();
}

export function isHeadingLine(line: Line): boolean {
  return !line.inFence && HEADING.test(line.text);
}

export function parseSections(md: string): Section[] {
  const ls = lines(md);
  const sections: Section[] = [];
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]!;
    if (!isHeadingLine(line)) continue;
    const m = HEADING.exec(line.text)!;
    const level = m[1]!.length;
    const body: Line[] = [];
    let end = ls.length;
    for (let j = i + 1; j < ls.length; j++) {
      const next = ls[j]!;
      if (isHeadingLine(next) && HEADING.exec(next.text)![1]!.length <= level) { end = next.n - 1; break; }
      body.push(next);
    }
    sections.push({ heading: m[2]!.replace(/\s*#+$/, '').trim(), level, startLine: line.n, endLine: end, body });
  }
  return sections;
}

export function findSection(sections: Section[], name: string): Section | undefined {
  const wanted = normalizeHeading(name);
  return sections.find((s) => normalizeHeading(s.heading) === wanted);
}

export function isNonEmpty(section: Section): boolean {
  return section.body.some((l) => l.text.trim() !== '' && !isHeadingLine(l));
}

/** Lines of `section` that are not sub-headings (used by measurable_criteria). */
export function contentLines(section: Section): Line[] {
  return section.body.filter((l) => l.text.trim() !== '' && !isHeadingLine(l));
}
```

- [ ] **Step 5: Run test**

Run: `npx vitest run test/unit/gates/markdown.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/gates/types.ts src/gates/markdown.ts test/unit/gates/markdown.test.ts
git commit -m "feat(gates): check types and fence-aware markdown section parser"
```

### Task 10: Checks missing_artifact, placeholder_scan, required_sections

**Files:**
- Create: `src/gates/checks/missingArtifact.ts`, `src/gates/checks/placeholderScan.ts`, `src/gates/checks/requiredSections.ts`
- Test: `test/unit/gates/checks/basic.test.ts`

**Interfaces:**
- Each file exports one `CheckDefinition` named `missingArtifact`, `placeholderScan`, `requiredSections`.
- `placeholder_scan` params: `{ markers?: string[] }`, defaults `['\\bTBD\\b', '\\bTODO\\b', 'NEEDS HUMAN INPUT', '\\bOQ-\\d+\\b']`.
- `required_sections` params: `{ artifact: string; sections: string[] }`.

- [ ] **Step 1: Write the failing test**

`test/unit/gates/checks/basic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { missingArtifact } from '../../../../src/gates/checks/missingArtifact.js';
import { placeholderScan } from '../../../../src/gates/checks/placeholderScan.js';
import { requiredSections } from '../../../../src/gates/checks/requiredSections.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function input(over: Partial<CheckInput>): CheckInput {
  return { artifacts: {}, declaredArtifacts: [], evidence: null, human_approved: false, params: {}, severity: 'blocker', ...over };
}

describe('missing_artifact', () => {
  it('reports each declared artifact absent from the call', () => {
    const f = missingArtifact.run(input({ declaredArtifacts: ['proposal.md', 'tasks.md'], artifacts: { 'tasks.md': 'x' } }));
    expect(f).toEqual([{ check: 'missing_artifact', severity: 'blocker', location: 'proposal.md', message: 'artifact "proposal.md" was not submitted' }]);
  });
  it('passes when all are present', () => {
    expect(missingArtifact.run(input({ declaredArtifacts: ['a'], artifacts: { a: '' } }))).toEqual([]);
  });
});

describe('placeholder_scan', () => {
  it('scans every submitted artifact with default markers and line numbers', () => {
    const f = placeholderScan.run(input({ artifacts: { 'a.md': 'ok\nTBD here\nsee OQ-3', 'b.md': 'NEEDS HUMAN INPUT' } }));
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['a.md:2', 'marker \\bTBD\\b'], ['a.md:3', 'marker \\bOQ-\\d+\\b'], ['b.md:1', 'marker NEEDS HUMAN INPUT'],
    ]);
  });
  it('is case-sensitive and accepts custom markers', () => {
    expect(placeholderScan.run(input({ artifacts: { 'a.md': 'todo later' } }))).toEqual([]);
    expect(placeholderScan.run(input({ artifacts: { 'a.md': 'FIXME' }, params: { markers: ['FIXME'] } }))).toHaveLength(1);
  });
  it('honours the configured severity', () => {
    expect(placeholderScan.run(input({ artifacts: { 'a.md': 'TODO' }, severity: 'warning' }))[0]?.severity).toBe('warning');
  });
});

describe('required_sections', () => {
  const md = '## Goal\ntext\n## Tasks\n\n## Other\nx';
  it('reports missing and empty sections', () => {
    const f = requiredSections.run(input({ artifacts: { 'spec.md': md }, params: { artifact: 'spec.md', sections: ['Goal', 'Tasks', 'Acceptance Criteria'] } }));
    expect(f.map((x) => x.message)).toEqual(['section "Tasks" is empty', 'section "Acceptance Criteria" is missing']);
    expect(f[0]?.location).toBe('spec.md:3');
  });
  it('matches headings case-insensitively at any level', () => {
    const f = requiredSections.run(input({ artifacts: { 'spec.md': '### goal\nx' }, params: { artifact: 'spec.md', sections: ['Goal'] } }));
    expect(f).toEqual([]);
  });
  it('is silent when the artifact is absent (missing_artifact reports that)', () => {
    expect(requiredSections.run(input({ params: { artifact: 'spec.md', sections: ['Goal'] } }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gates/checks/basic.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three checks**

`src/gates/checks/missingArtifact.ts`:

```ts
import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';

export const missingArtifact: CheckDefinition = {
  name: 'missing_artifact',
  defaultSeverity: 'blocker',
  params: z.object({}).passthrough(),
  run: ({ declaredArtifacts, artifacts }) =>
    declaredArtifacts
      .filter((name) => !(name in artifacts))
      .map((name) => finding('missing_artifact', 'blocker', name, `artifact "${name}" was not submitted`)),
};
```

`src/gates/checks/placeholderScan.ts`:

```ts
import { z } from 'zod';
import { lines } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export const DEFAULT_MARKERS = ['\\bTBD\\b', '\\bTODO\\b', 'NEEDS HUMAN INPUT', '\\bOQ-\\d+\\b'];

const Params = z.object({ markers: z.array(z.string()).optional() });

export const placeholderScan: CheckDefinition = {
  name: 'placeholder_scan',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const markers = (Params.parse(params).markers ?? DEFAULT_MARKERS).map((m) => ({ source: m, re: new RegExp(m) }));
    const out = [];
    for (const [name, text] of Object.entries(artifacts)) {
      for (const line of lines(text)) {
        for (const m of markers) {
          if (m.re.test(line.text)) out.push(finding('placeholder_scan', severity, `${name}:${line.n}`, `marker ${m.source}`));
        }
      }
    }
    return out;
  },
};
```

`src/gates/checks/requiredSections.ts`:

```ts
import { z } from 'zod';
import { findSection, isNonEmpty, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({ artifact: z.string(), sections: z.array(z.string()).min(1) });

export const requiredSections: CheckDefinition = {
  name: 'required_sections',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const sections = parseSections(text);
    const out = [];
    for (const name of p.sections) {
      const s = findSection(sections, name);
      if (!s) out.push(finding('required_sections', severity, p.artifact, `section "${name}" is missing`));
      else if (!isNonEmpty(s)) out.push(finding('required_sections', severity, `${p.artifact}:${s.startLine}`, `section "${name}" is empty`));
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/gates/checks/basic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gates/checks test/unit/gates/checks/basic.test.ts
git commit -m "feat(gates): missing_artifact, placeholder_scan, required_sections"
```

### Task 11: Check measurable_criteria

**Files:**
- Create: `src/gates/checks/measurableCriteria.ts`
- Test: `test/unit/gates/checks/measurableCriteria.test.ts`

**Interfaces:**
- Exports `measurableCriteria: CheckDefinition` and `DEFAULT_ADJECTIVES: string[]`. Params `{ artifact: string; section: string; adjectives?: string[] }` (extra adjectives are added to the defaults).

- [ ] **Step 1: Write the failing test**

`test/unit/gates/checks/measurableCriteria.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { measurableCriteria, DEFAULT_ADJECTIVES } from '../../../../src/gates/checks/measurableCriteria.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function run(md: string, extra: string[] = []) {
  const input: CheckInput = {
    artifacts: { 'spec.md': md }, declaredArtifacts: [], evidence: null, human_approved: false,
    params: { artifact: 'spec.md', section: 'Success Criteria', adjectives: extra }, severity: 'blocker',
  };
  return measurableCriteria.run(input);
}

describe('measurable_criteria', () => {
  it('has a default adjective list', () => {
    expect(DEFAULT_ADJECTIVES).toContain('fast');
    expect(DEFAULT_ADJECTIVES).toContain('scalable');
  });
  it('flags vague lines and accepts quantified ones', () => {
    const f = run('## Success Criteria\n- export must be fast\n- export completes in under 800 ms for 10k rows\n- 99% of requests succeed\n- the UI is responsive');
    expect(f.map((x) => x.location)).toEqual(['spec.md:2', 'spec.md:5']);
    expect(f[0]?.message).toContain('"export must be fast"');
  });
  it('accepts a bare integer as the measure', () => {
    expect(run('## Success Criteria\n- fast enough for 3 concurrent exports')).toEqual([]);
  });
  it('ignores lines without a listed adjective', () => {
    expect(run('## Success Criteria\n- exports include a header row')).toEqual([]);
  });
  it('extends the adjective list', () => {
    expect(run('## Success Criteria\n- must be snappy', ['snappy'])).toHaveLength(1);
  });
  it('is silent when the section or artifact is missing', () => {
    expect(run('## Other\n- slow')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gates/checks/measurableCriteria.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/gates/checks/measurableCriteria.ts**

```ts
import { z } from 'zod';
import { contentLines, findSection, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export const DEFAULT_ADJECTIVES: string[] = [
  'fast', 'quick', 'quickly', 'slow', 'responsive', 'scalable', 'performant', 'efficient', 'reliable', 'robust',
  'secure', 'easy', 'simple', 'intuitive', 'user-friendly', 'small', 'large', 'high', 'low', 'many', 'few',
  'soon', 'instant', 'instantly', 'minimal', 'maximum', 'optimal', 'better', 'improved', 'acceptable', 'reasonable',
];

const MEASURE = /\d+(?:\.\d+)?\s*(?:ms|s|%|MB|GB|KB|req\/s|rps)\b|\b\d+\b/;

const Params = z.object({ artifact: z.string(), section: z.string(), adjectives: z.array(z.string()).optional() });

export const measurableCriteria: CheckDefinition = {
  name: 'measurable_criteria',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const section = findSection(parseSections(text), p.section);
    if (!section) return [];
    const adjectives = [...DEFAULT_ADJECTIVES, ...(p.adjectives ?? [])];
    const adjective = new RegExp(`\\b(?:${adjectives.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const out = [];
    for (const line of contentLines(section)) {
      if (adjective.test(line.text) && !MEASURE.test(line.text)) {
        const shown = line.text.replace(/^\s*[-*+]\s+|\s*\d+\.\s+/, '').trim();
        out.push(finding('measurable_criteria', severity, `${p.artifact}:${line.n}`, `"${shown}" has no threshold`));
      }
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/gates/checks/measurableCriteria.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gates/checks/measurableCriteria.ts test/unit/gates/checks/measurableCriteria.test.ts
git commit -m "feat(gates): measurable_criteria detector"
```

### Task 12: Checks task_done_checks and task_ordering

**Files:**
- Create: `src/gates/checks/taskDoneChecks.ts`, `src/gates/checks/taskOrdering.ts`
- Test: `test/unit/gates/checks/tasks.test.ts`

**Interfaces:**
- `task_done_checks` params `{ artifact, task_regex, done_regex }`.
- `task_ordering` params `{ artifact, task_regex, dep_regex }`; both regexes must contain a named group `id`.
- Shared helper `taskBlocks(text, taskRegex): { startLine: number; lines: Line[]; match: RegExpExecArray }[]` in `src/gates/checks/taskDoneChecks.ts`, exported.

- [ ] **Step 1: Write the failing test**

`test/unit/gates/checks/tasks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taskDoneChecks, taskBlocks } from '../../../../src/gates/checks/taskDoneChecks.js';
import { taskOrdering } from '../../../../src/gates/checks/taskOrdering.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function input(md: string, params: Record<string, unknown>): CheckInput {
  return { artifacts: { 'tasks.md': md }, declaredArtifacts: [], evidence: null, human_approved: false, params: { artifact: 'tasks.md', ...params }, severity: 'blocker' };
}

describe('taskBlocks', () => {
  it('splits from one task match to the next', () => {
    const b = taskBlocks('intro\n- [ ] A\n  detail\n- [ ] B\n', /^- \[ \] /);
    expect(b.map((x) => [x.startLine, x.lines.length])).toEqual([[2, 2], [4, 2]]);
  });
});

describe('task_done_checks', () => {
  const params = { task_regex: '^- \\[ \\] ', done_regex: '\\(AC: \\d' };
  it('flags task blocks without a done match', () => {
    const f = taskDoneChecks.run(input('- [ ] one\n  (AC: 1)\n- [ ] two\n  nothing\n- [ ] three (AC: 2)', params));
    expect(f).toEqual([{ check: 'task_done_checks', severity: 'blocker', location: 'tasks.md:3', message: 'task "two" has no done check matching \\(AC: \\d' }]);
  });
  it('passes when every block matches', () => {
    expect(taskDoneChecks.run(input('- [ ] one (AC: 1)', params))).toEqual([]);
  });
});

describe('task_ordering', () => {
  const params = { task_regex: '^- \\[ \\] (?<id>T\\d+)', dep_regex: 'depends on (?<id>T\\d+)' };
  it('flags a dependency on a later or unknown task', () => {
    const f = taskOrdering.run(input('- [ ] T1 first, depends on T2\n- [ ] T2 second\n- [ ] T3 depends on T9', params));
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['tasks.md:1', 'task T1 depends on T2 which does not appear earlier'],
      ['tasks.md:3', 'task T3 depends on T9 which does not appear earlier'],
    ]);
  });
  it('passes when dependencies precede', () => {
    expect(taskOrdering.run(input('- [ ] T1 a\n- [ ] T2 b, depends on T1', params))).toEqual([]);
  });
  it('rejects regexes without an id group at parse time', () => {
    expect(() => taskOrdering.params.parse({ artifact: 'x', task_regex: '^- ', dep_regex: 'dep (?<id>T\\d+)' })).toThrow(/named group "id"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gates/checks/tasks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both checks**

`src/gates/checks/taskDoneChecks.ts`:

```ts
import { z } from 'zod';
import { lines, type Line } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export interface TaskBlock { startLine: number; lines: Line[]; match: RegExpExecArray }

export function taskBlocks(text: string, taskRegex: RegExp): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  let current: TaskBlock | null = null;
  for (const line of lines(text)) {
    const m = line.inFence ? null : taskRegex.exec(line.text);
    if (m) {
      current = { startLine: line.n, lines: [line], match: m };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks;
}

const Params = z.object({ artifact: z.string(), task_regex: z.string(), done_regex: z.string() });

export const taskDoneChecks: CheckDefinition = {
  name: 'task_done_checks',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const done = new RegExp(p.done_regex);
    const out = [];
    for (const block of taskBlocks(text, new RegExp(p.task_regex))) {
      if (!block.lines.some((l) => done.test(l.text))) {
        const title = block.lines[0]!.text.replace(new RegExp(p.task_regex), '').replace(done, '').trim();
        out.push(finding('task_done_checks', severity, `${p.artifact}:${block.startLine}`, `task "${title}" has no done check matching ${p.done_regex}`));
      }
    }
    return out;
  },
};
```

`src/gates/checks/taskOrdering.ts`:

```ts
import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';
import { taskBlocks } from './taskDoneChecks.js';

const withIdGroup = z.string().refine((s) => s.includes('(?<id>'), { message: 'regex must contain a named group "id"' });
const Params = z.object({ artifact: z.string(), task_regex: withIdGroup, dep_regex: withIdGroup });

export const taskOrdering: CheckDefinition = {
  name: 'task_ordering',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const dep = new RegExp(p.dep_regex, 'g');
    const seen = new Set<string>();
    const out = [];
    for (const block of taskBlocks(text, new RegExp(p.task_regex))) {
      const id = block.match.groups?.id ?? '?';
      const body = block.lines.map((l) => l.text).join('\n');
      for (const m of body.matchAll(dep)) {
        const depId = m.groups?.id;
        if (depId && !seen.has(depId)) {
          out.push(finding('task_ordering', severity, `${p.artifact}:${block.startLine}`, `task ${id} depends on ${depId} which does not appear earlier`));
        }
      }
      seen.add(id);
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/gates/checks/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gates/checks/taskDoneChecks.ts src/gates/checks/taskOrdering.ts test/unit/gates/checks/tasks.test.ts
git commit -m "feat(gates): task_done_checks and task_ordering"
```

### Task 13: Check delta_markers

**Files:**
- Create: `src/gates/checks/deltaMarkers.ts`
- Test: `test/unit/gates/checks/deltaMarkers.test.ts`

**Interfaces:**
- Exports `deltaMarkers: CheckDefinition`. Params `{ artifact }`. Recognised sections: headings normalising to `added requirements`, `modified requirements`, `removed requirements`. Each entry under REMOVED (a sub-heading one level deeper, or the whole body when there are no sub-headings) must contain `**Reason**` and `**Migration**`. At least one of the three sections must exist.

- [ ] **Step 1: Write the failing test**

`test/unit/gates/checks/deltaMarkers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deltaMarkers } from '../../../../src/gates/checks/deltaMarkers.js';
import type { CheckInput } from '../../../../src/gates/types.js';

function run(md: string) {
  const input: CheckInput = { artifacts: { 'spec.md': md }, declaredArtifacts: [], evidence: null, human_approved: false, params: { artifact: 'spec.md' }, severity: 'blocker' };
  return deltaMarkers.run(input);
}

describe('delta_markers', () => {
  it('requires at least one delta section', () => {
    expect(run('## Intro\nx')[0]?.message).toMatch(/no ADDED, MODIFIED or REMOVED Requirements section/);
  });
  it('accepts empty delta sections (refactor spec)', () => {
    expect(run('## ADDED Requirements\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n')).toEqual([]);
  });
  it('requires Reason and Migration on each removed entry', () => {
    const md = '## REMOVED Requirements\n### Requirement: Legacy export\n**Reason**: replaced\n### Requirement: Old auth\nsome text';
    const f = run(md);
    expect(f.map((x) => [x.location, x.message])).toEqual([
      ['spec.md:2', 'removed requirement "Requirement: Legacy export" lacks **Migration**'],
      ['spec.md:4', 'removed requirement "Requirement: Old auth" lacks **Reason**'],
      ['spec.md:4', 'removed requirement "Requirement: Old auth" lacks **Migration**'],
    ]);
  });
  it('treats a body without sub-headings as one entry', () => {
    expect(run('## REMOVED Requirements\n- old thing\n**Reason**: x\n**Migration**: y')).toEqual([]);
    expect(run('## REMOVED Requirements\n- old thing')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gates/checks/deltaMarkers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/gates/checks/deltaMarkers.ts**

```ts
import { z } from 'zod';
import { findSection, isNonEmpty, normalizeHeading, parseSections, type Section } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({ artifact: z.string() });
const REQUIRED_MARKERS = ['**Reason**', '**Migration**'];

export const deltaMarkers: CheckDefinition = {
  name: 'delta_markers',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const sections = parseSections(text);
    const added = findSection(sections, 'ADDED Requirements');
    const modified = findSection(sections, 'MODIFIED Requirements');
    const removed = findSection(sections, 'REMOVED Requirements');
    if (!added && !modified && !removed) {
      return [finding('delta_markers', severity, p.artifact, 'no ADDED, MODIFIED or REMOVED Requirements section found')];
    }
    if (!removed || !isNonEmpty(removed)) return [];

    const entries: Section[] = sections.filter(
      (s) => s.level > removed.level && s.startLine > removed.startLine && s.startLine <= removed.endLine
        && normalizeHeading(s.heading) !== normalizeHeading(removed.heading),
    );
    const out = [];
    const checkEntry = (label: string, line: number, body: string) => {
      for (const marker of REQUIRED_MARKERS) {
        if (!body.includes(marker)) out.push(finding('delta_markers', severity, `${p.artifact}:${line}`, `removed requirement "${label}" lacks ${marker}`));
      }
    };
    if (entries.length === 0) {
      checkEntry('(unnamed)', removed.startLine, removed.body.map((l) => l.text).join('\n'));
    } else {
      for (const e of entries) checkEntry(e.heading, e.startLine, e.body.map((l) => l.text).join('\n'));
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/gates/checks/deltaMarkers.test.ts`
Expected: PASS. Note: for the two-entry fixture, the direct sub-headings are level 3 under a level-2 REMOVED section; `parseSections` gives each its own body, so nested deeper headings are also listed as entries. That is acceptable for v1 (every sub-heading under REMOVED is an entry).

- [ ] **Step 5: Commit**

```bash
git add src/gates/checks/deltaMarkers.ts test/unit/gates/checks/deltaMarkers.test.ts
git commit -m "feat(gates): delta_markers for OpenSpec delta specs"
```

### Task 14: Check verify_evidence with the evidence schema

**Files:**
- Create: `src/gates/evidence.ts`, `src/gates/checks/verifyEvidence.ts`
- Test: `test/unit/gates/checks/verifyEvidence.test.ts`

**Interfaces:**
- `src/gates/evidence.ts` exports `VerifyEvidenceSchema` (zod) matching `VerifyEvidence` from Task 2, with `files_changed`, `implements`, `existing_tests_modified`, `characterization_tests` optional at schema level (the check enforces track-conditional requirements).
- `verify_evidence` params `{ max_new_high?: number (default 0); max_existing_tests_modified?: number | null (default null) }`.

- [ ] **Step 1: Write the failing test**

`test/unit/gates/checks/verifyEvidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifyEvidence } from '../../../../src/gates/checks/verifyEvidence.js';
import type { CheckInput } from '../../../../src/gates/types.js';

const good = {
  tests: { command: 'npm test', passed: 42, failed: 0 },
  lint: 'pass',
  security: { status: 'pass', new_high: 0, skipped_reason: null },
  files_changed: ['src/a.ts'],
};

function run(evidence: unknown, params: Record<string, unknown> = {}) {
  const input: CheckInput = { artifacts: {}, declaredArtifacts: [], evidence: evidence as CheckInput['evidence'], human_approved: false, params, severity: 'blocker' };
  return verifyEvidence.run(input);
}

describe('verify_evidence', () => {
  it('passes with complete passing evidence', () => {
    expect(run(good)).toEqual([]);
  });
  it('blocks when evidence is absent', () => {
    expect(run(null)[0]).toMatchObject({ severity: 'blocker', message: 'evidence is required on the transition out of verify' });
  });
  it('blocks on a missing required field with its path', () => {
    const f = run({ ...good, tests: { command: 'npm test', passed: 1 } });
    expect(f[0]?.message).toMatch(/tests\.failed/);
  });
  it('blocks on failed tests, lint fail, or security fail', () => {
    expect(run({ ...good, tests: { ...good.tests, failed: 2 } })[0]?.message).toBe('2 tests failed');
    expect(run({ ...good, lint: 'fail' })[0]?.message).toBe('lint failed');
    expect(run({ ...good, security: { status: 'fail', new_high: 3 } })[0]?.message).toBe('security scan failed');
  });
  it('blocks when new_high exceeds max_new_high', () => {
    expect(run({ ...good, security: { status: 'pass', new_high: 1 } })[0]?.message).toBe('1 new high severity finding(s), max 0');
    expect(run({ ...good, security: { status: 'pass', new_high: 1 } }, { max_new_high: 1 })).toEqual([]);
  });
  it('warns on a skipped scan with a reason and blocks without one', () => {
    const w = run({ ...good, security: { status: 'skipped', new_high: 0, skipped_reason: 'no scanner in CI' } });
    expect(w).toEqual([{ check: 'verify_evidence', severity: 'warning', location: 'security', message: 'security scan skipped: no scanner in CI' }]);
    expect(run({ ...good, security: { status: 'skipped', new_high: 0 } })[0]?.severity).toBe('blocker');
  });
  it('enforces max_existing_tests_modified and characterization tests when set', () => {
    const f = run({ ...good, existing_tests_modified: 1 }, { max_existing_tests_modified: 0 });
    expect(f.map((x) => x.message)).toEqual(['1 existing test file(s) modified, max 0', 'characterization_tests must be non-empty']);
    expect(run({ ...good, existing_tests_modified: 0, characterization_tests: ['a.test.ts'] }, { max_existing_tests_modified: 0 })).toEqual([]);
    expect(run(good, { max_existing_tests_modified: 0 })[0]?.message).toMatch(/existing_tests_modified is required/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/gates/checks/verifyEvidence.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the schema and check**

`src/gates/evidence.ts`:

```ts
import { z } from 'zod';

export const VerifyEvidenceSchema = z.object({
  tests: z.object({ command: z.string(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }),
  lint: z.enum(['pass', 'fail']),
  security: z.object({
    status: z.enum(['pass', 'fail', 'skipped']),
    new_high: z.number().int().nonnegative(),
    skipped_reason: z.string().nullable().optional(),
  }),
  files_changed: z.array(z.string()).optional(),
  implements: z.array(z.string()).optional(),
  existing_tests_modified: z.number().int().nonnegative().optional(),
  characterization_tests: z.array(z.string()).optional(),
});
export type VerifyEvidenceInput = z.infer<typeof VerifyEvidenceSchema>;
```

`src/gates/checks/verifyEvidence.ts`:

```ts
import { z } from 'zod';
import { VerifyEvidenceSchema } from '../evidence.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({
  max_new_high: z.number().int().nonnegative().default(0),
  max_existing_tests_modified: z.number().int().nonnegative().nullable().default(null),
});

export const verifyEvidence: CheckDefinition = {
  name: 'verify_evidence',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ evidence, params, severity }) => {
    const p = Params.parse(params);
    const name = 'verify_evidence';
    if (!evidence) return [finding(name, 'blocker', null, 'evidence is required on the transition out of verify')];
    const parsed = VerifyEvidenceSchema.safeParse(evidence);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => finding(name, 'blocker', i.path.join('.'), `evidence field ${i.path.join('.')} is invalid or missing: ${i.message}`));
    }
    const e = parsed.data;
    const out = [];
    if (e.tests.failed > 0) out.push(finding(name, severity, 'tests.failed', `${e.tests.failed} tests failed`));
    if (e.lint === 'fail') out.push(finding(name, severity, 'lint', 'lint failed'));
    if (e.security.status === 'fail') out.push(finding(name, severity, 'security.status', 'security scan failed'));
    if (e.security.status === 'pass' && e.security.new_high > p.max_new_high) {
      out.push(finding(name, severity, 'security.new_high', `${e.security.new_high} new high severity finding(s), max ${p.max_new_high}`));
    }
    if (e.security.status === 'skipped') {
      if (e.security.skipped_reason) out.push(finding(name, 'warning', 'security', `security scan skipped: ${e.security.skipped_reason}`));
      else out.push(finding(name, 'blocker', 'security.skipped_reason', 'security.skipped_reason is required when status is skipped'));
    }
    if (p.max_existing_tests_modified !== null) {
      if (e.existing_tests_modified === undefined) {
        out.push(finding(name, 'blocker', 'existing_tests_modified', 'existing_tests_modified is required by this track'));
      } else if (e.existing_tests_modified > p.max_existing_tests_modified) {
        out.push(finding(name, severity, 'existing_tests_modified', `${e.existing_tests_modified} existing test file(s) modified, max ${p.max_existing_tests_modified}`));
      }
      if (!e.characterization_tests || e.characterization_tests.length === 0) {
        out.push(finding(name, 'blocker', 'characterization_tests', 'characterization_tests must be non-empty'));
      }
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/gates/checks/verifyEvidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gates/evidence.ts src/gates/checks/verifyEvidence.ts test/unit/gates/checks/verifyEvidence.test.ts
git commit -m "feat(gates): verify_evidence with evidence schema"
```

### Task 15: scope_drift, human_approved, the library registry and runGate

**Files:**
- Create: `src/gates/checks/scopeDrift.ts`, `src/gates/checks/humanApproved.ts`, `src/gates/library.ts`, `src/gates/run.ts`
- Test: `test/unit/gates/checks/scopeDrift.test.ts`, `test/unit/gates/run.test.ts`

**Interfaces:**
- `scope_drift` params `{ plan_artifact, files_section }`, default severity `warning`.
- `human_approved` params `{}`.
- `src/gates/library.ts`: `GATE_LIBRARY_VERSION = '1'`, `GATE_LIBRARY: Record<string, CheckDefinition>`, `getCheck(name): CheckDefinition | undefined`, `validateGateDecl(gate: GateDecl): string[]` (errors: unknown check, invalid params, `artifact` params naming an undeclared artifact).
- `src/gates/run.ts`:

```ts
export interface GateContext { artifacts: Record<string, string>; evidence: unknown; human_approved: boolean }
export interface GateResult { result: 'pass' | 'fail'; findings: Finding[] }
export function runGate(gate: GateDecl | null, ctx: GateContext, mandatedApproval: boolean): GateResult
```

- [ ] **Step 1: Write the failing tests**

`test/unit/gates/checks/scopeDrift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scopeDrift } from '../../../../src/gates/checks/scopeDrift.js';
import type { CheckInput } from '../../../../src/gates/types.js';

const plan = '## Files\n- `src/api/export.ts`\n- src/api/export.test.ts\n- docs/notes.md';
function run(files: string[], artifacts: Record<string, string> = { 'plan.md': plan }) {
  const input: CheckInput = { artifacts, declaredArtifacts: [], evidence: { files_changed: files }, human_approved: false, params: { plan_artifact: 'plan.md', files_section: 'Files' }, severity: 'warning' };
  return scopeDrift.run(input);
}

describe('scope_drift', () => {
  it('extracts backticked and bare paths and warns on unknown files', () => {
    const f = run(['src/api/export.ts', 'src/api/export.test.ts', 'src/other.ts']);
    expect(f).toEqual([{ check: 'scope_drift', severity: 'warning', location: 'src/other.ts', message: 'src/other.ts is not listed in plan.md section "Files"' }]);
  });
  it('defaults to warning severity', () => {
    expect(scopeDrift.defaultSeverity).toBe('warning');
  });
  it('is silent without files_changed or without the plan artifact', () => {
    expect(run([])).toEqual([]);
    expect(run(['x.ts'], {})).toEqual([]);
  });
});
```

`test/unit/gates/run.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GATE_LIBRARY, GATE_LIBRARY_VERSION, validateGateDecl } from '../../../src/gates/library.js';
import { runGate } from '../../../src/gates/run.js';

describe('library', () => {
  it('exposes exactly the spec checks', () => {
    expect(Object.keys(GATE_LIBRARY).sort()).toEqual([
      'delta_markers', 'human_approved', 'measurable_criteria', 'missing_artifact', 'placeholder_scan',
      'required_sections', 'scope_drift', 'task_done_checks', 'task_ordering', 'verify_evidence',
    ]);
    expect(GATE_LIBRARY_VERSION).toBe('1');
  });
  it('validates declarations', () => {
    expect(validateGateDecl({ transition: 'specify->implement', artifacts: ['a.md'], checks: [{ name: 'nope' }] })).toEqual(['unknown check "nope"']);
    expect(validateGateDecl({ transition: 'specify->implement', artifacts: ['a.md'], checks: [{ name: 'required_sections', params: { artifact: 'b.md', sections: ['X'] } }] })).toEqual(['check required_sections names artifact "b.md" which is not declared for the transition']);
    expect(validateGateDecl({ transition: 'specify->implement', artifacts: ['a.md'], checks: [{ name: 'required_sections', params: { artifact: 'a.md' } }] })[0]).toMatch(/invalid params/);
    expect(validateGateDecl({ transition: 'x', artifacts: [], checks: [{ name: 'verify_evidence' }] })).toEqual([]);
  });
});

describe('runGate', () => {
  const gate = { transition: 'specify->implement', artifacts: ['spec.md'], checks: [
    { name: 'placeholder_scan' },
    { name: 'required_sections', params: { artifact: 'spec.md', sections: ['Goal'] } },
    { name: 'scope_drift', params: { plan_artifact: 'spec.md', files_section: 'Goal' } },
  ] };
  it('passes with no gate and no mandated approval', () => {
    expect(runGate(null, { artifacts: {}, evidence: null, human_approved: false }, false)).toEqual({ result: 'pass', findings: [] });
  });
  it('runs missing_artifact implicitly and fails on blockers', () => {
    const r = runGate(gate, { artifacts: {}, evidence: null, human_approved: true }, false);
    expect(r.result).toBe('fail');
    expect(r.findings[0]).toMatchObject({ check: 'missing_artifact', location: 'spec.md' });
  });
  it('does not fail on warnings alone', () => {
    const r = runGate(gate, { artifacts: { 'spec.md': '## Goal\n- `a.ts`' }, evidence: { files_changed: ['b.ts'] }, human_approved: true }, false);
    expect(r.result).toBe('pass');
    expect(r.findings).toEqual([{ check: 'scope_drift', severity: 'warning', location: 'b.ts', message: 'b.ts is not listed in spec.md section "Goal"' }]);
  });
  it('adds the mandated human_approved check', () => {
    const r = runGate(gate, { artifacts: { 'spec.md': '## Goal\nx' }, evidence: null, human_approved: false }, true);
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([{ check: 'human_approved', severity: 'blocker', location: null, message: 'human approval is required for this transition' }]);
  });
  it('honours a track-level severity override', () => {
    const g = { ...gate, checks: [{ name: 'placeholder_scan', severity: 'warning' as const }] };
    const r = runGate(g, { artifacts: { 'spec.md': 'TODO' }, evidence: null, human_approved: true }, false);
    expect(r.result).toBe('pass');
    expect(r.findings[0]?.severity).toBe('warning');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/gates`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement scope_drift and human_approved**

`src/gates/checks/scopeDrift.ts`:

```ts
import { z } from 'zod';
import { findSection, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({ plan_artifact: z.string(), files_section: z.string() });
const BACKTICKED = /`([^`]+)`/g;
const BARE = /[\w./-]+\.\w+/g;

export function extractPaths(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(BACKTICKED)) out.add(m[1]!.trim());
  for (const m of text.matchAll(BARE)) out.add(m[0]);
  return out;
}

export const scopeDrift: CheckDefinition = {
  name: 'scope_drift',
  defaultSeverity: 'warning',
  params: Params,
  run: ({ artifacts, evidence, params, severity }) => {
    const p = Params.parse(params);
    const plan = artifacts[p.plan_artifact];
    const files = (evidence as { files_changed?: unknown } | null)?.files_changed;
    if (plan === undefined || !Array.isArray(files) || files.length === 0) return [];
    const section = findSection(parseSections(plan), p.files_section);
    if (!section) return [];
    const listed = extractPaths(section.body.map((l) => l.text).join('\n'));
    return files
      .filter((f): f is string => typeof f === 'string' && !listed.has(f))
      .map((f) => finding('scope_drift', severity, f, `${f} is not listed in ${p.plan_artifact} section "${p.files_section}"`));
  },
};
```

`src/gates/checks/humanApproved.ts`:

```ts
import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';

export const humanApproved: CheckDefinition = {
  name: 'human_approved',
  defaultSeverity: 'blocker',
  params: z.object({}).passthrough(),
  run: ({ human_approved }) =>
    human_approved ? [] : [finding('human_approved', 'blocker', null, 'human approval is required for this transition')],
};
```

- [ ] **Step 4: Implement the library and runner**

`src/gates/library.ts`:

```ts
import type { GateDecl } from '../domain/types.js';
import type { CheckDefinition } from './types.js';
import { deltaMarkers } from './checks/deltaMarkers.js';
import { humanApproved } from './checks/humanApproved.js';
import { measurableCriteria } from './checks/measurableCriteria.js';
import { missingArtifact } from './checks/missingArtifact.js';
import { placeholderScan } from './checks/placeholderScan.js';
import { requiredSections } from './checks/requiredSections.js';
import { scopeDrift } from './checks/scopeDrift.js';
import { taskDoneChecks } from './checks/taskDoneChecks.js';
import { taskOrdering } from './checks/taskOrdering.js';
import { verifyEvidence } from './checks/verifyEvidence.js';

export const GATE_LIBRARY_VERSION = '1';

export const GATE_LIBRARY: Record<string, CheckDefinition> = Object.fromEntries(
  [missingArtifact, placeholderScan, requiredSections, measurableCriteria, taskDoneChecks, taskOrdering,
    deltaMarkers, verifyEvidence, scopeDrift, humanApproved].map((c) => [c.name, c]),
);

export function getCheck(name: string): CheckDefinition | undefined {
  return GATE_LIBRARY[name];
}

const ARTIFACT_PARAM_KEYS = ['artifact', 'plan_artifact'];

export function validateGateDecl(gate: GateDecl): string[] {
  const errors: string[] = [];
  for (const check of gate.checks) {
    const def = getCheck(check.name);
    if (!def) { errors.push(`unknown check "${check.name}"`); continue; }
    const parsed = def.params.safeParse(check.params ?? {});
    if (!parsed.success) { errors.push(`check ${check.name} has invalid params: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`); continue; }
    for (const key of ARTIFACT_PARAM_KEYS) {
      const named = (check.params ?? {})[key];
      if (typeof named === 'string' && !gate.artifacts.includes(named)) {
        errors.push(`check ${check.name} names artifact "${named}" which is not declared for the transition`);
      }
    }
  }
  return errors;
}
```

`src/gates/run.ts`:

```ts
import type { Finding, GateDecl } from '../domain/types.js';
import { getCheck } from './library.js';
import { missingArtifact } from './checks/missingArtifact.js';
import { humanApproved } from './checks/humanApproved.js';
import type { CheckInput } from './types.js';

export interface GateContext { artifacts: Record<string, string>; evidence: unknown; human_approved: boolean }
export interface GateResult { result: 'pass' | 'fail'; findings: Finding[] }

export function runGate(gate: GateDecl | null, ctx: GateContext, mandatedApproval: boolean): GateResult {
  const findings: Finding[] = [];
  const base: Omit<CheckInput, 'params' | 'severity'> = {
    artifacts: ctx.artifacts,
    declaredArtifacts: gate?.artifacts ?? [],
    evidence: ctx.evidence as CheckInput['evidence'],
    human_approved: ctx.human_approved,
  };
  if (gate) {
    findings.push(...missingArtifact.run({ ...base, params: {}, severity: 'blocker' }));
    for (const check of gate.checks) {
      const def = getCheck(check.name);
      if (!def) throw new Error(`gate names unknown check "${check.name}"; packs are validated at ingestion`);
      findings.push(...def.run({ ...base, params: check.params ?? {}, severity: check.severity ?? def.defaultSeverity }));
    }
  }
  const declaresApproval = gate?.checks.some((c) => c.name === 'human_approved') ?? false;
  if (mandatedApproval && !declaresApproval) {
    findings.push(...humanApproved.run({ ...base, params: {}, severity: 'blocker' }));
  }
  return { result: findings.some((f) => f.severity === 'blocker') ? 'fail' : 'pass', findings };
}
```

- [ ] **Step 5: Run all gate tests and typecheck**

Run: `npx vitest run test/unit/gates && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/gates test/unit/gates
git commit -m "feat(gates): scope_drift, human_approved, library registry and runGate"
```

---

## Part D: Lifecycle rules (pure)

### Task 16: Track declaration schema, phase order and gate lookup

**Files:**
- Create: `src/lifecycle/track.ts`
- Test: `test/unit/lifecycle/track.test.ts`

**Interfaces:**
- Produces `TrackDeclSchema` (zod for `TrackDecl`, every one of the seven phases required, each either the literal `skipped` or `{alias?, command?, template?}`), `TracksSchema = z.record(TrackDeclSchema)`, `phaseOrder(track): Phase[]` (non-skipped phases in `PHASES` order), `transitionKey(from, to): string`, `gateFor(track, from, to): GateDecl | null`, `phaseMapping(track, phase): PhaseMapping` (throws if skipped), `phaseAlias(track, phase): string` (alias or the phase name), `validateTrackShape(track): string[]` (mandatory phases not skipped; every gate transition is a legal forward edge).

- [ ] **Step 1: Write the failing test**

`test/unit/lifecycle/track.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TrackDeclSchema, phaseOrder, transitionKey, gateFor, phaseAlias, validateTrackShape } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

export const openspecDefault: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped', tasks: 'skipped',
    implement: { alias: 'apply', command: '/openspec:apply', template: 'openspec.template.apply' },
    verify: { alias: 'verify', template: 'openspec.template.verify' },
    integrate: { alias: 'archive', command: '/openspec:archive', template: 'openspec.template.archive' },
    learn: 'skipped',
  },
  gates: [
    { transition: 'specify->implement', artifacts: ['proposal.md'], checks: [{ name: 'placeholder_scan' }] },
    { transition: 'verify->integrate', artifacts: [], checks: [{ name: 'verify_evidence' }] },
  ],
};

describe('TrackDeclSchema', () => {
  it('accepts a full mapping and rejects a missing phase', () => {
    expect(TrackDeclSchema.safeParse(openspecDefault).success).toBe(true);
    const { learn: _l, ...rest } = openspecDefault.phases;
    expect(TrackDeclSchema.safeParse({ ...openspecDefault, phases: rest }).success).toBe(false);
  });
});

describe('phaseOrder and gates', () => {
  it('lists non-skipped phases in order', () => {
    expect(phaseOrder(openspecDefault)).toEqual(['specify', 'implement', 'verify', 'integrate']);
  });
  it('finds the gate for a transition', () => {
    expect(transitionKey('specify', 'implement')).toBe('specify->implement');
    expect(gateFor(openspecDefault, 'specify', 'implement')?.artifacts).toEqual(['proposal.md']);
    expect(gateFor(openspecDefault, 'implement', 'verify')).toBeNull();
    expect(gateFor(openspecDefault, 'integrate', 'archived')).toBeNull();
  });
  it('returns the alias or the phase name', () => {
    expect(phaseAlias(openspecDefault, 'specify')).toBe('proposal');
    expect(phaseAlias(openspecDefault, 'verify')).toBe('verify');
  });
});

describe('validateTrackShape', () => {
  it('rejects skipping a mandatory phase', () => {
    const bad = { ...openspecDefault, phases: { ...openspecDefault.phases, verify: 'skipped' as const } };
    expect(validateTrackShape(bad)).toContain('phase verify is mandatory and cannot be skipped');
  });
  it('rejects a gate on a non-adjacent or backward edge', () => {
    const bad = { ...openspecDefault, gates: [{ transition: 'specify->verify', artifacts: [], checks: [] }] };
    expect(validateTrackShape(bad)).toContain('gate transition specify->verify is not a forward edge of this track (expected specify->implement)');
  });
  it('accepts the archive edge', () => {
    const ok = { ...openspecDefault, gates: [{ transition: 'integrate->archived', artifacts: [], checks: [] }] };
    expect(validateTrackShape(ok)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/lifecycle/track.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/lifecycle/track.ts**

```ts
import { z } from 'zod';
import { PHASES, type GateDecl, type Phase, type PhaseMapping, type PhaseOrArchived, type TrackDecl } from '../domain/types.js';

const PhaseMappingSchema = z.object({
  alias: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  template: z.string().min(1).optional(),
});
const PhaseEntrySchema = z.union([z.literal('skipped'), PhaseMappingSchema]);

export const GateCheckDeclSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  severity: z.enum(['blocker', 'warning']).optional(),
});
export const GateDeclSchema = z.object({
  transition: z.string().regex(/^[a-z]+->[a-z]+$/),
  artifacts: z.array(z.string().min(1)).default([]),
  checks: z.array(GateCheckDeclSchema).default([]),
});

export const TrackDeclSchema = z.object({
  spec_review: z.enum(['required', 'deferred']).optional(),
  phases: z.object(Object.fromEntries(PHASES.map((p) => [p, PhaseEntrySchema])) as Record<Phase, typeof PhaseEntrySchema>),
  gates: z.array(GateDeclSchema).default([]),
});
export const TracksSchema = z.record(z.string().min(1), TrackDeclSchema);

export const MANDATORY_PHASES: Phase[] = ['specify', 'implement', 'verify', 'integrate'];

export function phaseOrder(track: TrackDecl): Phase[] {
  return PHASES.filter((p) => track.phases[p] !== 'skipped');
}

export function transitionKey(from: Phase, to: PhaseOrArchived): string {
  return `${from}->${to}`;
}

export function gateFor(track: TrackDecl, from: Phase, to: PhaseOrArchived): GateDecl | null {
  const key = transitionKey(from, to);
  return track.gates.find((g) => g.transition === key) ?? null;
}

export function phaseMapping(track: TrackDecl, phase: Phase): PhaseMapping {
  const entry = track.phases[phase];
  if (entry === 'skipped') throw new Error(`phase ${phase} is skipped in this track`);
  return entry;
}

export function phaseAlias(track: TrackDecl, phase: Phase): string {
  const entry = track.phases[phase];
  return entry === 'skipped' ? phase : entry.alias ?? phase;
}

export function validateTrackShape(track: TrackDecl): string[] {
  const errors: string[] = [];
  for (const p of MANDATORY_PHASES) {
    if (track.phases[p] === 'skipped') errors.push(`phase ${p} is mandatory and cannot be skipped`);
  }
  const order = phaseOrder(track);
  for (const gate of track.gates) {
    const [from, to] = gate.transition.split('->') as [string, string];
    const i = order.indexOf(from as Phase);
    if (i < 0) { errors.push(`gate transition ${gate.transition} starts from a phase that is skipped or unknown`); continue; }
    const expected = i === order.length - 1 ? 'archived' : order[i + 1]!;
    if (to !== expected) errors.push(`gate transition ${gate.transition} is not a forward edge of this track (expected ${from}->${expected})`);
  }
  return errors;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/lifecycle/track.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle/track.ts test/unit/lifecycle/track.test.ts
git commit -m "feat(lifecycle): track declaration schema, phase order and gate lookup"
```

### Task 17: Reachability, mandated approvals and failed-cycle rules

**Files:**
- Create: `src/lifecycle/reachability.ts`, `src/lifecycle/cycles.ts`
- Test: `test/unit/lifecycle/reachability.test.ts`, `test/unit/lifecycle/cycles.test.ts`

**Interfaces:**
- `allowedTargets(track, current: Phase): { forward: PhaseOrArchived[]; backward: Phase[] }`
- `classifyMove(track, current, target: string): 'forward' | 'backward' | null`
- `mandatesApproval(track, from: Phase, to: PhaseOrArchived, highRisk: boolean): boolean`
- `applyBackwardMove(state: { failed_cycles: number; status: 'active' | 'blocked' }, from: Phase, to: Phase, cycleFailed: boolean, reason: string): { failed_cycles: number; status: 'active' | 'blocked'; blocked_reason: string | null; blocked_now: boolean }`
- `MAX_FAILED_CYCLES = 3`

- [ ] **Step 1: Write the failing tests**

`test/unit/lifecycle/reachability.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { allowedTargets, classifyMove, mandatesApproval } from '../../../src/lifecycle/reachability.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const full: TrackDecl = {
  phases: { specify: {}, plan: {}, tasks: {}, implement: {}, verify: {}, integrate: {}, learn: {} }, gates: [],
};
const hotfix: TrackDecl = {
  spec_review: 'deferred',
  phases: { specify: {}, plan: 'skipped', tasks: 'skipped', implement: {}, verify: {}, integrate: {}, learn: {} }, gates: [],
};

describe('allowedTargets', () => {
  it('forward is the next non-skipped phase; backward is every earlier non-skipped phase', () => {
    expect(allowedTargets(hotfix, 'specify')).toEqual({ forward: ['implement'], backward: [] });
    expect(allowedTargets(hotfix, 'verify')).toEqual({ forward: ['integrate'], backward: ['specify', 'implement'] });
  });
  it('forward from the last phase is archived', () => {
    expect(allowedTargets(hotfix, 'learn').forward).toEqual(['archived']);
    expect(allowedTargets(full, 'learn').forward).toEqual(['archived']);
  });
});

describe('classifyMove', () => {
  it('classifies forward, backward and illegal', () => {
    expect(classifyMove(full, 'plan', 'tasks')).toBe('forward');
    expect(classifyMove(full, 'verify', 'implement')).toBe('backward');
    expect(classifyMove(full, 'specify', 'tasks')).toBeNull();
    expect(classifyMove(hotfix, 'specify', 'plan')).toBeNull();
    expect(classifyMove(full, 'learn', 'archived')).toBe('forward');
    expect(classifyMove(full, 'learn', 'nonsense')).toBeNull();
  });
});

describe('mandatesApproval', () => {
  it('mandates approval on the first forward move out of specify', () => {
    expect(mandatesApproval(full, 'specify', 'plan', false)).toBe(true);
    expect(mandatesApproval(full, 'plan', 'tasks', false)).toBe(false);
  });
  it('defers to the move out of verify when spec_review is deferred', () => {
    expect(mandatesApproval(hotfix, 'specify', 'implement', false)).toBe(false);
    expect(mandatesApproval(hotfix, 'verify', 'integrate', false)).toBe(true);
  });
  it('mandates approval out of verify when high risk', () => {
    expect(mandatesApproval(full, 'verify', 'integrate', true)).toBe(true);
    expect(mandatesApproval(full, 'verify', 'integrate', false)).toBe(false);
  });
});
```

`test/unit/lifecycle/cycles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyBackwardMove, MAX_FAILED_CYCLES } from '../../../src/lifecycle/cycles.js';

describe('applyBackwardMove', () => {
  it('increments failed_cycles on verify->implement with cycle_failed', () => {
    expect(applyBackwardMove({ failed_cycles: 0, status: 'active' }, 'verify', 'implement', true, 'tests red'))
      .toEqual({ failed_cycles: 1, status: 'active', blocked_reason: null, blocked_now: false });
  });
  it('blocks when the increment reaches the limit and keeps the reason', () => {
    expect(MAX_FAILED_CYCLES).toBe(3);
    expect(applyBackwardMove({ failed_cycles: 2, status: 'active' }, 'verify', 'implement', true, 'still red'))
      .toEqual({ failed_cycles: 3, status: 'blocked', blocked_reason: 'still red', blocked_now: true });
  });
  it('resets and unblocks on any other backward move', () => {
    expect(applyBackwardMove({ failed_cycles: 3, status: 'blocked' }, 'implement', 'specify', false, 'rethink'))
      .toEqual({ failed_cycles: 0, status: 'active', blocked_reason: null, blocked_now: false });
    expect(applyBackwardMove({ failed_cycles: 2, status: 'active' }, 'verify', 'implement', false, 'not a cycle'))
      .toEqual({ failed_cycles: 0, status: 'active', blocked_reason: null, blocked_now: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/lifecycle`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/lifecycle/reachability.ts**

```ts
import type { Phase, PhaseOrArchived, TrackDecl } from '../domain/types.js';
import { isPhase } from '../domain/phases.js';
import { phaseOrder } from './track.js';

export function allowedTargets(track: TrackDecl, current: Phase): { forward: PhaseOrArchived[]; backward: Phase[] } {
  const order = phaseOrder(track);
  const i = order.indexOf(current);
  if (i < 0) throw new Error(`phase ${current} is not part of this track`);
  const forward: PhaseOrArchived[] = [i === order.length - 1 ? 'archived' : order[i + 1]!];
  return { forward, backward: order.slice(0, i) };
}

export function classifyMove(track: TrackDecl, current: Phase, target: string): 'forward' | 'backward' | null {
  const { forward, backward } = allowedTargets(track, current);
  if ((forward as string[]).includes(target)) return 'forward';
  if (isPhase(target) && backward.includes(target)) return 'backward';
  return null;
}

export function mandatesApproval(track: TrackDecl, from: Phase, to: PhaseOrArchived, highRisk: boolean): boolean {
  const order = phaseOrder(track);
  const deferred = track.spec_review === 'deferred';
  const isFirstOutOfSpecify = from === 'specify' && order[1] === to;
  const isOutOfVerify = from === 'verify' && order[order.indexOf('verify') + 1] === to;
  if (!deferred && isFirstOutOfSpecify) return true;
  if (deferred && isOutOfVerify) return true;
  if (highRisk && isOutOfVerify) return true;
  return false;
}
```

- [ ] **Step 4: Implement src/lifecycle/cycles.ts**

```ts
import type { Phase } from '../domain/types.js';

export const MAX_FAILED_CYCLES = 3;

export interface CycleState { failed_cycles: number; status: 'active' | 'blocked' }
export interface CycleOutcome extends CycleState { blocked_reason: string | null; blocked_now: boolean }

export function isCycleMove(from: Phase, to: Phase): boolean {
  return from === 'verify' && to === 'implement';
}

export function applyBackwardMove(state: CycleState, from: Phase, to: Phase, cycleFailed: boolean, reason: string): CycleOutcome {
  if (isCycleMove(from, to) && cycleFailed) {
    const failed = state.failed_cycles + 1;
    if (failed >= MAX_FAILED_CYCLES) return { failed_cycles: failed, status: 'blocked', blocked_reason: reason, blocked_now: true };
    return { failed_cycles: failed, status: state.status, blocked_reason: null, blocked_now: false };
  }
  return { failed_cycles: 0, status: 'active', blocked_reason: null, blocked_now: false };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/unit/lifecycle`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle/reachability.ts src/lifecycle/cycles.ts test/unit/lifecycle
git commit -m "feat(lifecycle): reachability, mandated approvals and failed-cycle rules"
```

### Task 18: Phase instructions, next-gate text and slugs

**Files:**
- Create: `src/lifecycle/instructions.ts`, `src/lifecycle/slug.ts`
- Test: `test/unit/lifecycle/instructions.test.ts`, `test/unit/lifecycle/slug.test.ts`

**Interfaces:**
- `renderPhaseInstructions(input: { feature_id: string; framework: string; track: string | null; phase: Phase; track_decl: TrackDecl }): string` returns the text used in pack position 1 and as `next_instructions`. It always restates feature id, phase and alias (spec §10.3).
- `renderNextGate(track: TrackDecl, phase: Phase, highRisk: boolean): string` describes the next forward transition: target, artifacts required, checks, approval mandate. Used by pack position 6.
- `slugify(text: string, maxLength = 48): string`; `defaultFeatureSlug(taskDescription: string, externalRef: string | null): string` (prefix `external_ref` lowercased when present).

- [ ] **Step 1: Write the failing tests**

`test/unit/lifecycle/instructions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPhaseInstructions, renderNextGate } from '../../../src/lifecycle/instructions.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const track: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped', tasks: 'skipped', implement: { alias: 'apply' }, verify: {}, integrate: { alias: 'archive' }, learn: 'skipped',
  },
  gates: [{ transition: 'specify->implement', artifacts: ['proposal.md', 'spec.md'], checks: [
    { name: 'placeholder_scan' }, { name: 'required_sections', params: { artifact: 'proposal.md', sections: ['Why'] } },
  ] }],
};

describe('renderPhaseInstructions', () => {
  it('restates feature id, phase, alias and command', () => {
    const text = renderPhaseInstructions({ feature_id: 'f_1', framework: 'openspec', track: 'default', phase: 'specify', track_decl: track });
    expect(text).toContain('Feature: f_1');
    expect(text).toContain('Phase: specify (proposal)');
    expect(text).toContain('/openspec:proposal');
    expect(text).toContain('Keep the feature id f_1');
    expect(text).toContain('expected_phase: "specify"');
    expect(text).toContain('target_phase: "implement"');
  });
});

describe('renderNextGate', () => {
  it('lists artifacts, checks and the approval mandate', () => {
    const text = renderNextGate(track, 'specify', false);
    expect(text).toContain('Next gate: specify -> implement');
    expect(text).toContain('Artifacts: proposal.md, spec.md');
    expect(text).toContain('placeholder_scan');
    expect(text).toContain('required_sections (artifact=proposal.md, sections=Why)');
    expect(text).toContain('Human approval: required');
  });
  it('describes the archive edge', () => {
    expect(renderNextGate(track, 'integrate', false)).toContain('Next gate: integrate -> archived');
  });
});
```

`test/unit/lifecycle/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, defaultFeatureSlug } from '../../../src/lifecycle/slug.js';

describe('slugify', () => {
  it('lowercases, strips punctuation, collapses dashes and truncates', () => {
    expect(slugify('Add CSV export to the orders page!')).toBe('add-csv-export-to-the-orders-page');
    expect(slugify('  Ünïcode -- and   spaces ')).toBe('unicode-and-spaces');
    expect(slugify('a'.repeat(100))).toHaveLength(48);
  });
});

describe('defaultFeatureSlug', () => {
  it('prefixes the external ref', () => {
    expect(defaultFeatureSlug('Add CSV export', 'YAL-123')).toBe('yal-123-add-csv-export');
    expect(defaultFeatureSlug('Add CSV export', null)).toBe('add-csv-export');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/lifecycle`
Expected: FAIL on the two new files.

- [ ] **Step 3: Implement src/lifecycle/instructions.ts**

```ts
import type { Phase, TrackDecl } from '../domain/types.js';
import { allowedTargets, mandatesApproval } from './reachability.js';
import { gateFor, phaseAlias, phaseMapping } from './track.js';

export interface InstructionInput {
  feature_id: string;
  framework: string;
  track: string | null;
  phase: Phase;
  track_decl: TrackDecl;
}

export function renderPhaseInstructions(input: InstructionInput): string {
  const { feature_id, framework, track, phase, track_decl } = input;
  const mapping = phaseMapping(track_decl, phase);
  const alias = phaseAlias(track_decl, phase);
  const next = allowedTargets(track_decl, phase).forward[0]!;
  const gate = gateFor(track_decl, phase, next);
  const lines = [
    `Feature: ${feature_id}`,
    `Framework: ${framework}${track ? ` (track ${track})` : ''}`,
    `Phase: ${phase} (${alias})`,
    mapping.command ? `Command: ${mapping.command}` : null,
    `Produce the ${alias} artifacts following the phase template below.`,
    gate && gate.artifacts.length > 0
      ? `When done, call advance_phase with expected_phase: "${phase}", target_phase: "${next}" and artifacts: ${gate.artifacts.join(', ')}.`
      : `When done, call advance_phase with expected_phase: "${phase}", target_phase: "${next}".`,
    `Keep the feature id ${feature_id}; every later call needs it.`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export function renderNextGate(track: TrackDecl, phase: Phase, highRisk: boolean): string {
  const next = allowedTargets(track, phase).forward[0]!;
  const gate = gateFor(track, phase, next);
  const approval = mandatesApproval(track, phase, next, highRisk) || (gate?.checks.some((c) => c.name === 'human_approved') ?? false);
  const checks = (gate?.checks ?? []).map((c) => {
    const params = Object.entries(c.params ?? {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`);
    return params.length > 0 ? `${c.name} (${params.join(', ')})` : c.name;
  });
  return [
    `Next gate: ${phase} -> ${next}`,
    `Artifacts: ${gate && gate.artifacts.length > 0 ? gate.artifacts.join(', ') : 'none'}`,
    `Checks: ${checks.length > 0 ? checks.join('; ') : 'none'}`,
    `Human approval: ${approval ? 'required' : 'not required'}`,
    phase === 'verify' ? 'Evidence: required (tests, lint, security, files_changed)' : null,
  ].filter((l): l is string => l !== null).join('\n');
}
```

- [ ] **Step 4: Implement src/lifecycle/slug.ts**

```ts
export function slugify(text: string, maxLength = 48): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}

export function defaultFeatureSlug(taskDescription: string, externalRef: string | null): string {
  const base = slugify(taskDescription);
  return externalRef ? `${slugify(externalRef, 24)}-${base}`.slice(0, 64).replace(/-+$/g, '') : base;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/unit/lifecycle && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle test/unit/lifecycle
git commit -m "feat(lifecycle): phase instructions, next-gate text and slugs"
```

---

## Part E: Storage

Integration tests in this part need Postgres. Every integration test file starts with:

```ts
const url = process.env.SDD_TEST_DATABASE_URL;
describe.skipIf(!url)('...', () => { ... });
```

so unit-only runs stay green. Before running them: `npm run db:test:up` and `export SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test`.

### Task 19: Schema migration, pool, migration runner and test harness

**Files:**
- Create: `docker-compose.test.yml`, `migrations/1757462400000_init.js`, `src/db/pool.ts`, `src/db/migrate.ts`, `src/store/rows.ts`, `test/helpers/db.ts`
- Test: `test/integration/db/migrate.test.ts`

**Interfaces:**
- `src/db/pool.ts`: `Queryable` (anything with `query(text, values?)`), `createPool(databaseUrl): pg.Pool`, `withTransaction<T>(pool, fn: (q: pg.PoolClient) => Promise<T>): Promise<T>`.
- `src/db/migrate.ts`: `runMigrations(databaseUrl: string, log?: (msg: string) => void): Promise<void>`.
- `src/store/rows.ts`: row interfaces `AppRow`, `PolicyRow`, `FrameworkRow`, `EmbeddingConfigRow`, `FeatureRow`, `ContextPackRow`, `TransitionRow`, `ArtifactRow`, `KnowledgeItemRow`, `ChunkRow`, `ProposalRow` with column names exactly as the schema.
- `test/helpers/db.ts`: `getTestPool(): Promise<pg.Pool>` (migrates once per process), `truncateAll(pool)`, `closeTestPool()`.

- [ ] **Step 1: Create docker-compose.test.yml**

```yaml
services:
  postgres-test:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: sdd
      POSTGRES_PASSWORD: sdd
      POSTGRES_DB: sdd_test
    ports:
      - "55432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sdd -d sdd_test"]
      interval: 2s
      timeout: 5s
      retries: 20
```

- [ ] **Step 2: Write the failing integration test**

`test/integration/db/migrate.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getTestPool, closeTestPool } from '../../helpers/db.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('migrations', () => {
  afterAll(closeTestPool);

  it('creates every table and the extensions', async () => {
    const pool = await getTestPool();
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const t of ['apps', 'app_policies', 'frameworks', 'embedding_config', 'features', 'context_packs',
      'phase_transitions', 'feature_artifacts', 'knowledge_items', 'knowledge_chunks', 'proposals']) {
      expect(names).toContain(t);
    }
    const ext = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension`);
    expect(ext.rows.map((r) => r.extname)).toEqual(expect.arrayContaining(['vector', 'pg_trgm']));
  });

  it('is idempotent', async () => {
    const { runMigrations } = await import('../../../src/db/migrate.js');
    await expect(runMigrations(url!)).resolves.toBeUndefined();
  });

  it('has a 1024-dimension embedding column with an hnsw index', async () => {
    const pool = await getTestPool();
    const col = await pool.query(`SELECT format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'knowledge_chunks' AND a.attname = 'embedding'`);
    expect(col.rows[0].t).toBe('vector(1024)');
    const idx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'knowledge_chunks' AND indexdef ILIKE '%hnsw%'`);
    expect(idx.rows.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run db:test:up && SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/db`
Expected: FAIL, helper module not found.

- [ ] **Step 4: Create the migration**

`migrations/1757462400000_init.js`:

```js
export const shorthands = undefined;

const audit = `
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL`;

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS vector`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  pgm.sql(`CREATE TABLE apps (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    default_stack text[] NOT NULL DEFAULT '{}',
    compliance boolean NOT NULL DEFAULT false,
    token_budget integer,
    min_similarity real,
    stop_conditions text[] NOT NULL DEFAULT '{}',
    ${audit}
  )`);

  pgm.sql(`CREATE TABLE app_policies (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    version integer NOT NULL,
    policy jsonb NOT NULL,
    reason text NOT NULL,
    ${audit},
    UNIQUE (app_id, version)
  )`);

  pgm.sql(`CREATE TABLE frameworks (
    id text PRIMARY KEY,
    name text NOT NULL,
    pack_version text NOT NULL,
    tracks jsonb NOT NULL,
    gate_library_version text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
    ${audit},
    UNIQUE (name, pack_version)
  )`);

  pgm.sql(`CREATE TABLE embedding_config (
    id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
    provider text NOT NULL,
    model text NOT NULL,
    dimension integer NOT NULL,
    reindexed_at timestamptz,
    ${audit}
  )`);

  pgm.sql(`CREATE TABLE features (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    slug text NOT NULL,
    intent text NOT NULL,
    framework text NOT NULL,
    framework_pack_version text NOT NULL,
    track text,
    current_phase text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
    blocked_reason text,
    high_risk boolean NOT NULL DEFAULT false,
    failed_cycles integer NOT NULL DEFAULT 0,
    policy_version integer,
    policy_override_reason text,
    source_task text NOT NULL,
    external_ref text,
    trigger_ref text,
    decision jsonb NOT NULL,
    workspace jsonb,
    ${audit},
    UNIQUE (app_id, slug)
  )`);
  pgm.sql(`CREATE INDEX features_app_status_idx ON features (app_id, status)`);
  pgm.sql(`CREATE INDEX features_external_ref_idx ON features (external_ref)`);

  pgm.sql(`CREATE TABLE context_packs (
    id text PRIMARY KEY,
    feature_id text NOT NULL REFERENCES features(id),
    phase text NOT NULL,
    scope jsonb NOT NULL,
    focus text,
    items jsonb NOT NULL,
    rendered text NOT NULL,
    token_count integer NOT NULL,
    budget integer NOT NULL,
    degraded boolean NOT NULL DEFAULT false,
    over_budget boolean NOT NULL DEFAULT false,
    ${audit}
  )`);
  pgm.sql(`CREATE INDEX context_packs_feature_phase_idx ON context_packs (feature_id, phase, created_at DESC)`);

  pgm.sql(`CREATE TABLE phase_transitions (
    id text PRIMARY KEY,
    feature_id text NOT NULL REFERENCES features(id),
    from_phase text NOT NULL,
    to_phase text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('forward', 'backward')),
    result text NOT NULL CHECK (result IN ('pass', 'fail')),
    findings jsonb NOT NULL DEFAULT '[]',
    evidence jsonb,
    pack_id text REFERENCES context_packs(id),
    artifact_hashes jsonb NOT NULL DEFAULT '{}',
    human_approved boolean NOT NULL DEFAULT false,
    reason text,
    ${audit}
  )`);
  pgm.sql(`CREATE INDEX phase_transitions_feature_idx ON phase_transitions (feature_id, created_at)`);

  pgm.sql(`CREATE TABLE feature_artifacts (
    id text PRIMARY KEY,
    transition_id text NOT NULL REFERENCES phase_transitions(id),
    name text NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    content text,
    ${audit}
  )`);

  pgm.sql(`CREATE TABLE knowledge_items (
    id text PRIMARY KEY,
    stable_id text NOT NULL,
    version integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('framework_pack', 'standard', 'stack_guide', 'app_memory')),
    tier text NOT NULL CHECK (tier IN ('always_on', 'retrieved')),
    framework text,
    app_id text REFERENCES apps(id),
    memory_type text CHECK (memory_type IN ('adr', 'decision', 'constraint', 'incident')),
    human_id text,
    stack_tags text[] NOT NULL DEFAULT '{}',
    phase_tags text[] NOT NULL DEFAULT '{}',
    title text NOT NULL,
    body text NOT NULL,
    front_matter jsonb NOT NULL DEFAULT '{}',
    pack_name text NOT NULL,
    pack_version text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
    superseded_by text REFERENCES knowledge_items(id),
    deprecation_reason text,
    source_path text,
    source_hash text,
    source_url text,
    license text,
    ${audit},
    UNIQUE (stable_id, version)
  )`);
  pgm.sql(`CREATE INDEX knowledge_items_current_idx ON knowledge_items (stable_id) WHERE status = 'active' AND superseded_by IS NULL`);
  pgm.sql(`CREATE INDEX knowledge_items_pack_idx ON knowledge_items (pack_name, pack_version)`);
  pgm.sql(`CREATE INDEX knowledge_items_human_id_idx ON knowledge_items (human_id)`);
  pgm.sql(`CREATE INDEX knowledge_items_title_trgm ON knowledge_items USING gin (title gin_trgm_ops)`);

  pgm.sql(`CREATE TABLE knowledge_chunks (
    id text PRIMARY KEY,
    item_id text NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    heading_path text NOT NULL,
    text text NOT NULL,
    embedding vector(1024) NOT NULL,
    embedding_model text NOT NULL,
    token_count integer NOT NULL,
    tokenizer text NOT NULL,
    ${audit},
    UNIQUE (item_id, ordinal)
  )`);
  pgm.sql(`CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`);
  pgm.sql(`CREATE INDEX knowledge_chunks_text_trgm ON knowledge_chunks USING gin (text gin_trgm_ops)`);

  pgm.sql(`CREATE TABLE proposals (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    feature_id text NOT NULL REFERENCES features(id),
    payload jsonb NOT NULL,
    supersedes text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by text,
    review_reason text,
    ${audit}
  )`);
};

export const down = (pgm) => {
  for (const t of ['proposals', 'knowledge_chunks', 'knowledge_items', 'feature_artifacts', 'phase_transitions',
    'context_packs', 'features', 'embedding_config', 'frameworks', 'app_policies', 'apps']) {
    pgm.sql(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
};
```

- [ ] **Step 5: Create src/db/pool.ts and src/db/migrate.ts**

`src/db/pool.ts`:

```ts
import pg from 'pg';

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
```

`src/db/migrate.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export async function runMigrations(databaseUrl: string, log: (msg: string) => void = () => undefined): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log,
    logger: { info: log, warn: log, error: log, debug: () => undefined },
  });
}
```

- [ ] **Step 6: Create src/store/rows.ts**

```ts
import type { Decision, Finding, KnowledgeKind, MemoryType, Phase, Tier, Workspace } from '../domain/types.js';

interface Audit { created_at: Date; updated_at: Date; created_by: string }

export interface AppRow extends Audit {
  id: string; slug: string; name: string; default_stack: string[]; compliance: boolean;
  token_budget: number | null; min_similarity: number | null; stop_conditions: string[];
}
export interface PolicyRow extends Audit {
  id: string; app_id: string; version: number; policy: { framework: string | null; path_rules: { glob: string; framework: string }[]; risk_paths: string[] }; reason: string;
}
export interface FrameworkRow extends Audit {
  id: string; name: string; pack_version: string; tracks: Record<string, unknown>; gate_library_version: string; status: 'active' | 'deprecated';
}
export interface EmbeddingConfigRow extends Audit {
  id: 'singleton'; provider: string; model: string; dimension: number; reindexed_at: Date | null;
}
export interface FeatureRow extends Audit {
  id: string; app_id: string; slug: string; intent: string; framework: string; framework_pack_version: string; track: string | null;
  current_phase: Phase; status: 'active' | 'blocked' | 'archived'; blocked_reason: string | null; high_risk: boolean; failed_cycles: number;
  policy_version: number | null; policy_override_reason: string | null; source_task: string; external_ref: string | null; trigger_ref: string | null;
  decision: Decision; workspace: Workspace | null;
}
export interface ContextPackRow extends Audit {
  id: string; feature_id: string; phase: Phase; scope: unknown; focus: string | null; items: { stable_id: string; version: number }[];
  rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean;
}
export interface TransitionRow extends Audit {
  id: string; feature_id: string; from_phase: string; to_phase: string; direction: 'forward' | 'backward'; result: 'pass' | 'fail';
  findings: Finding[]; evidence: unknown | null; pack_id: string | null; artifact_hashes: Record<string, string>; human_approved: boolean; reason: string | null;
}
export interface ArtifactRow extends Audit {
  id: string; transition_id: string; name: string; sha256: string; byte_length: number; content: string | null;
}
export interface KnowledgeItemRow extends Audit {
  id: string; stable_id: string; version: number; kind: KnowledgeKind; tier: Tier; framework: string | null; app_id: string | null;
  memory_type: MemoryType | null; human_id: string | null; stack_tags: string[]; phase_tags: string[]; title: string; body: string;
  front_matter: Record<string, unknown>; pack_name: string; pack_version: string | null; status: 'active' | 'deprecated';
  superseded_by: string | null; deprecation_reason: string | null; source_path: string | null; source_hash: string | null;
  source_url: string | null; license: string | null;
}
export interface ChunkRow extends Audit {
  id: string; item_id: string; ordinal: number; heading_path: string; text: string; embedding_model: string; token_count: number; tokenizer: string;
}
export interface ProposalRow extends Audit {
  id: string; app_id: string; feature_id: string; payload: Record<string, unknown>; supersedes: string | null;
  status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; review_reason: string | null;
}
```

- [ ] **Step 7: Create test/helpers/db.ts**

```ts
import pg from 'pg';
import { createPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

let pool: pg.Pool | null = null;
let migrated = false;

export async function getTestPool(): Promise<pg.Pool> {
  const url = process.env.SDD_TEST_DATABASE_URL;
  if (!url) throw new Error('SDD_TEST_DATABASE_URL is not set');
  if (!migrated) { await runMigrations(url); migrated = true; }
  if (!pool) pool = createPool(url);
  return pool;
}

export async function truncateAll(p: pg.Pool): Promise<void> {
  await p.query(`TRUNCATE proposals, knowledge_chunks, knowledge_items, feature_artifacts, phase_transitions,
    context_packs, features, embedding_config, frameworks, app_policies, apps RESTART IDENTITY CASCADE`);
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = null;
}
```

- [ ] **Step 8: Run the integration test**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/db && npm run typecheck`
Expected: PASS (3 tests). If `pg.Pool` or `pg.PoolClient` is not assignable to `Queryable` because of its overloaded `query`, change the `values` parameter type in `Queryable` to `any[]`; the interface exists only so store functions accept either a pool or a transaction client.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.test.yml migrations src/db src/store/rows.ts test/helpers test/integration/db
git commit -m "feat(db): schema migration, pool, migration runner and test harness"
```

### Task 20: Store: apps and policies

**Files:**
- Create: `src/store/apps.ts`, `src/store/policies.ts`
- Test: `test/integration/store/apps.test.ts`

**Interfaces:**

```ts
// src/store/apps.ts
export async function getAppBySlug(q: Queryable, slug: string): Promise<AppRow | null>
export async function requireApp(q: Queryable, slug: string): Promise<AppRow>          // throws APP_NOT_FOUND
export async function createApp(q, input: { slug; name; compliance?: boolean; default_stack?: string[] }, actor: string): Promise<AppRow>
export async function updateApp(q, slug, patch: { default_stack?; token_budget?; min_similarity? }, actor): Promise<AppRow>
export async function addStopCondition(q, slug, text, actor): Promise<AppRow>
export async function listApps(q): Promise<(AppRow & { policy_version: number | null })[]>
// src/store/policies.ts
export async function currentPolicy(q, appId): Promise<PolicyRow | null>
export async function appendPolicy(q, appId, policy: Policy, reason: string, actor: string): Promise<PolicyRow>
export const PolicySchema: z.ZodType<Policy>   // framework nullable, path_rules default [], risk_paths default []
```

- [ ] **Step 1: Write the failing test**

`test/integration/store/apps.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp, getAppBySlug, requireApp, updateApp, addStopCondition, listApps } from '../../../src/store/apps.js';
import { appendPolicy, currentPolicy, PolicySchema } from '../../../src/store/policies.js';
import { DomainError } from '../../../src/errors.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('apps and policies', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('creates, reads and updates an app', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout', compliance: true }, 'daniel');
    expect(app.id).toMatch(/^a_/);
    expect(app.compliance).toBe(true);
    expect(app.created_by).toBe('daniel');
    const updated = await updateApp(pool, 'checkout', { default_stack: ['typescript', 'react'], token_budget: 5000, min_similarity: 0.4 }, 'daniel');
    expect(updated.default_stack).toEqual(['typescript', 'react']);
    expect(updated.token_budget).toBe(5000);
    expect(updated.min_similarity).toBeCloseTo(0.4);
    const withStop = await addStopCondition(pool, 'checkout', 'Never change tax rounding', 'daniel');
    expect(withStop.stop_conditions).toEqual(['Never change tax rounding']);
    expect((await getAppBySlug(pool, 'checkout'))?.slug).toBe('checkout');
    expect(await getAppBySlug(pool, 'nope')).toBeNull();
    await expect(requireApp(pool, 'nope')).rejects.toBeInstanceOf(DomainError);
  });

  it('appends policy versions and reads the current one', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'daniel');
    expect(await currentPolicy(pool, app.id)).toBeNull();
    const p1 = await appendPolicy(pool, app.id, PolicySchema.parse({ framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }] }), 'PCI', 'daniel');
    expect(p1.version).toBe(1);
    expect(p1.policy.risk_paths).toEqual([]);
    const p2 = await appendPolicy(pool, app.id, PolicySchema.parse({ framework: 'openspec' }), 'simplify', 'daniel');
    expect(p2.version).toBe(2);
    expect((await currentPolicy(pool, app.id))?.policy.framework).toBe('openspec');
    const list = await listApps(pool);
    expect(list[0]).toMatchObject({ slug: 'checkout', policy_version: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/apps.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/store/apps.ts**

```ts
import type { Queryable } from '../db/pool.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { AppRow } from './rows.js';

export async function getAppBySlug(q: Queryable, slug: string): Promise<AppRow | null> {
  const r = await q.query<AppRow>('SELECT * FROM apps WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}

export async function requireApp(q: Queryable, slug: string): Promise<AppRow> {
  const app = await getAppBySlug(q, slug);
  if (!app) throw new DomainError('APP_NOT_FOUND', `no app with slug "${slug}"`, { app: slug });
  return app;
}

export async function createApp(
  q: Queryable,
  input: { slug: string; name: string; compliance?: boolean; default_stack?: string[] },
  actor: string,
): Promise<AppRow> {
  const r = await q.query<AppRow>(
    `INSERT INTO apps (id, slug, name, compliance, default_stack, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [newId('a'), input.slug, input.name, input.compliance ?? false, input.default_stack ?? [], actor],
  );
  return r.rows[0]!;
}

export async function updateApp(
  q: Queryable,
  slug: string,
  patch: { default_stack?: string[]; token_budget?: number | null; min_similarity?: number | null },
  actor: string,
): Promise<AppRow> {
  await requireApp(q, slug);
  const r = await q.query<AppRow>(
    `UPDATE apps SET
       default_stack = COALESCE($2::text[], default_stack),
       token_budget = CASE WHEN $3::boolean THEN $4::int ELSE token_budget END,
       min_similarity = CASE WHEN $5::boolean THEN $6::real ELSE min_similarity END,
       updated_at = now()
     WHERE slug = $1 RETURNING *`,
    [slug, patch.default_stack ?? null, 'token_budget' in patch, patch.token_budget ?? null, 'min_similarity' in patch, patch.min_similarity ?? null],
  );
  void actor;
  return r.rows[0]!;
}

export async function addStopCondition(q: Queryable, slug: string, text: string, actor: string): Promise<AppRow> {
  await requireApp(q, slug);
  const r = await q.query<AppRow>(
    `UPDATE apps SET stop_conditions = array_append(stop_conditions, $2), updated_at = now() WHERE slug = $1 RETURNING *`,
    [slug, text],
  );
  void actor;
  return r.rows[0]!;
}

export async function listApps(q: Queryable): Promise<(AppRow & { policy_version: number | null })[]> {
  const r = await q.query<AppRow & { policy_version: number | null }>(
    `SELECT a.*, (SELECT max(version) FROM app_policies p WHERE p.app_id = a.id) AS policy_version FROM apps a ORDER BY a.slug`,
  );
  return r.rows;
}
```

- [ ] **Step 4: Implement src/store/policies.ts**

```ts
import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import type { Policy } from '../domain/types.js';
import { newId } from '../ids.js';
import type { PolicyRow } from './rows.js';

export const PolicySchema: z.ZodType<Policy, z.ZodTypeDef, unknown> = z.object({
  framework: z.string().min(1).nullable().default(null),
  path_rules: z.array(z.object({ glob: z.string().min(1), framework: z.string().min(1) })).default([]),
  risk_paths: z.array(z.string().min(1)).default([]),
});

export async function currentPolicy(q: Queryable, appId: string): Promise<PolicyRow | null> {
  const r = await q.query<PolicyRow>('SELECT * FROM app_policies WHERE app_id = $1 ORDER BY version DESC LIMIT 1', [appId]);
  return r.rows[0] ?? null;
}

export async function appendPolicy(q: Queryable, appId: string, policy: Policy, reason: string, actor: string): Promise<PolicyRow> {
  const r = await q.query<PolicyRow>(
    `INSERT INTO app_policies (id, app_id, version, policy, reason, created_by)
     VALUES ($1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM app_policies WHERE app_id = $2), $3, $4, $5) RETURNING *`,
    [newId('pol'), appId, JSON.stringify(policy), reason, actor],
  );
  return r.rows[0]!;
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/apps.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/apps.ts src/store/policies.ts test/integration/store/apps.test.ts
git commit -m "feat(store): apps and append-only policies"
```

### Task 21: Store: frameworks and embedding config

**Files:**
- Create: `src/store/frameworks.ts`, `src/store/embeddingConfig.ts`
- Test: `test/integration/store/frameworks.test.ts`

**Interfaces:**

```ts
// src/store/frameworks.ts
export async function upsertFramework(q, input: { name; pack_version; tracks: Record<string, TrackDecl>; gate_library_version }, actor): Promise<FrameworkRow>
export async function currentFramework(q, name): Promise<FrameworkRow | null>        // highest active pack_version (semver order)
export async function getFrameworkVersion(q, name, pack_version): Promise<FrameworkRow | null>
export async function listCurrentFrameworks(q): Promise<FrameworkRow[]>
export async function deprecateFramework(q, name, pack_version: string | null, reason, actor): Promise<number>   // rows updated
export function trackOf(row: FrameworkRow, track: string | null): TrackDecl     // parses with TrackDeclSchema; track null means 'default'; throws if absent
export function compareSemver(a: string, b: string): number
// src/store/embeddingConfig.ts
export async function getEmbeddingConfig(q): Promise<EmbeddingConfigRow | null>
export async function setEmbeddingConfig(q, cfg: { provider; model; dimension; reindexed?: boolean }, actor): Promise<EmbeddingConfigRow>
```

- [ ] **Step 1: Write the failing test**

`test/integration/store/frameworks.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { upsertFramework, currentFramework, listCurrentFrameworks, deprecateFramework, trackOf, compareSemver, getFrameworkVersion } from '../../../src/store/frameworks.js';
import { getEmbeddingConfig, setEmbeddingConfig } from '../../../src/store/embeddingConfig.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const track: TrackDecl = { phases: { specify: {}, plan: 'skipped', tasks: 'skipped', implement: {}, verify: {}, integrate: {}, learn: 'skipped' }, gates: [] };

describe.skipIf(!url)('frameworks', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('orders versions by semver and reports the current one', async () => {
    const pool = await getTestPool();
    await upsertFramework(pool, { name: 'openspec', pack_version: '1.9.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    await upsertFramework(pool, { name: 'openspec', pack_version: '1.10.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    expect((await currentFramework(pool, 'openspec'))?.pack_version).toBe('1.10.0');
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('re-upserting the same version replaces tracks', async () => {
    const pool = await getTestPool();
    await upsertFramework(pool, { name: 'x', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    await upsertFramework(pool, { name: 'x', pack_version: '1.0.0', tracks: { default: track, hotfix: track }, gate_library_version: '1' }, 'cli');
    const row = await getFrameworkVersion(pool, 'x', '1.0.0');
    expect(Object.keys(row!.tracks)).toEqual(['default', 'hotfix']);
    expect(trackOf(row!, null).phases.plan).toBe('skipped');
    expect(() => trackOf(row!, 'nope')).toThrow(/no track "nope"/);
  });

  it('deprecation removes a version or all versions from current', async () => {
    const pool = await getTestPool();
    await upsertFramework(pool, { name: 'kiro', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    await upsertFramework(pool, { name: 'kiro', pack_version: '1.1.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
    expect(await deprecateFramework(pool, 'kiro', '1.1.0', 'bad', 'cli')).toBe(1);
    expect((await currentFramework(pool, 'kiro'))?.pack_version).toBe('1.0.0');
    expect(await deprecateFramework(pool, 'kiro', null, 'unused', 'cli')).toBe(1);
    expect(await currentFramework(pool, 'kiro')).toBeNull();
    expect((await listCurrentFrameworks(pool)).map((f) => f.name)).toEqual([]);
  });
});

describe.skipIf(!url)('embedding config', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('is a single row that can be replaced', async () => {
    const pool = await getTestPool();
    expect(await getEmbeddingConfig(pool)).toBeNull();
    await setEmbeddingConfig(pool, { provider: 'fake', model: 'fake-1024', dimension: 1024 }, 'cli');
    const c = await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024, reindexed: true }, 'cli');
    expect(c.model).toBe('voyage-3.5');
    expect(c.reindexed_at).not.toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM embedding_config')).rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/frameworks.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/store/frameworks.ts**

```ts
import type { Queryable } from '../db/pool.js';
import type { TrackDecl } from '../domain/types.js';
import { newId } from '../ids.js';
import { TrackDeclSchema } from '../lifecycle/track.js';
import type { FrameworkRow } from './rows.js';

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function upsertFramework(
  q: Queryable,
  input: { name: string; pack_version: string; tracks: Record<string, TrackDecl>; gate_library_version: string },
  actor: string,
): Promise<FrameworkRow> {
  const r = await q.query<FrameworkRow>(
    `INSERT INTO frameworks (id, name, pack_version, tracks, gate_library_version, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)
     ON CONFLICT (name, pack_version) DO UPDATE SET tracks = EXCLUDED.tracks, gate_library_version = EXCLUDED.gate_library_version, updated_at = now()
     RETURNING *`,
    [newId('fw'), input.name, input.pack_version, JSON.stringify(input.tracks), input.gate_library_version, actor],
  );
  return r.rows[0]!;
}

export async function currentFramework(q: Queryable, name: string): Promise<FrameworkRow | null> {
  const r = await q.query<FrameworkRow>(`SELECT * FROM frameworks WHERE name = $1 AND status = 'active'`, [name]);
  const sorted = [...r.rows].sort((a, b) => compareSemver(b.pack_version, a.pack_version));
  return sorted[0] ?? null;
}

export async function getFrameworkVersion(q: Queryable, name: string, packVersion: string): Promise<FrameworkRow | null> {
  const r = await q.query<FrameworkRow>('SELECT * FROM frameworks WHERE name = $1 AND pack_version = $2', [name, packVersion]);
  return r.rows[0] ?? null;
}

export async function listCurrentFrameworks(q: Queryable): Promise<FrameworkRow[]> {
  const r = await q.query<FrameworkRow>(`SELECT * FROM frameworks WHERE status = 'active'`);
  const byName = new Map<string, FrameworkRow>();
  for (const row of r.rows) {
    const cur = byName.get(row.name);
    if (!cur || compareSemver(row.pack_version, cur.pack_version) > 0) byName.set(row.name, row);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function deprecateFramework(q: Queryable, name: string, packVersion: string | null, reason: string, actor: string): Promise<number> {
  void reason; void actor;
  const r = packVersion
    ? await q.query(`UPDATE frameworks SET status = 'deprecated', updated_at = now() WHERE name = $1 AND pack_version = $2 AND status = 'active'`, [name, packVersion])
    : await q.query(`UPDATE frameworks SET status = 'deprecated', updated_at = now() WHERE name = $1 AND status = 'active'`, [name]);
  return r.rowCount ?? 0;
}

export function trackOf(row: FrameworkRow, track: string | null): TrackDecl {
  const key = track ?? 'default';
  const raw = row.tracks[key];
  if (raw === undefined) throw new Error(`framework ${row.name}@${row.pack_version} has no track "${key}"`);
  return TrackDeclSchema.parse(raw) as TrackDecl;
}

export function trackNames(row: FrameworkRow): string[] {
  return Object.keys(row.tracks);
}
```

- [ ] **Step 4: Implement src/store/embeddingConfig.ts**

```ts
import type { Queryable } from '../db/pool.js';
import type { EmbeddingConfigRow } from './rows.js';

export async function getEmbeddingConfig(q: Queryable): Promise<EmbeddingConfigRow | null> {
  const r = await q.query<EmbeddingConfigRow>(`SELECT * FROM embedding_config WHERE id = 'singleton'`);
  return r.rows[0] ?? null;
}

export async function setEmbeddingConfig(
  q: Queryable,
  cfg: { provider: string; model: string; dimension: number; reindexed?: boolean },
  actor: string,
): Promise<EmbeddingConfigRow> {
  const r = await q.query<EmbeddingConfigRow>(
    `INSERT INTO embedding_config (id, provider, model, dimension, reindexed_at, created_by)
     VALUES ('singleton', $1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END, $5)
     ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model, dimension = EXCLUDED.dimension,
       reindexed_at = CASE WHEN $4 THEN now() ELSE embedding_config.reindexed_at END, updated_at = now()
     RETURNING *`,
    [cfg.provider, cfg.model, cfg.dimension, cfg.reindexed ?? false, actor],
  );
  return r.rows[0]!;
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/frameworks.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/frameworks.ts src/store/embeddingConfig.ts test/integration/store/frameworks.test.ts
git commit -m "feat(store): framework versions and embedding config"
```

### Task 22: Store: knowledge items and chunks

**Files:**
- Create: `src/store/knowledge.ts`, `src/store/chunks.ts`
- Test: `test/integration/store/knowledge.test.ts`

**Interfaces:**

```ts
// src/store/knowledge.ts
export interface NewKnowledgeItem {
  stable_id: string; kind: KnowledgeKind; tier: Tier; framework: string | null; app_id: string | null; memory_type: MemoryType | null;
  human_id: string | null; stack_tags: string[]; phase_tags: string[]; title: string; body: string; front_matter: Record<string, unknown>;
  pack_name: string; pack_version: string | null; source_path: string | null; source_hash: string | null; source_url: string | null; license: string | null;
}
export async function insertItemVersion(q, item: NewKnowledgeItem, actor): Promise<KnowledgeItemRow>   // version = current+1; marks previous current as superseded_by
export async function currentItem(q, stableId): Promise<KnowledgeItemRow | null>                       // active and not superseded
export async function latestItem(q, stableId): Promise<KnowledgeItemRow | null>                        // highest version regardless of status
export async function itemVersion(q, stableId, version): Promise<KnowledgeItemRow | null>
export async function itemById(q, id): Promise<KnowledgeItemRow | null>
export async function markSuperseded(q, id, byId): Promise<void>
export async function deprecateItem(q, stableId, successorStableId: string | null, reason, actor): Promise<KnowledgeItemRow>
export async function listAlwaysOn(q, appId: string | null): Promise<KnowledgeItemRow[]>              // company (app_id null) first, then app
export async function listActivePackItems(q, packName): Promise<KnowledgeItemRow[]>                    // current items of a pack
export async function listStackGuidePacks(q): Promise<{ pack_name: string; pack_version: string; stack_tags: string[] }[]>
export async function nextProposalSequence(q, appSlug, key: string): Promise<number>   // key is the memory_type, or 'standard'
// src/store/chunks.ts
export interface NewChunk { ordinal: number; heading_path: string; text: string; embedding: number[]; embedding_model: string; token_count: number; tokenizer: string }
export async function insertChunks(q, itemId, chunks: NewChunk[], actor): Promise<void>
export async function listChunkTexts(q): Promise<{ id: string; item_id: string; heading_path: string; text: string; title: string }[]>
export async function updateChunkEmbedding(q, chunkId, embedding: number[], model): Promise<void>
```

- [ ] **Step 1: Write the failing test**

`test/integration/store/knowledge.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp } from '../../../src/store/apps.js';
import { insertItemVersion, currentItem, itemVersion, deprecateItem, listAlwaysOn, listStackGuidePacks, nextProposalSequence, type NewKnowledgeItem } from '../../../src/store/knowledge.js';
import { insertChunks, listChunkTexts } from '../../../src/store/chunks.js';

const url = process.env.SDD_TEST_DATABASE_URL;

export function item(over: Partial<NewKnowledgeItem>): NewKnowledgeItem {
  return {
    stable_id: 'company.constitution', kind: 'standard', tier: 'always_on', framework: null, app_id: null, memory_type: null,
    human_id: null, stack_tags: [], phase_tags: [], title: 'Constitution', body: '- Rule (reason)', front_matter: {},
    pack_name: 'company', pack_version: '1.0.0', source_path: 'constitution.md', source_hash: 'h1', source_url: null, license: 'MIT', ...over,
  };
}

describe.skipIf(!url)('knowledge items', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('versions items and supersedes the previous current version', async () => {
    const pool = await getTestPool();
    const v1 = await insertItemVersion(pool, item({}), 'cli');
    expect(v1.version).toBe(1);
    const v2 = await insertItemVersion(pool, item({ body: 'changed', source_hash: 'h2' }), 'cli');
    expect(v2.version).toBe(2);
    expect((await itemVersion(pool, 'company.constitution', 1))?.superseded_by).toBe(v2.id);
    expect((await currentItem(pool, 'company.constitution'))?.id).toBe(v2.id);
  });

  it('deprecates an item out of current but keeps it resolvable', async () => {
    const pool = await getTestPool();
    const v1 = await insertItemVersion(pool, item({}), 'cli');
    const d = await deprecateItem(pool, 'company.constitution', null, 'obsolete', 'cli');
    expect(d.id).toBe(v1.id);
    expect(d.status).toBe('deprecated');
    expect(await currentItem(pool, 'company.constitution')).toBeNull();
    expect((await itemVersion(pool, 'company.constitution', 1))?.deprecation_reason).toBe('obsolete');
  });

  it('lists always-on standards company first then app', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    await insertItemVersion(pool, item({ stable_id: 'checkout.steering', app_id: app.id, pack_name: 'checkout-steering' }), 'cli');
    await insertItemVersion(pool, item({}), 'cli');
    const rows = await listAlwaysOn(pool, app.id);
    expect(rows.map((r) => r.stable_id)).toEqual(['company.constitution', 'checkout.steering']);
    expect((await listAlwaysOn(pool, null)).map((r) => r.stable_id)).toEqual(['company.constitution']);
  });

  it('lists stack guide packs with their union of tags', async () => {
    const pool = await getTestPool();
    await insertItemVersion(pool, item({ stable_id: 'react.hooks', kind: 'stack_guide', tier: 'retrieved', pack_name: 'stack-guides/react', stack_tags: ['react'] }), 'cli');
    await insertItemVersion(pool, item({ stable_id: 'react.state', kind: 'stack_guide', tier: 'retrieved', pack_name: 'stack-guides/react', stack_tags: ['react', 'typescript'] }), 'cli');
    expect(await listStackGuidePacks(pool)).toEqual([{ pack_name: 'stack-guides/react', pack_version: '1.0.0', stack_tags: ['react', 'typescript'] }]);
  });

  it('computes the next proposal sequence per app and memory type', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    expect(await nextProposalSequence(pool, 'checkout', 'adr')).toBe(1);
    await insertItemVersion(pool, item({ stable_id: 'checkout.adr.0007', kind: 'app_memory', tier: 'retrieved', memory_type: 'adr', app_id: app.id, pack_name: 'proposals', pack_version: null }), 'cli');
    expect(await nextProposalSequence(pool, 'checkout', 'adr')).toBe(8);
  });
});

describe.skipIf(!url)('chunks', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('inserts and lists chunk texts with the item title', async () => {
    const pool = await getTestPool();
    const it1 = await insertItemVersion(pool, item({}), 'cli');
    const vec = new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    await insertChunks(pool, it1.id, [{ ordinal: 0, heading_path: 'Constitution', text: 'body', embedding: vec, embedding_model: 'fake-1024', token_count: 1, tokenizer: 'cl100k_base' }], 'cli');
    const rows = await listChunkTexts(pool);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_id: it1.id, title: 'Constitution', text: 'body' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/knowledge.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/store/knowledge.ts**

```ts
import type { Queryable } from '../db/pool.js';
import type { KnowledgeKind, MemoryType, Tier } from '../domain/types.js';
import { newId } from '../ids.js';
import type { KnowledgeItemRow } from './rows.js';

export interface NewKnowledgeItem {
  stable_id: string; kind: KnowledgeKind; tier: Tier; framework: string | null; app_id: string | null; memory_type: MemoryType | null;
  human_id: string | null; stack_tags: string[]; phase_tags: string[]; title: string; body: string; front_matter: Record<string, unknown>;
  pack_name: string; pack_version: string | null; source_path: string | null; source_hash: string | null; source_url: string | null; license: string | null;
}

export async function latestItem(q: Queryable, stableId: string): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>('SELECT * FROM knowledge_items WHERE stable_id = $1 ORDER BY version DESC LIMIT 1', [stableId]);
  return r.rows[0] ?? null;
}

export async function currentItem(q: Queryable, stableId: string): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items WHERE stable_id = $1 AND status = 'active' AND superseded_by IS NULL ORDER BY version DESC LIMIT 1`, [stableId]);
  return r.rows[0] ?? null;
}

export async function itemVersion(q: Queryable, stableId: string, version: number): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>('SELECT * FROM knowledge_items WHERE stable_id = $1 AND version = $2', [stableId, version]);
  return r.rows[0] ?? null;
}

export async function itemById(q: Queryable, id: string): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>('SELECT * FROM knowledge_items WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function markSuperseded(q: Queryable, id: string, byId: string): Promise<void> {
  await q.query('UPDATE knowledge_items SET superseded_by = $2, updated_at = now() WHERE id = $1', [id, byId]);
}

export async function insertItemVersion(q: Queryable, item: NewKnowledgeItem, actor: string): Promise<KnowledgeItemRow> {
  const previous = await latestItem(q, item.stable_id);
  const current = await currentItem(q, item.stable_id);
  const version = (previous?.version ?? 0) + 1;
  const r = await q.query<KnowledgeItemRow>(
    `INSERT INTO knowledge_items (id, stable_id, version, kind, tier, framework, app_id, memory_type, human_id, stack_tags, phase_tags,
       title, body, front_matter, pack_name, pack_version, source_path, source_hash, source_url, license, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
    [newId('k'), item.stable_id, version, item.kind, item.tier, item.framework, item.app_id, item.memory_type, item.human_id,
      item.stack_tags, item.phase_tags, item.title, item.body, JSON.stringify(item.front_matter), item.pack_name, item.pack_version,
      item.source_path, item.source_hash, item.source_url, item.license, actor],
  );
  const row = r.rows[0]!;
  if (current) await markSuperseded(q, current.id, row.id);
  return row;
}

export async function deprecateItem(q: Queryable, stableId: string, successorStableId: string | null, reason: string, actor: string): Promise<KnowledgeItemRow> {
  void actor;
  const current = await currentItem(q, stableId);
  if (!current) throw new Error(`no current item with stable_id "${stableId}"`);
  const successor = successorStableId ? await currentItem(q, successorStableId) : null;
  if (successorStableId && !successor) throw new Error(`no current item with stable_id "${successorStableId}" to use as successor`);
  const r = await q.query<KnowledgeItemRow>(
    `UPDATE knowledge_items SET status = 'deprecated', deprecation_reason = $2, superseded_by = COALESCE($3, superseded_by), updated_at = now() WHERE id = $1 RETURNING *`,
    [current.id, reason, successor?.id ?? null],
  );
  return r.rows[0]!;
}

export async function listAlwaysOn(q: Queryable, appId: string | null): Promise<KnowledgeItemRow[]> {
  const r = await q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items
     WHERE kind = 'standard' AND tier = 'always_on' AND status = 'active' AND superseded_by IS NULL
       AND (app_id IS NULL OR app_id = $1)
     ORDER BY (app_id IS NOT NULL), stable_id`,
    [appId],
  );
  return r.rows;
}

export async function listActivePackItems(q: Queryable, packName: string): Promise<KnowledgeItemRow[]> {
  const r = await q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items WHERE pack_name = $1 AND status = 'active' AND superseded_by IS NULL ORDER BY stable_id`, [packName]);
  return r.rows;
}

export async function listStackGuidePacks(q: Queryable): Promise<{ pack_name: string; pack_version: string; stack_tags: string[] }[]> {
  const r = await q.query<{ pack_name: string; pack_version: string; stack_tags: string[] }>(
    `SELECT pack_name, pack_version, array_agg(DISTINCT tag ORDER BY tag) AS stack_tags
     FROM knowledge_items, unnest(stack_tags) AS tag
     WHERE kind = 'stack_guide' AND status = 'active' AND superseded_by IS NULL
     GROUP BY pack_name, pack_version ORDER BY pack_name`,
  );
  return r.rows;
}

export async function nextProposalSequence(q: Queryable, appSlug: string, key: string): Promise<number> {
  const prefix = `${appSlug}.${key}.`;
  const r = await q.query<{ n: number | null }>(
    `SELECT max((substring(stable_id FROM length($1) + 1))::int) AS n FROM knowledge_items
     WHERE stable_id LIKE $1 || '%' AND substring(stable_id FROM length($1) + 1) ~ '^[0-9]+$'`,
    [prefix],
  );
  return (r.rows[0]?.n ?? 0) + 1;
}
```

- [ ] **Step 4: Implement src/store/chunks.ts**

```ts
import pgvector from 'pgvector/pg';
import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';

export interface NewChunk {
  ordinal: number; heading_path: string; text: string; embedding: number[]; embedding_model: string; token_count: number; tokenizer: string;
}

export async function insertChunks(q: Queryable, itemId: string, chunks: NewChunk[], actor: string): Promise<void> {
  for (const c of chunks) {
    await q.query(
      `INSERT INTO knowledge_chunks (id, item_id, ordinal, heading_path, text, embedding, embedding_model, token_count, tokenizer, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newId('c'), itemId, c.ordinal, c.heading_path, c.text, pgvector.toSql(c.embedding), c.embedding_model, c.token_count, c.tokenizer, actor],
    );
  }
}

export async function listChunkTexts(q: Queryable): Promise<{ id: string; item_id: string; heading_path: string; text: string; title: string }[]> {
  const r = await q.query<{ id: string; item_id: string; heading_path: string; text: string; title: string }>(
    `SELECT c.id, c.item_id, c.heading_path, c.text, i.title FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id ORDER BY c.item_id, c.ordinal`,
  );
  return r.rows;
}

export async function updateChunkEmbedding(q: Queryable, chunkId: string, embedding: number[], model: string): Promise<void> {
  await q.query('UPDATE knowledge_chunks SET embedding = $2, embedding_model = $3, updated_at = now() WHERE id = $1', [chunkId, pgvector.toSql(embedding), model]);
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/knowledge.test.ts && npm run typecheck`
Expected: PASS. If `pgvector/pg` has no type declarations under NodeNext, add `declare module 'pgvector/pg';` in `src/types/pgvector.d.ts` and include `src/**/*.d.ts` in tsconfig.

- [ ] **Step 6: Commit**

```bash
git add src/store/knowledge.ts src/store/chunks.ts test/integration/store/knowledge.test.ts
git commit -m "feat(store): versioned knowledge items and chunks"
```

### Task 23: Store: features, context packs, transitions, artifacts, proposals

**Files:**
- Create: `src/store/features.ts`, `src/store/packs.ts`, `src/store/transitions.ts`, `src/store/proposals.ts`
- Test: `test/integration/store/features.test.ts`

**Interfaces:**

```ts
// src/store/features.ts
export interface NewFeature { app_id; slug; intent; framework; framework_pack_version; track; high_risk; policy_version; policy_override_reason; source_task; external_ref; trigger_ref; decision: Decision; workspace: Workspace | null }
export async function createFeature(q, f: NewFeature, actor): Promise<FeatureRow>   // id f_..., current_phase 'specify'; slug collision appends -2, -3 ...
export async function getFeature(q, id, opts?: { forUpdate?: boolean }): Promise<FeatureRow | null>
export async function requireFeature(q, id, opts?): Promise<FeatureRow>               // throws FEATURE_NOT_FOUND
export async function updateFeature(q, id, patch: Partial<Pick<FeatureRow, 'current_phase'|'status'|'blocked_reason'|'failed_cycles'|'framework_pack_version'>>): Promise<FeatureRow>
export async function listFeatures(q, appId, statuses: FeatureStatus[], externalRef: string | null, limit: number): Promise<FeatureRow[]>
// src/store/packs.ts
export interface NewPack { feature_id; phase; scope; focus; items; rendered; token_count; budget; degraded; over_budget }
export async function insertPack(q, p: NewPack, actor): Promise<ContextPackRow>
export async function getPack(q, id): Promise<ContextPackRow | null>
export async function latestPack(q, featureId, phase): Promise<ContextPackRow | null>
export async function latestPackPerPhase(q, featureId): Promise<Record<string, string>>   // phase -> pack id
// src/store/transitions.ts
export interface NewTransition { feature_id; from_phase; to_phase; direction; result; findings; evidence; pack_id; artifact_hashes; human_approved; reason }
export async function insertTransition(q, t: NewTransition, actor): Promise<TransitionRow>
export async function insertArtifacts(q, transitionId, artifacts: Record<string, string>, actor): Promise<ArtifactRow[]>  // sha256, byte_length, content null when > 256 KB
export async function listTransitions(q, featureId): Promise<TransitionRow[]>
export const ARTIFACT_CONTENT_CAP = 256 * 1024
// src/store/proposals.ts
export async function insertProposal(q, p: { app_id; feature_id; payload; supersedes }, actor): Promise<ProposalRow>
export async function getProposal(q, id): Promise<ProposalRow | null>
export async function listProposals(q, status: 'pending'|'approved'|'rejected'|null): Promise<ProposalRow[]>
export async function reviewProposal(q, id, status: 'approved'|'rejected', reviewer, reason: string | null): Promise<ProposalRow>
```

- [ ] **Step 1: Write the failing test**

`test/integration/store/features.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp } from '../../../src/store/apps.js';
import { createFeature, getFeature, requireFeature, updateFeature, listFeatures, type NewFeature } from '../../../src/store/features.js';
import { insertPack, latestPack, latestPackPerPhase } from '../../../src/store/packs.js';
import { insertTransition, insertArtifacts, listTransitions, ARTIFACT_CONTENT_CAP } from '../../../src/store/transitions.js';
import { insertProposal, listProposals, reviewProposal } from '../../../src/store/proposals.js';
import { DomainError } from '../../../src/errors.js';

const url = process.env.SDD_TEST_DATABASE_URL;

export function newFeature(appId: string, over: Partial<NewFeature> = {}): NewFeature {
  return {
    app_id: appId, slug: 'csv-export', intent: 'feature', framework: 'openspec', framework_pack_version: '1.0.0', track: 'default',
    high_risk: false, policy_version: null, policy_override_reason: null, source_task: 'Add CSV export', external_ref: null, trigger_ref: null,
    decision: { intent: 'feature', framework: 'openspec', track: 'default', confidence: 'high', rule: '10-brownfield-small-medium', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' },
    workspace: null, ...over,
  };
}

describe.skipIf(!url)('features', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('creates in specify and disambiguates slug collisions', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f1 = await createFeature(pool, newFeature(app.id), 'daniel');
    const f2 = await createFeature(pool, newFeature(app.id), 'daniel');
    const f3 = await createFeature(pool, newFeature(app.id), 'daniel');
    expect(f1.id).toMatch(/^f_/);
    expect([f1.slug, f2.slug, f3.slug]).toEqual(['csv-export', 'csv-export-2', 'csv-export-3']);
    expect(f1.current_phase).toBe('specify');
    expect(f1.status).toBe('active');
    expect((await getFeature(pool, f1.id))?.decision.rule).toBe('10-brownfield-small-medium');
    await expect(requireFeature(pool, 'f_missing')).rejects.toMatchObject({ code: 'FEATURE_NOT_FOUND' } satisfies Partial<DomainError>);
  });

  it('updates state and lists by status and external ref', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f1 = await createFeature(pool, newFeature(app.id, { external_ref: 'YAL-1' }), 'daniel');
    const f2 = await createFeature(pool, newFeature(app.id, { slug: 'other' }), 'daniel');
    await updateFeature(pool, f2.id, { status: 'archived', current_phase: 'integrate' });
    await updateFeature(pool, f1.id, { status: 'blocked', blocked_reason: 'x', failed_cycles: 3 });
    expect((await listFeatures(pool, app.id, ['active', 'blocked'], null, 50)).map((f) => f.id)).toEqual([f1.id]);
    expect((await listFeatures(pool, app.id, ['archived'], null, 50)).map((f) => f.id)).toEqual([f2.id]);
    expect((await listFeatures(pool, app.id, ['active', 'blocked', 'archived'], 'YAL-1', 50)).map((f) => f.id)).toEqual([f1.id]);
  });

  it('records packs, transitions and artifacts', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f = await createFeature(pool, newFeature(app.id), 'daniel');
    const p1 = await insertPack(pool, { feature_id: f.id, phase: 'specify', scope: 'app', focus: null, items: [{ stable_id: 'a', version: 1 }], rendered: 'text', token_count: 1, budget: 6000, degraded: false, over_budget: false }, 'daniel');
    const p2 = await insertPack(pool, { feature_id: f.id, phase: 'specify', scope: 'app', focus: 'x', items: [], rendered: 'text2', token_count: 1, budget: 6000, degraded: true, over_budget: false }, 'prompt');
    expect((await latestPack(pool, f.id, 'specify'))?.id).toBe(p2.id);
    expect(await latestPackPerPhase(pool, f.id)).toEqual({ specify: p2.id });
    const t = await insertTransition(pool, { feature_id: f.id, from_phase: 'specify', to_phase: 'implement', direction: 'forward', result: 'fail', findings: [{ check: 'placeholder_scan', severity: 'blocker', location: 'a.md:1', message: 'marker TBD' }], evidence: null, pack_id: p1.id, artifact_hashes: { 'a.md': 'sha' }, human_approved: true, reason: null }, 'daniel');
    const big = 'x'.repeat(ARTIFACT_CONTENT_CAP + 1);
    const arts = await insertArtifacts(pool, t.id, { 'a.md': 'TBD', 'big.md': big }, 'daniel');
    expect(arts.find((a) => a.name === 'a.md')).toMatchObject({ byte_length: 3, content: 'TBD' });
    expect(arts.find((a) => a.name === 'big.md')).toMatchObject({ byte_length: ARTIFACT_CONTENT_CAP + 1, content: null });
    expect(arts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await listTransitions(pool, f.id)).map((x) => x.result)).toEqual(['fail']);
  });

  it('stores and reviews proposals', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'Checkout' }, 'cli');
    const f = await createFeature(pool, newFeature(app.id), 'daniel');
    const p = await insertProposal(pool, { app_id: app.id, feature_id: f.id, payload: { title: 'ADR-9 x', body: 'b', kind: 'app_memory', memory_type: 'adr' }, supersedes: null }, 'daniel');
    expect(p.status).toBe('pending');
    expect((await listProposals(pool, 'pending')).map((x) => x.id)).toEqual([p.id]);
    const r = await reviewProposal(pool, p.id, 'rejected', 'admin', 'dup');
    expect(r).toMatchObject({ status: 'rejected', reviewed_by: 'admin', review_reason: 'dup' });
    expect(await listProposals(pool, 'pending')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store/features.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/store/features.ts**

```ts
import type { Queryable } from '../db/pool.js';
import type { Decision, FeatureStatus, Workspace } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { FeatureRow } from './rows.js';

export interface NewFeature {
  app_id: string; slug: string; intent: string; framework: string; framework_pack_version: string; track: string | null;
  high_risk: boolean; policy_version: number | null; policy_override_reason: string | null; source_task: string;
  external_ref: string | null; trigger_ref: string | null; decision: Decision; workspace: Workspace | null;
}

async function freeSlug(q: Queryable, appId: string, base: string): Promise<string> {
  const r = await q.query<{ slug: string }>('SELECT slug FROM features WHERE app_id = $1 AND (slug = $2 OR slug LIKE $2 || \'-%\')', [appId, base]);
  const taken = new Set(r.rows.map((x) => x.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function createFeature(q: Queryable, f: NewFeature, actor: string): Promise<FeatureRow> {
  const slug = await freeSlug(q, f.app_id, f.slug);
  const r = await q.query<FeatureRow>(
    `INSERT INTO features (id, app_id, slug, intent, framework, framework_pack_version, track, current_phase, status, high_risk, failed_cycles,
       policy_version, policy_override_reason, source_task, external_ref, trigger_ref, decision, workspace, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'specify', 'active', $8, 0, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [newId('f'), f.app_id, slug, f.intent, f.framework, f.framework_pack_version, f.track, f.high_risk, f.policy_version,
      f.policy_override_reason, f.source_task, f.external_ref, f.trigger_ref, JSON.stringify(f.decision), f.workspace ? JSON.stringify(f.workspace) : null, actor],
  );
  return r.rows[0]!;
}

export async function getFeature(q: Queryable, id: string, opts: { forUpdate?: boolean } = {}): Promise<FeatureRow | null> {
  const r = await q.query<FeatureRow>(`SELECT * FROM features WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return r.rows[0] ?? null;
}

export async function requireFeature(q: Queryable, id: string, opts: { forUpdate?: boolean } = {}): Promise<FeatureRow> {
  const f = await getFeature(q, id, opts);
  if (!f) throw new DomainError('FEATURE_NOT_FOUND', `no feature with id "${id}"`, { feature_id: id });
  return f;
}

export async function updateFeature(
  q: Queryable,
  id: string,
  patch: Partial<Pick<FeatureRow, 'current_phase' | 'status' | 'blocked_reason' | 'failed_cycles' | 'framework_pack_version'>>,
): Promise<FeatureRow> {
  const sets: string[] = ['updated_at = now()'];
  const values: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    values.push(v);
    sets.push(`${k} = $${values.length}`);
  }
  const r = await q.query<FeatureRow>(`UPDATE features SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
  return r.rows[0]!;
}

export async function listFeatures(q: Queryable, appId: string, statuses: FeatureStatus[], externalRef: string | null, limit: number): Promise<FeatureRow[]> {
  const r = await q.query<FeatureRow>(
    `SELECT * FROM features WHERE app_id = $1 AND status = ANY($2) AND ($3::text IS NULL OR external_ref = $3) ORDER BY updated_at DESC LIMIT $4`,
    [appId, statuses, externalRef, limit],
  );
  return r.rows;
}
```

- [ ] **Step 4: Implement src/store/packs.ts, src/store/transitions.ts, src/store/proposals.ts**

`src/store/packs.ts`:

```ts
import type { Queryable } from '../db/pool.js';
import type { Phase, Scope } from '../domain/types.js';
import { newId } from '../ids.js';
import type { ContextPackRow } from './rows.js';

export interface NewPack {
  feature_id: string; phase: Phase; scope: Scope; focus: string | null; items: { stable_id: string; version: number }[];
  rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean;
}

export async function insertPack(q: Queryable, p: NewPack, actor: string): Promise<ContextPackRow> {
  const r = await q.query<ContextPackRow>(
    `INSERT INTO context_packs (id, feature_id, phase, scope, focus, items, rendered, token_count, budget, degraded, over_budget, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [newId('cp'), p.feature_id, p.phase, JSON.stringify(p.scope), p.focus, JSON.stringify(p.items), p.rendered, p.token_count, p.budget, p.degraded, p.over_budget, actor],
  );
  return r.rows[0]!;
}

export async function getPack(q: Queryable, id: string): Promise<ContextPackRow | null> {
  const r = await q.query<ContextPackRow>('SELECT * FROM context_packs WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function latestPack(q: Queryable, featureId: string, phase: Phase): Promise<ContextPackRow | null> {
  const r = await q.query<ContextPackRow>('SELECT * FROM context_packs WHERE feature_id = $1 AND phase = $2 ORDER BY created_at DESC, id DESC LIMIT 1', [featureId, phase]);
  return r.rows[0] ?? null;
}

export async function latestPackPerPhase(q: Queryable, featureId: string): Promise<Record<string, string>> {
  const r = await q.query<{ phase: string; id: string }>(
    'SELECT DISTINCT ON (phase) phase, id FROM context_packs WHERE feature_id = $1 ORDER BY phase, created_at DESC, id DESC', [featureId]);
  return Object.fromEntries(r.rows.map((x) => [x.phase, x.id]));
}
```

`src/store/transitions.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { Finding } from '../domain/types.js';
import { newId } from '../ids.js';
import type { ArtifactRow, TransitionRow } from './rows.js';

export const ARTIFACT_CONTENT_CAP = 256 * 1024;

export interface NewTransition {
  feature_id: string; from_phase: string; to_phase: string; direction: 'forward' | 'backward'; result: 'pass' | 'fail';
  findings: Finding[]; evidence: unknown | null; pack_id: string | null; artifact_hashes: Record<string, string>; human_approved: boolean; reason: string | null;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function insertTransition(q: Queryable, t: NewTransition, actor: string): Promise<TransitionRow> {
  const r = await q.query<TransitionRow>(
    `INSERT INTO phase_transitions (id, feature_id, from_phase, to_phase, direction, result, findings, evidence, pack_id, artifact_hashes, human_approved, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [newId('t'), t.feature_id, t.from_phase, t.to_phase, t.direction, t.result, JSON.stringify(t.findings), t.evidence == null ? null : JSON.stringify(t.evidence),
      t.pack_id, JSON.stringify(t.artifact_hashes), t.human_approved, t.reason, actor],
  );
  return r.rows[0]!;
}

export async function insertArtifacts(q: Queryable, transitionId: string, artifacts: Record<string, string>, actor: string): Promise<ArtifactRow[]> {
  const rows: ArtifactRow[] = [];
  for (const [name, content] of Object.entries(artifacts)) {
    const byteLength = Buffer.byteLength(content, 'utf8');
    const r = await q.query<ArtifactRow>(
      `INSERT INTO feature_artifacts (id, transition_id, name, sha256, byte_length, content, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [newId('fa'), transitionId, name, sha256(content), byteLength, byteLength > ARTIFACT_CONTENT_CAP ? null : content, actor],
    );
    rows.push(r.rows[0]!);
  }
  return rows;
}

export async function listTransitions(q: Queryable, featureId: string): Promise<TransitionRow[]> {
  const r = await q.query<TransitionRow>('SELECT * FROM phase_transitions WHERE feature_id = $1 ORDER BY created_at, id', [featureId]);
  return r.rows;
}
```

`src/store/proposals.ts`:

```ts
import type { Queryable } from '../db/pool.js';
import { newId } from '../ids.js';
import type { ProposalRow } from './rows.js';

export async function insertProposal(
  q: Queryable,
  p: { app_id: string; feature_id: string; payload: Record<string, unknown>; supersedes: string | null },
  actor: string,
): Promise<ProposalRow> {
  const r = await q.query<ProposalRow>(
    `INSERT INTO proposals (id, app_id, feature_id, payload, supersedes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [newId('p'), p.app_id, p.feature_id, JSON.stringify(p.payload), p.supersedes, actor],
  );
  return r.rows[0]!;
}

export async function getProposal(q: Queryable, id: string): Promise<ProposalRow | null> {
  const r = await q.query<ProposalRow>('SELECT * FROM proposals WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function listProposals(q: Queryable, status: 'pending' | 'approved' | 'rejected' | null): Promise<ProposalRow[]> {
  const r = await q.query<ProposalRow>('SELECT * FROM proposals WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at', [status]);
  return r.rows;
}

export async function reviewProposal(q: Queryable, id: string, status: 'approved' | 'rejected', reviewer: string, reason: string | null): Promise<ProposalRow> {
  const r = await q.query<ProposalRow>(
    `UPDATE proposals SET status = $2, reviewed_by = $3, review_reason = $4, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, reviewer, reason],
  );
  if (!r.rows[0]) throw new Error(`no proposal with id "${id}"`);
  return r.rows[0];
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/store && npm run typecheck`
Expected: PASS for all store tests.

- [ ] **Step 6: Commit**

```bash
git add src/store test/integration/store/features.test.ts
git commit -m "feat(store): features, context packs, transitions, artifacts and proposals"
```

---

## Part F: Embedding providers and retrieval

### Task 24: Embedding provider interface, fake, Voyage, Ollama, factory and mismatch check

**Files:**
- Create: `src/embedding/provider.ts`, `src/embedding/fake.ts`, `src/embedding/voyage.ts`, `src/embedding/ollama.ts`, `src/embedding/index.ts`
- Test: `test/unit/embedding/fake.test.ts`, `test/unit/embedding/remote.test.ts`, `test/integration/embedding/mismatch.test.ts`

**Interfaces:**

```ts
// src/embedding/provider.ts
export type InputType = 'document' | 'query';
export const EMBEDDING_DIMENSION = 1024;
export interface EmbeddingProvider {
  readonly provider: 'voyage' | 'ollama' | 'fake';
  readonly model: string;
  embed(texts: string[], inputType: InputType): Promise<number[][]>;   // throws on transport failure
  healthy(): Promise<boolean>;
}
// src/embedding/fake.ts
export class FakeEmbeddingProvider implements EmbeddingProvider   // deterministic hashed bag-of-words, unit length
// src/embedding/voyage.ts
export class VoyageEmbeddingProvider implements EmbeddingProvider  // constructor(model, apiKey, fetchImpl = fetch)
// src/embedding/ollama.ts
export class OllamaEmbeddingProvider implements EmbeddingProvider  // constructor(model, baseUrl, fetchImpl = fetch)
// src/embedding/index.ts
export function createEmbeddingProvider(cfg: Config['embedding'], fetchImpl?: typeof fetch): EmbeddingProvider
export async function assertEmbeddingConfigMatches(q: Queryable, provider: EmbeddingProvider): Promise<void>   // throws EMBEDDING_MODEL_MISMATCH
```

- [ ] **Step 1: Write the failing tests**

`test/unit/embedding/fake.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FakeEmbeddingProvider } from '../../../src/embedding/fake.js';
import { EMBEDDING_DIMENSION } from '../../../src/embedding/provider.js';

function cosine(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}

describe('FakeEmbeddingProvider', () => {
  const p = new FakeEmbeddingProvider();
  it('returns unit vectors of the fixed dimension, deterministically', async () => {
    const [a] = await p.embed(['csv export streaming'], 'document');
    const [b] = await p.embed(['csv export streaming'], 'query');
    expect(a).toHaveLength(EMBEDDING_DIMENSION);
    expect(a).toEqual(b);
    expect(Math.abs(cosine(a!, a!) - 1)).toBeLessThan(1e-6);
  });
  it('ranks similar text closer than unrelated text', async () => {
    const [q, near, far] = await p.embed(['csv export of orders', 'orders csv export streaming', 'kubernetes ingress tls'], 'document');
    expect(cosine(q!, near!)).toBeGreaterThan(cosine(q!, far!));
  });
  it('handles empty text', async () => {
    const [v] = await p.embed([''], 'document');
    expect(v).toHaveLength(EMBEDDING_DIMENSION);
  });
  it('is healthy', async () => {
    expect(await p.healthy()).toBe(true);
    expect(p.provider).toBe('fake');
    expect(p.model).toBe('fake-1024');
  });
});
```

`test/unit/embedding/remote.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { VoyageEmbeddingProvider } from '../../../src/embedding/voyage.js';
import { OllamaEmbeddingProvider } from '../../../src/embedding/ollama.js';
import { createEmbeddingProvider } from '../../../src/embedding/index.js';

const vec = () => new Array(1024).fill(0.1);

describe('VoyageEmbeddingProvider', () => {
  it('posts the documented payload with input_type and output_dimension', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ input: ['a', 'b'], model: 'voyage-3.5', input_type: 'query', output_dimension: 1024 });
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer key');
      return new Response(JSON.stringify({ data: [{ embedding: vec(), index: 0 }, { embedding: vec(), index: 1 }] }), { status: 200 });
    });
    const p = new VoyageEmbeddingProvider('voyage-3.5', 'key', fetchImpl as unknown as typeof fetch);
    const out = await p.embed(['a', 'b'], 'query');
    expect(out).toHaveLength(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.voyageai.com/v1/embeddings');
  });
  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const p = new VoyageEmbeddingProvider('voyage-3.5', 'key', fetchImpl as unknown as typeof fetch);
    await expect(p.embed(['a'], 'document')).rejects.toThrow(/voyage.*500/i);
    expect(await p.healthy()).toBe(false);
  });
  it('batches at 128 inputs', async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const n = JSON.parse(String(init?.body)).input.length;
      return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ embedding: vec(), index: i })) }), { status: 200 });
    });
    const p = new VoyageEmbeddingProvider('voyage-3.5', 'key', fetchImpl as unknown as typeof fetch);
    expect(await p.embed(Array.from({ length: 200 }, (_, i) => `t${i}`), 'document')).toHaveLength(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('OllamaEmbeddingProvider', () => {
  it('posts to /api/embed and validates the dimension', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://ollama:11434/api/embed');
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'bge-m3', input: ['a'] });
      return new Response(JSON.stringify({ embeddings: [vec()] }), { status: 200 });
    });
    const p = new OllamaEmbeddingProvider('bge-m3', 'http://ollama:11434', fetchImpl as unknown as typeof fetch);
    expect(await p.embed(['a'], 'document')).toHaveLength(1);
  });
  it('rejects a wrong dimension', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 }));
    const p = new OllamaEmbeddingProvider('bge-m3', 'http://ollama:11434', fetchImpl as unknown as typeof fetch);
    await expect(p.embed(['a'], 'document')).rejects.toThrow(/dimension 3, expected 1024/);
  });
});

describe('createEmbeddingProvider', () => {
  it('builds each provider from config', () => {
    expect(createEmbeddingProvider({ provider: 'fake', model: 'fake-1024', ollamaUrl: 'x' }).provider).toBe('fake');
    expect(createEmbeddingProvider({ provider: 'ollama', model: 'bge-m3', ollamaUrl: 'http://o' }).provider).toBe('ollama');
    expect(createEmbeddingProvider({ provider: 'voyage', model: 'voyage-3', voyageApiKey: 'k', ollamaUrl: 'x' }).provider).toBe('voyage');
  });
});
```

`test/integration/embedding/mismatch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { setEmbeddingConfig } from '../../../src/store/embeddingConfig.js';
import { assertEmbeddingConfigMatches } from '../../../src/embedding/index.js';
import { FakeEmbeddingProvider } from '../../../src/embedding/fake.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('assertEmbeddingConfigMatches', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('passes with no config or a matching config, fails on mismatch', async () => {
    const pool = await getTestPool();
    const fake = new FakeEmbeddingProvider();
    await expect(assertEmbeddingConfigMatches(pool, fake)).resolves.toBeUndefined();
    await setEmbeddingConfig(pool, { provider: 'fake', model: 'fake-1024', dimension: 1024 }, 'cli');
    await expect(assertEmbeddingConfigMatches(pool, fake)).resolves.toBeUndefined();
    await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024 }, 'cli');
    await expect(assertEmbeddingConfigMatches(pool, fake)).rejects.toMatchObject({ code: 'EMBEDDING_MODEL_MISMATCH', message: expect.stringContaining('sdd-admin reindex') });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/embedding`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement provider.ts and fake.ts**

`src/embedding/provider.ts`:

```ts
export type InputType = 'document' | 'query';
export const EMBEDDING_DIMENSION = 1024;

export interface EmbeddingProvider {
  readonly provider: 'voyage' | 'ollama' | 'fake';
  readonly model: string;
  embed(texts: string[], inputType: InputType): Promise<number[][]>;
  healthy(): Promise<boolean>;
}

export function assertDimension(vectors: number[][], provider: string): void {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSION) throw new Error(`${provider} returned an embedding of dimension ${v.length}, expected ${EMBEDDING_DIMENSION}`);
  }
}
```

`src/embedding/fake.ts`:

```ts
import { EMBEDDING_DIMENSION, type EmbeddingProvider, type InputType } from './provider.js';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function fakeEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) { v[0] = 1; return v; }
  for (let i = 0; i < words.length; i++) {
    v[fnv1a(words[i]!) % EMBEDDING_DIMENSION]! += 1;
    if (i + 1 < words.length) v[fnv1a(`${words[i]} ${words[i + 1]}`) % EMBEDDING_DIMENSION]! += 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'fake' as const;
  readonly model = 'fake-1024';
  async embed(texts: string[], _inputType: InputType): Promise<number[][]> {
    return texts.map(fakeEmbed);
  }
  async healthy(): Promise<boolean> { return true; }
}
```

- [ ] **Step 4: Implement voyage.ts and ollama.ts**

`src/embedding/voyage.ts`:

```ts
import { assertDimension, EMBEDDING_DIMENSION, type EmbeddingProvider, type InputType } from './provider.js';

const BATCH = 128;
const SUPPORTS_OUTPUT_DIMENSION = new Set(['voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3']);

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'voyage' as const;
  constructor(readonly model: string, private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async embed(texts: string[], inputType: InputType): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH);
      const body: Record<string, unknown> = { input, model: this.model, input_type: inputType };
      if (SUPPORTS_OUTPUT_DIMENSION.has(this.model)) body.output_dimension = EMBEDDING_DIMENSION;
      const res = await this.fetchImpl('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`voyage embeddings request failed with status ${res.status}`);
      const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      const sorted = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      assertDimension(sorted, 'voyage');
      out.push(...sorted);
    }
    return out;
  }

  async healthy(): Promise<boolean> {
    try { await this.embed(['ping'], 'query'); return true; } catch { return false; }
  }
}
```

`src/embedding/ollama.ts`:

```ts
import { assertDimension, type EmbeddingProvider, type InputType } from './provider.js';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'ollama' as const;
  constructor(readonly model: string, private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async embed(texts: string[], _inputType: InputType): Promise<number[][]> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`ollama embed request failed with status ${res.status}`);
    const json = (await res.json()) as { embeddings: number[][] };
    assertDimension(json.embeddings, 'ollama');
    return json.embeddings;
  }

  async healthy(): Promise<boolean> {
    try { await this.embed(['ping'], 'query'); return true; } catch { return false; }
  }
}
```

- [ ] **Step 5: Implement index.ts**

```ts
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { DomainError } from '../errors.js';
import { getEmbeddingConfig } from '../store/embeddingConfig.js';
import { FakeEmbeddingProvider } from './fake.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import type { EmbeddingProvider } from './provider.js';
import { VoyageEmbeddingProvider } from './voyage.js';

export function createEmbeddingProvider(cfg: Config['embedding'], fetchImpl: typeof fetch = fetch): EmbeddingProvider {
  switch (cfg.provider) {
    case 'fake': return new FakeEmbeddingProvider();
    case 'ollama': return new OllamaEmbeddingProvider(cfg.model, cfg.ollamaUrl, fetchImpl);
    case 'voyage': return new VoyageEmbeddingProvider(cfg.model, cfg.voyageApiKey ?? '', fetchImpl);
  }
}

export async function assertEmbeddingConfigMatches(q: Queryable, provider: EmbeddingProvider): Promise<void> {
  const stored = await getEmbeddingConfig(q);
  if (!stored) return;
  if (stored.provider !== provider.provider || stored.model !== provider.model) {
    throw new DomainError(
      'EMBEDDING_MODEL_MISMATCH',
      `configured embedding ${provider.provider}/${provider.model} differs from the indexed ${stored.provider}/${stored.model}; run "sdd-admin reindex"`,
      { configured: { provider: provider.provider, model: provider.model }, indexed: { provider: stored.provider, model: stored.model } },
    );
  }
}

export type { EmbeddingProvider } from './provider.js';
```

- [ ] **Step 6: Run all embedding tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/unit/embedding test/integration/embedding && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/embedding test/unit/embedding test/integration/embedding
git commit -m "feat(embedding): provider interface, fake, voyage, ollama and mismatch check"
```

### Task 25: Exact-id extraction and retrieval queries

**Files:**
- Create: `src/assembler/exactIds.ts`, `src/store/retrieval.ts`
- Test: `test/unit/assembler/exactIds.test.ts`, `test/integration/store/retrieval.test.ts`

**Interfaces:**

```ts
// src/assembler/exactIds.ts
export const EXACT_ID_PATTERN = /\b(ADR|REQ|US|INC)-\d+\b/g;
export function extractExactIds(...texts: (string | null | undefined)[]): string[]   // unique, order of appearance
// src/store/retrieval.ts
export interface RetrievalFilter {
  scope: 'company' | { appIds: string[] };
  framework: string | null;               // feature framework; null = no framework restriction
  frameworkPackVersion: string | null;
  phase: Phase | null;
  kinds: KnowledgeKind[];
  tier?: Tier | null;
  packNames?: string[] | null;
  excludeItemIds?: string[];
}
export interface RetrievedChunk {
  chunk_id: string; item_id: string; stable_id: string; version: number; app_id: string | null; kind: KnowledgeKind; memory_type: MemoryType | null;
  heading_path: string; text: string; token_count: number; score: number; match: 'vector' | 'exact_id';
}
export async function vectorSearch(q, embedding: number[], filter, opts: { candidates: number; minSimilarity: number }): Promise<RetrievedChunk[]>
export async function exactIdSearch(q, ids: string[], filter): Promise<RetrievedChunk[]>
export function mergeAndRank(exact: RetrievedChunk[], vector: RetrievedChunk[], limit: number): RetrievedChunk[]   // exact first, dedupe by item keeping best, top limit
```

- [ ] **Step 1: Write the failing tests**

`test/unit/assembler/exactIds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractExactIds } from '../../../src/assembler/exactIds.js';
import { mergeAndRank, type RetrievedChunk } from '../../../src/store/retrieval.js';

describe('extractExactIds', () => {
  it('finds ADR/REQ/US/INC ids across inputs, unique, in order', () => {
    expect(extractExactIds('see ADR-7 and REQ-12, again ADR-7', null, 'INC-204', 'US-2')).toEqual(['ADR-7', 'REQ-12', 'INC-204', 'US-2']);
  });
  it('ignores near misses', () => {
    expect(extractExactIds('ADR7 CVE-2026-1 xREQ-1')).toEqual([]);
  });
});

function chunk(over: Partial<RetrievedChunk>): RetrievedChunk {
  return { chunk_id: 'c', item_id: 'i', stable_id: 's', version: 1, app_id: null, kind: 'standard', memory_type: null, heading_path: 'h', text: 't', token_count: 1, score: 0.5, match: 'vector', ...over };
}

describe('mergeAndRank', () => {
  it('puts exact hits first, dedupes by item keeping the best, and limits', () => {
    const exact = [chunk({ chunk_id: 'e1', item_id: 'A', score: 1, match: 'exact_id' })];
    const vector = [
      chunk({ chunk_id: 'v1', item_id: 'A', score: 0.9 }),
      chunk({ chunk_id: 'v2', item_id: 'B', score: 0.7 }),
      chunk({ chunk_id: 'v3', item_id: 'B', score: 0.8 }),
      chunk({ chunk_id: 'v4', item_id: 'C', score: 0.6 }),
    ];
    const out = mergeAndRank(exact, vector, 2);
    expect(out.map((c) => c.chunk_id)).toEqual(['e1', 'v3']);
  });
});
```

`test/integration/store/retrieval.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp } from '../../../src/store/apps.js';
import { insertItemVersion, type NewKnowledgeItem } from '../../../src/store/knowledge.js';
import { insertChunks } from '../../../src/store/chunks.js';
import { vectorSearch, exactIdSearch, type RetrievalFilter } from '../../../src/store/retrieval.js';
import { fakeEmbed } from '../../../src/embedding/fake.js';
import { withTransaction } from '../../../src/db/pool.js';

const url = process.env.SDD_TEST_DATABASE_URL;

function item(over: Partial<NewKnowledgeItem>): NewKnowledgeItem {
  return {
    stable_id: 'x', kind: 'app_memory', tier: 'retrieved', framework: null, app_id: null, memory_type: 'adr', human_id: null, stack_tags: [], phase_tags: [],
    title: 'T', body: 'B', front_matter: {}, pack_name: 'proposals', pack_version: null, source_path: null, source_hash: null, source_url: null, license: null, ...over,
  };
}

async function seed(poolQ: Parameters<typeof insertItemVersion>[0], over: Partial<NewKnowledgeItem>, text: string) {
  const row = await insertItemVersion(poolQ, item(over), 'cli');
  await insertChunks(poolQ, row.id, [{ ordinal: 0, heading_path: over.title ?? 'T', text, embedding: fakeEmbed(`${over.title ?? 'T'} > ${text}`), embedding_model: 'fake-1024', token_count: 3, tokenizer: 'cl100k_base' }], 'cli');
  return row;
}

describe.skipIf(!url)('retrieval', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('filters by scope, framework, phase, kind, pinned pack version and superseded state', async () => {
    const pool = await getTestPool();
    const checkout = await createApp(pool, { slug: 'checkout', name: 'C' }, 'cli');
    const billing = await createApp(pool, { slug: 'billing', name: 'B' }, 'cli');
    const q = 'csv export streaming orders';
    await seed(pool, { stable_id: 'checkout.adr.0001', app_id: checkout.id, title: 'ADR-1 streaming exports', human_id: 'ADR-1' }, 'csv export streaming orders');
    await seed(pool, { stable_id: 'billing.adr.0001', app_id: billing.id, title: 'billing csv' }, 'csv export streaming orders invoices');
    await seed(pool, { stable_id: 'company.rule', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'exports' }, 'csv export streaming orders rule');
    await seed(pool, { stable_id: 'company.rule.old', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'exports old' }, 'csv export streaming orders rule');
    await seed(pool, { stable_id: 'company.rule.old', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', title: 'exports old v2' }, 'unrelated text about kubernetes');
    await seed(pool, { stable_id: 'openspec.guide', kind: 'framework_pack', memory_type: null, framework: 'openspec', pack_name: 'openspec', pack_version: '1.0.0', title: 'openspec csv' }, 'csv export streaming orders openspec');
    await seed(pool, { stable_id: 'openspec.guide', kind: 'framework_pack', memory_type: null, framework: 'openspec', pack_name: 'openspec', pack_version: '1.1.0', title: 'openspec csv v2' }, 'csv export streaming orders openspec v2');
    await seed(pool, { stable_id: 'speckit.guide', kind: 'framework_pack', memory_type: null, framework: 'spec-kit', pack_name: 'spec-kit', pack_version: '1.0.0', title: 'speckit csv' }, 'csv export streaming orders speckit');
    await seed(pool, { stable_id: 'company.plan-only', kind: 'standard', memory_type: null, pack_name: 'company', pack_version: '1.0.0', phase_tags: ['plan'], title: 'plan only' }, 'csv export streaming orders plan');

    const base: RetrievalFilter = { scope: { appIds: [checkout.id] }, framework: 'openspec', frameworkPackVersion: '1.0.0', phase: 'specify', kinds: ['app_memory', 'standard', 'framework_pack'] };
    const hits = await withTransaction(pool, (c) => vectorSearch(c, fakeEmbed(q), base, { candidates: 12, minSimilarity: 0.1 }));
    const ids = hits.map((h) => `${h.stable_id}@${h.version}`);
    expect(ids).toContain('checkout.adr.0001@1');
    expect(ids).toContain('company.rule@1');
    expect(ids).toContain('openspec.guide@1');          // pinned version, not 1.1.0
    expect(ids).not.toContain('openspec.guide@2');
    expect(ids).not.toContain('billing.adr.0001@1');    // other app
    expect(ids).not.toContain('company.rule.old@1');    // superseded
    expect(ids).not.toContain('speckit.guide@1');       // other framework
    expect(ids).not.toContain('company.plan-only@1');   // phase tag mismatch

    const company = await vectorSearch(pool, fakeEmbed(q), { ...base, scope: 'company' }, { candidates: 12, minSimilarity: 0.1 });
    expect(company.map((h) => h.stable_id)).not.toContain('checkout.adr.0001');

    const both = await vectorSearch(pool, fakeEmbed(q), { ...base, scope: { appIds: [checkout.id, billing.id] } }, { candidates: 12, minSimilarity: 0.1 });
    expect(both.map((h) => h.stable_id)).toContain('billing.adr.0001');

    const exact = await exactIdSearch(pool, ['ADR-1'], base);
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ stable_id: 'checkout.adr.0001', match: 'exact_id', score: 1 });

    const strict = await vectorSearch(pool, fakeEmbed('zzz qqq'), base, { candidates: 12, minSimilarity: 0.9 });
    expect(strict).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/assembler/exactIds.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/assembler/exactIds.ts**

```ts
export const EXACT_ID_PATTERN = /\b(ADR|REQ|US|INC)-\d+\b/g;

export function extractExactIds(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(EXACT_ID_PATTERN)) {
      if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
    }
  }
  return out;
}
```

- [ ] **Step 4: Implement src/store/retrieval.ts**

```ts
import pgvector from 'pgvector/pg';
import type { Queryable } from '../db/pool.js';
import type { KnowledgeKind, MemoryType, Phase, Tier } from '../domain/types.js';

export interface RetrievalFilter {
  scope: 'company' | { appIds: string[] };
  framework: string | null;
  frameworkPackVersion: string | null;
  phase: Phase | null;
  kinds: KnowledgeKind[];
  tier?: Tier | null;
  packNames?: string[] | null;
  excludeItemIds?: string[];
}

export interface RetrievedChunk {
  chunk_id: string; item_id: string; stable_id: string; version: number; app_id: string | null; kind: KnowledgeKind; memory_type: MemoryType | null;
  heading_path: string; text: string; token_count: number; score: number; match: 'vector' | 'exact_id';
}

const SELECT = `SELECT c.id AS chunk_id, c.item_id, i.stable_id, i.version, i.app_id, i.kind, i.memory_type, c.heading_path, c.text, c.token_count`;

function filterSql(f: RetrievalFilter, params: unknown[]): string {
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const clauses = [
    `i.status = 'active'`,
    `((i.kind <> 'framework_pack' AND i.superseded_by IS NULL) OR (i.kind = 'framework_pack' AND ` +
      (f.framework ? `i.pack_name = ${p(f.framework)} AND i.pack_version = ${p(f.frameworkPackVersion)}` : `i.superseded_by IS NULL`) + `))`,
    f.scope === 'company' ? `i.app_id IS NULL` : `(i.app_id IS NULL OR i.app_id = ANY(${p(f.scope.appIds)}))`,
    f.framework ? `(i.framework IS NULL OR i.framework = ${p(f.framework)})` : null,
    f.phase ? `(cardinality(i.phase_tags) = 0 OR ${p(f.phase)} = ANY(i.phase_tags))` : null,
    `i.kind = ANY(${p(f.kinds)})`,
    f.tier ? `i.tier = ${p(f.tier)}` : null,
    f.packNames ? `i.pack_name = ANY(${p(f.packNames)})` : null,
    f.excludeItemIds && f.excludeItemIds.length > 0 ? `NOT (i.id = ANY(${p(f.excludeItemIds)}))` : null,
  ];
  return clauses.filter((c): c is string => c !== null).join(' AND ');
}

export async function vectorSearch(
  q: Queryable, embedding: number[], filter: RetrievalFilter, opts: { candidates: number; minSimilarity: number },
): Promise<RetrievedChunk[]> {
  await q.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`).catch(() => undefined);
  const params: unknown[] = [pgvector.toSql(embedding)];
  const where = filterSql(filter, params);
  params.push(opts.candidates);
  const r = await q.query<RetrievedChunk & { score: number }>(
    `${SELECT}, 1 - (c.embedding <=> $1) AS score
     FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id
     WHERE ${where}
     ORDER BY c.embedding <=> $1
     LIMIT $${params.length}`,
    params,
  );
  return r.rows.filter((row) => row.score >= opts.minSimilarity).map((row) => ({ ...row, score: Number(row.score), match: 'vector' as const }));
}

export async function exactIdSearch(q: Queryable, ids: string[], filter: RetrievalFilter): Promise<RetrievedChunk[]> {
  if (ids.length === 0) return [];
  const params: unknown[] = [ids];
  const where = filterSql(filter, params);
  const r = await q.query<RetrievedChunk>(
    `${SELECT}
     FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id
     WHERE ${where} AND (
       i.human_id = ANY($1) OR i.stable_id = ANY($1)
       OR EXISTS (SELECT 1 FROM unnest($1::text[]) AS id WHERE i.title ILIKE '%' || id || '%' OR c.text ILIKE '%' || id || '%')
     )
     ORDER BY i.stable_id, c.ordinal`,
    params,
  );
  return r.rows.map((row) => ({ ...row, score: 1, match: 'exact_id' as const }));
}

export function mergeAndRank(exact: RetrievedChunk[], vector: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();
  for (const c of [...exact, ...vector]) {
    const cur = best.get(c.item_id);
    if (!cur || (cur.match === c.match && c.score > cur.score)) best.set(c.item_id, c);
  }
  return [...best.values()]
    .sort((a, b) => (a.match === b.match ? b.score - a.score : a.match === 'exact_id' ? -1 : 1))
    .slice(0, limit);
}
```

- [ ] **Step 5: Run all retrieval tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/unit/assembler test/integration/store/retrieval.test.ts && npm run typecheck`
Expected: PASS. If `SET LOCAL hnsw.iterative_scan` errors with "unrecognized configuration parameter", the pgvector image is older than 0.8; the `.catch` keeps the query working but note it in the commit message and upgrade the image tag.

- [ ] **Step 6: Commit**

```bash
git add src/assembler/exactIds.ts src/store/retrieval.ts test/unit/assembler test/integration/store/retrieval.test.ts
git commit -m "feat(retrieval): exact-id extraction, filtered vector search, exact-id search and ranking"
```

---

## Part G: Context assembler

### Task 26: Budget trimming and pack rendering (pure)

**Files:**
- Create: `src/assembler/budget.ts`, `src/assembler/render.ts`, `src/assembler/stopConditions.ts`
- Test: `test/unit/assembler/budget.test.ts`, `test/unit/assembler/render.test.ts`

**Interfaces:**

```ts
// src/assembler/stopConditions.ts
export const DEFAULT_STOP_CONDITIONS: string[]   // the four from Global Constraints
// src/assembler/budget.ts
export interface Budgetable { tokens: number; score: number }
export interface TrimResult<T> { retrieved: T[]; stack: T[]; over_budget: boolean; dropped_stack: number; dropped_retrieved: number }
export function trimToBudget<T extends Budgetable>(fixedTokens: number, retrieved: T[], stack: T[], budget: number): TrimResult<T>
// src/assembler/render.ts
export interface PackSections { header: string; alwaysOn: string; template: string; retrieved: string; stack: string; footer: string }
export function renderPack(s: PackSections): string
export function renderChunk(c: RetrievedChunk): string           // provenance wrapper
export function renderAlwaysOn(items: { stable_id: string; version: number; title: string; body: string }[]): string
export function renderStopConditions(appConditions: string[]): string
```

- [ ] **Step 1: Write the failing tests**

`test/unit/assembler/budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { trimToBudget } from '../../../src/assembler/budget.js';

const c = (tokens: number, score: number, id: string) => ({ tokens, score, id });

describe('trimToBudget', () => {
  it('keeps everything under budget', () => {
    const r = trimToBudget(100, [c(50, 0.9, 'r1')], [c(50, 0.5, 's1')], 300);
    expect(r).toMatchObject({ over_budget: false, dropped_stack: 0, dropped_retrieved: 0 });
    expect(r.retrieved.map((x) => x.id)).toEqual(['r1']);
  });
  it('drops stack chunks first, lowest score first', () => {
    const r = trimToBudget(100, [c(50, 0.9, 'r1')], [c(50, 0.7, 's1'), c(50, 0.4, 's2')], 210);
    expect(r.stack.map((x) => x.id)).toEqual(['s1']);
    expect(r.dropped_stack).toBe(1);
    expect(r.retrieved).toHaveLength(1);
  });
  it('then drops retrieved chunks lowest score first', () => {
    const r = trimToBudget(100, [c(50, 0.9, 'r1'), c(50, 0.6, 'r2')], [c(50, 0.7, 's1')], 160);
    expect(r.stack).toEqual([]);
    expect(r.retrieved.map((x) => x.id)).toEqual(['r1']);
    expect(r.dropped_retrieved).toBe(1);
  });
  it('flags over budget when fixed positions alone exceed it and keeps everything', () => {
    const r = trimToBudget(400, [c(10, 0.9, 'r1')], [c(10, 0.5, 's1')], 300);
    expect(r.over_budget).toBe(true);
    expect(r.retrieved).toHaveLength(1);
    expect(r.stack).toHaveLength(1);
  });
});
```

`test/unit/assembler/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPack, renderChunk, renderAlwaysOn, renderStopConditions } from '../../../src/assembler/render.js';
import { DEFAULT_STOP_CONDITIONS } from '../../../src/assembler/stopConditions.js';

describe('render', () => {
  it('orders the six positions with numbered headings', () => {
    const text = renderPack({ header: 'H', alwaysOn: 'A', template: 'T', retrieved: 'R', stack: 'S', footer: 'F' });
    const idx = ['## 1. Header', '## 2. Always-on standards', '## 3. Phase template', '## 4. Retrieved knowledge', '## 5. Stack guides', '## 6. Stop conditions and next gate'].map((h) => text.indexOf(h));
    expect(idx.every((i, n) => i >= 0 && (n === 0 || i > idx[n - 1]!))).toBe(true);
    expect(text.indexOf('H')).toBeLessThan(text.indexOf('A'));
  });
  it('wraps a chunk with provenance', () => {
    const t = renderChunk({ chunk_id: 'c', item_id: 'i', stable_id: 'checkout.adr.0007', version: 2, app_id: 'a', kind: 'app_memory', memory_type: 'adr', heading_path: 'ADR-7 > Rationale', text: 'body', token_count: 1, score: 0.8, match: 'vector' });
    expect(t).toBe('<retrieved id="checkout.adr.0007" version="2" path="ADR-7 > Rationale" match="vector">\nbody\n</retrieved>');
  });
  it('renders always-on items with id and version', () => {
    expect(renderAlwaysOn([{ stable_id: 'company.constitution', version: 1, title: 'Constitution', body: '- No PII in logs (GDPR)' }]))
      .toBe('### Constitution [company.constitution v1]\n- No PII in logs (GDPR)');
  });
  it('lists default then app stop conditions', () => {
    const t = renderStopConditions(['Never change tax rounding']);
    expect(DEFAULT_STOP_CONDITIONS).toHaveLength(4);
    expect(t.split('\n')).toEqual(['Stop and ask a human when:', ...DEFAULT_STOP_CONDITIONS.map((s) => `- ${s}`), '- Never change tax rounding']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/assembler`
Expected: FAIL on the new files.

- [ ] **Step 3: Implement the three modules**

`src/assembler/stopConditions.ts`:

```ts
export const DEFAULT_STOP_CONDITIONS: string[] = [
  'Ambiguity between valid approaches',
  'Three failed fix attempts',
  'Existing behaviour contradicts the acceptance criteria',
  'Irreversible data changes',
];
```

`src/assembler/budget.ts`:

```ts
export interface Budgetable { tokens: number; score: number }
export interface TrimResult<T> { retrieved: T[]; stack: T[]; over_budget: boolean; dropped_stack: number; dropped_retrieved: number }

function sum(xs: Budgetable[]): number { return xs.reduce((s, x) => s + x.tokens, 0); }

export function trimToBudget<T extends Budgetable>(fixedTokens: number, retrieved: T[], stack: T[], budget: number): TrimResult<T> {
  if (fixedTokens > budget) return { retrieved, stack, over_budget: true, dropped_stack: 0, dropped_retrieved: 0 };
  const keptStack = [...stack].sort((a, b) => b.score - a.score);
  const keptRetrieved = [...retrieved].sort((a, b) => b.score - a.score);
  let droppedStack = 0;
  let droppedRetrieved = 0;
  const total = () => fixedTokens + sum(keptRetrieved) + sum(keptStack);
  while (total() > budget && keptStack.length > 0) { keptStack.pop(); droppedStack++; }
  while (total() > budget && keptRetrieved.length > 0) { keptRetrieved.pop(); droppedRetrieved++; }
  const order = (orig: T[], kept: T[]) => orig.filter((x) => kept.includes(x));
  return { retrieved: order(retrieved, keptRetrieved), stack: order(stack, keptStack), over_budget: false, dropped_stack: droppedStack, dropped_retrieved: droppedRetrieved };
}
```

`src/assembler/render.ts`:

```ts
import type { RetrievedChunk } from '../store/retrieval.js';
import { DEFAULT_STOP_CONDITIONS } from './stopConditions.js';

export interface PackSections { header: string; alwaysOn: string; template: string; retrieved: string; stack: string; footer: string }

export function renderPack(s: PackSections): string {
  return [
    '# Context pack',
    '## 1. Header', s.header,
    '## 2. Always-on standards', s.alwaysOn || '(none)',
    '## 3. Phase template', s.template || '(none)',
    '## 4. Retrieved knowledge', s.retrieved || '(none)',
    '## 5. Stack guides', s.stack || '(none)',
    '## 6. Stop conditions and next gate', s.footer,
  ].join('\n\n');
}

function attr(v: string): string { return v.replace(/"/g, '&quot;'); }

export function renderChunk(c: RetrievedChunk): string {
  return `<retrieved id="${attr(c.stable_id)}" version="${c.version}" path="${attr(c.heading_path)}" match="${c.match}">\n${c.text}\n</retrieved>`;
}

export function renderAlwaysOn(items: { stable_id: string; version: number; title: string; body: string }[]): string {
  return items.map((i) => `### ${i.title} [${i.stable_id} v${i.version}]\n${i.body.trim()}`).join('\n\n');
}

export function renderStopConditions(appConditions: string[]): string {
  return ['Stop and ask a human when:', ...[...DEFAULT_STOP_CONDITIONS, ...appConditions].map((s) => `- ${s}`)].join('\n');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/assembler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assembler/budget.ts src/assembler/render.ts src/assembler/stopConditions.ts test/unit/assembler
git commit -m "feat(assembler): budget trimming, rendering and stop conditions"
```

### Task 27: Retrieval orchestration, attached layers, assembleContextPack and lite pack

**Files:**
- Create: `src/assembler/retrieve.ts`, `src/assembler/layers.ts`, `src/assembler/assemble.ts`, `src/assembler/lite.ts`
- Test: `test/integration/assembler/assemble.test.ts`

**Interfaces:**

```ts
// src/assembler/retrieve.ts
export interface RetrieveDeps { q: Queryable; embedder: EmbeddingProvider | null }
export interface RetrieveInput { query: string; ids: string[]; filter: RetrievalFilter; minSimilarity: number; limit?: number }   // limit default 8
export interface RetrieveResult { chunks: RetrievedChunk[]; degraded: boolean }
export async function retrieve(deps, input): Promise<RetrieveResult>     // embed query (input_type query); on embedder null or throw -> degraded, exact-id only
export const RETRIEVAL_CANDIDATES = 12; export const DEFAULT_MIN_SIMILARITY = 0.35; export const RETRIEVAL_LIMIT = 8;
// src/assembler/layers.ts
export async function attachedLayers(q, stack: string[]): Promise<{ layers: AttachedLayer[]; warnings: string[] }>   // quality-layer always (warning if not ingested) + stack-guide packs intersecting stack
export async function resolveScope(q, scope: Scope, app: AppRow): Promise<'company' | { appIds: string[] }>            // slug[] -> ids, APP_NOT_FOUND on unknown
// src/assembler/assemble.ts
export interface AssemblerDeps extends RetrieveDeps { defaultBudget: number }
export interface AssembleInput { feature: FeatureRow; app: AppRow; phase: Phase; focus: string | null; scope: Scope; createdBy: string }
export interface AssembledPack { pack: ContextPackRow; warnings: string[] }
export async function assembleContextPack(deps, input): Promise<AssembledPack>   // persists the pack
// src/assembler/lite.ts
export interface LitePack { rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean; items: { stable_id: string; version: number }[]; warnings: string[] }
export async function buildLitePack(deps: AssemblerDeps, input: { app: AppRow; taskDescription: string; stack: string[] }): Promise<LitePack>   // not persisted
```

- [ ] **Step 1: Write the failing integration test**

`test/integration/assembler/assemble.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { createApp, updateApp, addStopCondition } from '../../../src/store/apps.js';
import { upsertFramework } from '../../../src/store/frameworks.js';
import { insertItemVersion, type NewKnowledgeItem } from '../../../src/store/knowledge.js';
import { insertChunks } from '../../../src/store/chunks.js';
import { createFeature } from '../../../src/store/features.js';
import { FakeEmbeddingProvider, fakeEmbed } from '../../../src/embedding/fake.js';
import { assembleContextPack } from '../../../src/assembler/assemble.js';
import { buildLitePack } from '../../../src/assembler/lite.js';
import { attachedLayers } from '../../../src/assembler/layers.js';
import { countTokens } from '../../../src/tokens.js';
import type { TrackDecl } from '../../../src/domain/types.js';
import type pg from 'pg';

const url = process.env.SDD_TEST_DATABASE_URL;

const track: TrackDecl = {
  phases: {
    specify: { alias: 'proposal', command: '/openspec:proposal', template: 'openspec.template.proposal' },
    plan: 'skipped', tasks: 'skipped', implement: { alias: 'apply', template: 'openspec.template.apply' }, verify: { template: 'openspec.template.verify' },
    integrate: { alias: 'archive', template: 'openspec.template.archive' }, learn: 'skipped',
  },
  gates: [{ transition: 'specify->implement', artifacts: ['proposal.md'], checks: [{ name: 'placeholder_scan' }] }],
};

function item(over: Partial<NewKnowledgeItem>): NewKnowledgeItem {
  return { stable_id: 'x', kind: 'standard', tier: 'retrieved', framework: null, app_id: null, memory_type: null, human_id: null, stack_tags: [], phase_tags: [],
    title: 'T', body: 'B', front_matter: {}, pack_name: 'company', pack_version: '1.0.0', source_path: null, source_hash: null, source_url: null, license: null, ...over };
}

async function seed(pool: pg.Pool, over: Partial<NewKnowledgeItem>, chunkText = over.body ?? 'B') {
  const row = await insertItemVersion(pool, item(over), 'cli');
  await insertChunks(pool, row.id, [{ ordinal: 0, heading_path: over.title ?? 'T', text: chunkText, embedding: fakeEmbed(`${over.title} > ${chunkText}`), embedding_model: 'fake-1024', token_count: countTokens(chunkText), tokenizer: 'cl100k_base' }], 'cli');
  return row;
}

async function fixture(pool: pg.Pool) {
  const app = await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'cli');
  await addStopCondition(pool, 'checkout', 'Never change tax rounding', 'cli');
  await upsertFramework(pool, { name: 'openspec', pack_version: '1.0.0', tracks: { default: track }, gate_library_version: '1' }, 'cli');
  await seed(pool, { stable_id: 'company.constitution', tier: 'always_on', title: 'Constitution', body: '- No PII in logs (GDPR)' });
  await seed(pool, { stable_id: 'checkout.steering', tier: 'always_on', app_id: app.id, pack_name: 'checkout-steering', title: 'Steering', body: '- Exports go through reporting (ADR-7)' });
  await seed(pool, { stable_id: 'openspec.template.proposal', kind: 'framework_pack', framework: 'openspec', pack_name: 'openspec', phase_tags: ['specify'], title: 'Proposal template', body: '## Why\n## What Changes\n## Impact' });
  await seed(pool, { stable_id: 'openspec.guide.proposals', kind: 'framework_pack', framework: 'openspec', pack_name: 'openspec', phase_tags: ['specify'], title: 'Writing proposals', body: 'csv export orders proposal guidance' });
  await seed(pool, { stable_id: 'checkout.adr.0007', kind: 'app_memory', memory_type: 'adr', app_id: app.id, human_id: 'ADR-7', pack_name: 'proposals', pack_version: null, title: 'ADR-7 Exports go through the reporting service', body: 'exports reporting service decision' });
  await seed(pool, { stable_id: 'quality.tdd', pack_name: 'quality-layer', title: 'Test-driven development', body: 'csv export orders tests first' });
  await seed(pool, { stable_id: 'react.hooks', kind: 'stack_guide', pack_name: 'stack-guides/react', stack_tags: ['react'], title: 'Hooks', body: 'csv export orders hooks guidance' });
  await seed(pool, { stable_id: 'go.errors', kind: 'stack_guide', pack_name: 'stack-guides/go', stack_tags: ['go'], title: 'Errors', body: 'csv export orders go errors' });
  const feature = await createFeature(pool, {
    app_id: app.id, slug: 'csv-export', intent: 'feature', framework: 'openspec', framework_pack_version: '1.0.0', track: 'default', high_risk: false,
    policy_version: null, policy_override_reason: null, source_task: 'Add CSV export to the orders page', external_ref: null, trigger_ref: null,
    decision: { intent: 'feature', framework: 'openspec', track: 'default', confidence: 'high', rule: '10-brownfield-small-medium', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' },
    workspace: { stack: ['react'] },
  }, 'daniel');
  return { app, feature };
}

describe.skipIf(!url)('assembleContextPack', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('renders the six positions in order and persists the pack', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    const t = pack.rendered;
    expect(t.indexOf('Feature: ' + feature.id)).toBeGreaterThan(-1);
    expect(t.indexOf('Phase: specify (proposal)')).toBeLessThan(t.indexOf('## 2.'));
    expect(t.indexOf('[company.constitution v1]')).toBeLessThan(t.indexOf('[checkout.steering v1]'));
    expect(t.indexOf('## 3.')).toBeLessThan(t.indexOf('## Why'));
    expect(t).toContain('<retrieved id="checkout.adr.0007"');
    expect(t).toContain('<retrieved id="openspec.guide.proposals"');
    expect(t).toContain('<retrieved id="quality.tdd"');
    expect(t).not.toContain('<retrieved id="openspec.template.proposal"');   // template is position 3, not 4
    expect(t).toContain('<retrieved id="react.hooks"');
    expect(t).not.toContain('go.errors');
    expect(t).toContain('- Never change tax rounding');
    expect(t).toContain('Next gate: specify -> implement');
    expect(t).toContain('Artifacts: proposal.md');
    expect(pack.items).toEqual(expect.arrayContaining([{ stable_id: 'company.constitution', version: 1 }, { stable_id: 'openspec.template.proposal', version: 1 }, { stable_id: 'checkout.adr.0007', version: 1 }]));
    expect(pack.token_count).toBe(countTokens(t));
    expect(pack.degraded).toBe(false);
    expect(pack.over_budget).toBe(false);
    expect(pack.created_by).toBe('daniel');
    expect(warnings).toEqual([]);
  });

  it('ranks exact-id hits from focus, trigger_ref and external_ref first', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: 'kubernetes ingress ADR-7', scope: 'app', createdBy: 'daniel' });
    const pos4 = pack.rendered.slice(pack.rendered.indexOf('## 4.'), pack.rendered.indexOf('## 5.'));
    expect(pos4.indexOf('checkout.adr.0007')).toBeLessThan(pos4.indexOf('quality.tdd') === -1 ? Infinity : pos4.indexOf('quality.tdd'));
    expect(pos4).toContain('match="exact_id"');
  });

  it('trims stack guides first then retrieved knowledge, never the fixed positions', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    await updateApp(pool, 'checkout', { token_budget: 260 }, 'cli');
    const tightApp = { ...app, token_budget: 260 };
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app: tightApp, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    expect(pack.budget).toBe(260);
    expect(pack.rendered).not.toContain('react.hooks');
    expect(pack.rendered).toContain('[company.constitution v1]');
    expect(pack.rendered).toContain('## Why');
    expect(warnings.some((w) => /trimmed/.test(w))).toBe(true);
  });

  it('marks over_budget when fixed positions exceed the budget', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app: { ...app, token_budget: 50 }, phase: 'specify', focus: null, scope: 'app', createdBy: 'daniel' });
    expect(pack.over_budget).toBe(true);
    expect(warnings.some((w) => /over budget/.test(w))).toBe(true);
  });

  it('degrades without an embedder and still returns exact-id hits', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const { pack, warnings } = await assembleContextPack({ q: pool, embedder: null, defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: 'ADR-7', scope: 'app', createdBy: 'daniel' });
    expect(pack.degraded).toBe(true);
    expect(pack.rendered).toContain('checkout.adr.0007');
    expect(pack.rendered).not.toContain('quality.tdd');
    expect(warnings.some((w) => /degraded/.test(w))).toBe(true);
  });

  it('honours scope company and slug lists', async () => {
    const pool = await getTestPool();
    const { app, feature } = await fixture(pool);
    const billing = await createApp(pool, { slug: 'billing', name: 'B' }, 'cli');
    await seed(pool, { stable_id: 'billing.adr.0001', kind: 'app_memory', memory_type: 'adr', app_id: billing.id, pack_name: 'proposals', pack_version: null, title: 'billing csv export orders', body: 'csv export orders billing' });
    const company = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: 'company', createdBy: 'daniel' });
    expect(company.pack.rendered).not.toContain('checkout.adr.0007');
    expect(company.pack.rendered).toContain('[checkout.steering v1]');   // always-on is independent of scope
    const listed = await assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: ['billing'], createdBy: 'daniel' });
    expect(listed.pack.rendered).toContain('billing.adr.0001');
    await expect(assembleContextPack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { feature, app, phase: 'specify', focus: null, scope: ['nope'], createdBy: 'daniel' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });
});

describe.skipIf(!url)('attachedLayers and lite pack', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('attaches the quality layer and matching stack guides', async () => {
    const pool = await getTestPool();
    await fixture(pool);
    const { layers } = await attachedLayers(pool, ['react']);
    expect(layers).toEqual([
      { pack_name: 'quality-layer', pack_version: '1.0.0', kind: 'standard' },
      { pack_name: 'stack-guides/react', pack_version: '1.0.0', kind: 'stack_guide' },
    ]);
    const { layers: none, warnings } = await attachedLayers(pool, ['python']);
    expect(none.map((l) => l.pack_name)).toEqual(['quality-layer']);
    expect(warnings).toEqual([]);
  });

  it('builds a lite pack with always-on, stack guides and stop conditions only', async () => {
    const pool = await getTestPool();
    const { app } = await fixture(pool);
    const lite = await buildLitePack({ q: pool, embedder: new FakeEmbeddingProvider(), defaultBudget: 6000 }, { app, taskDescription: 'csv export orders hooks', stack: ['react'] });
    expect(lite.rendered).toContain('[company.constitution v1]');
    expect(lite.rendered).toContain('react.hooks');
    expect(lite.rendered).toContain('- Never change tax rounding');
    expect(lite.rendered).not.toContain('Next gate');
    expect(lite.rendered).not.toContain('checkout.adr.0007');
    expect(lite.token_count).toBe(countTokens(lite.rendered));
    expect((await pool.query('SELECT count(*)::int AS n FROM context_packs')).rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/assembler`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/assembler/retrieve.ts**

```ts
import type { Queryable } from '../db/pool.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { exactIdSearch, mergeAndRank, vectorSearch, type RetrievalFilter, type RetrievedChunk } from '../store/retrieval.js';

export const RETRIEVAL_CANDIDATES = 12;
export const DEFAULT_MIN_SIMILARITY = 0.35;
export const RETRIEVAL_LIMIT = 8;

export interface RetrieveDeps { q: Queryable; embedder: EmbeddingProvider | null }
export interface RetrieveInput { query: string; ids: string[]; filter: RetrievalFilter; minSimilarity: number; limit?: number }
export interface RetrieveResult { chunks: RetrievedChunk[]; degraded: boolean }

export async function retrieve(deps: RetrieveDeps, input: RetrieveInput): Promise<RetrieveResult> {
  const exact = await exactIdSearch(deps.q, input.ids, input.filter);
  let vector: RetrievedChunk[] = [];
  let degraded = false;
  if (deps.embedder && input.query.trim().length > 0) {
    try {
      const [embedding] = await deps.embedder.embed([input.query], 'query');
      vector = await vectorSearch(deps.q, embedding!, input.filter, { candidates: RETRIEVAL_CANDIDATES, minSimilarity: input.minSimilarity });
    } catch {
      degraded = true;
    }
  } else {
    degraded = true;
  }
  return { chunks: mergeAndRank(exact, vector, input.limit ?? RETRIEVAL_LIMIT), degraded };
}
```

- [ ] **Step 4: Implement src/assembler/layers.ts**

```ts
import type { Queryable } from '../db/pool.js';
import type { AttachedLayer, Scope } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { getAppBySlug } from '../store/apps.js';
import { listActivePackItems, listStackGuidePacks } from '../store/knowledge.js';
import type { AppRow } from '../store/rows.js';

export const QUALITY_LAYER_PACK = 'quality-layer';

export async function attachedLayers(q: Queryable, stack: string[]): Promise<{ layers: AttachedLayer[]; warnings: string[] }> {
  const layers: AttachedLayer[] = [];
  const warnings: string[] = [];
  const quality = await listActivePackItems(q, QUALITY_LAYER_PACK);
  if (quality.length > 0) layers.push({ pack_name: QUALITY_LAYER_PACK, pack_version: quality[0]!.pack_version ?? '0', kind: 'standard' });
  else warnings.push(`quality layer pack "${QUALITY_LAYER_PACK}" is not ingested`);
  const wanted = new Set(stack.map((s) => s.toLowerCase()));
  for (const pack of await listStackGuidePacks(q)) {
    if (pack.stack_tags.some((t) => wanted.has(t.toLowerCase()))) layers.push({ pack_name: pack.pack_name, pack_version: pack.pack_version, kind: 'stack_guide' });
  }
  return { layers, warnings };
}

export async function resolveScope(q: Queryable, scope: Scope, app: AppRow): Promise<'company' | { appIds: string[] }> {
  if (scope === 'company') return 'company';
  if (scope === 'app') return { appIds: [app.id] };
  const ids: string[] = [];
  for (const slug of scope) {
    const row = await getAppBySlug(q, slug);
    if (!row) throw new DomainError('APP_NOT_FOUND', `scope names unknown app "${slug}"`, { app: slug });
    ids.push(row.id);
  }
  return { appIds: ids };
}
```

- [ ] **Step 5: Implement src/assembler/assemble.ts**

```ts
import type { Phase, Scope } from '../domain/types.js';
import { renderNextGate, renderPhaseInstructions } from '../lifecycle/instructions.js';
import { phaseMapping } from '../lifecycle/track.js';
import { currentItem, listAlwaysOn } from '../store/knowledge.js';
import { insertPack } from '../store/packs.js';
import { getFrameworkVersion, trackOf } from '../store/frameworks.js';
import type { AppRow, ContextPackRow, FeatureRow, KnowledgeItemRow } from '../store/rows.js';
import type { RetrievedChunk } from '../store/retrieval.js';
import { countTokens } from '../tokens.js';
import { trimToBudget } from './budget.js';
import { extractExactIds } from './exactIds.js';
import { attachedLayers, resolveScope } from './layers.js';
import { renderAlwaysOn, renderChunk, renderPack, renderStopConditions } from './render.js';
import { DEFAULT_MIN_SIMILARITY, retrieve, type RetrieveDeps } from './retrieve.js';

export interface AssemblerDeps extends RetrieveDeps { defaultBudget: number }
export interface AssembleInput { feature: FeatureRow; app: AppRow; phase: Phase; focus: string | null; scope: Scope; createdBy: string }
export interface AssembledPack { pack: ContextPackRow; warnings: string[] }

interface Scored { chunk: RetrievedChunk; tokens: number; score: number }

async function pinnedTemplate(deps: AssemblerDeps, feature: FeatureRow, templateId: string | undefined): Promise<KnowledgeItemRow | null> {
  if (!templateId) return null;
  const r = await deps.q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items WHERE stable_id = $1 AND pack_name = $2 AND pack_version = $3 ORDER BY version DESC LIMIT 1`,
    [templateId, feature.framework, feature.framework_pack_version],
  );
  return r.rows[0] ?? (await currentItem(deps.q, templateId));
}

export async function assembleContextPack(deps: AssemblerDeps, input: AssembleInput): Promise<AssembledPack> {
  const { feature, app, phase, focus, scope, createdBy } = input;
  const warnings: string[] = [];
  const fw = await getFrameworkVersion(deps.q, feature.framework, feature.framework_pack_version);
  if (!fw) throw new Error(`pinned framework ${feature.framework}@${feature.framework_pack_version} is missing`);
  const track = trackOf(fw, feature.track);
  const mapping = phaseMapping(track, phase);
  const budget = app.token_budget ?? deps.defaultBudget;
  const minSimilarity = app.min_similarity ?? DEFAULT_MIN_SIMILARITY;
  const items: { stable_id: string; version: number }[] = [];

  // Position 1
  const header = renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase, track_decl: track });
  // Position 2 (independent of scope)
  const alwaysOn = await listAlwaysOn(deps.q, app.id);
  items.push(...alwaysOn.map((i) => ({ stable_id: i.stable_id, version: i.version })));
  // Position 3
  const template = await pinnedTemplate(deps, feature, mapping.template);
  if (mapping.template && !template) warnings.push(`phase template "${mapping.template}" not found for ${feature.framework}@${feature.framework_pack_version}`);
  if (template) items.push({ stable_id: template.stable_id, version: template.version });
  // Position 6
  const footer = `${renderStopConditions(app.stop_conditions)}\n\n${renderNextGate(track, phase, feature.high_risk)}`;

  const fixedText = renderPack({ header, alwaysOn: renderAlwaysOn(alwaysOn), template: template?.body ?? '', retrieved: '', stack: '', footer });
  const fixedTokens = countTokens(fixedText);

  // Positions 4 and 5
  const query = focus ?? feature.source_task;
  const ids = extractExactIds(query, feature.source_task, feature.trigger_ref, feature.external_ref);
  const resolved = await resolveScope(deps.q, scope, app);
  const { layers, warnings: layerWarnings } = await attachedLayers(deps.q, feature.workspace?.stack ?? app.default_stack);
  warnings.push(...layerWarnings);
  const stackPacks = layers.filter((l) => l.kind === 'stack_guide').map((l) => l.pack_name);

  const knowledge = await retrieve(deps, {
    query, ids, minSimilarity,
    filter: { scope: resolved, framework: feature.framework, frameworkPackVersion: feature.framework_pack_version, phase, kinds: ['app_memory', 'standard', 'framework_pack'], tier: null, excludeItemIds: template ? [template.id] : [] },
  });
  const guides = stackPacks.length === 0
    ? { chunks: [], degraded: knowledge.degraded }
    : await retrieve(deps, { query, ids, minSimilarity, filter: { scope: resolved, framework: feature.framework, frameworkPackVersion: feature.framework_pack_version, phase, kinds: ['stack_guide'], packNames: stackPacks } });
  const degraded = knowledge.degraded || guides.degraded;
  if (degraded) warnings.push('retrieval degraded: embedding provider unavailable, positions 4 and 5 built from exact-id matches only');

  const score = (c: RetrievedChunk): Scored => ({ chunk: c, tokens: countTokens(renderChunk(c)), score: c.match === 'exact_id' ? 2 : c.score });
  const trimmed = trimToBudget(fixedTokens, knowledge.chunks.map(score), guides.chunks.map(score), budget);
  if (trimmed.over_budget) warnings.push(`over budget: fixed positions use ${fixedTokens} tokens of ${budget}`);
  if (trimmed.dropped_stack + trimmed.dropped_retrieved > 0) warnings.push(`trimmed ${trimmed.dropped_stack} stack guide and ${trimmed.dropped_retrieved} retrieved chunk(s) to fit ${budget} tokens`);
  for (const s of [...trimmed.retrieved, ...trimmed.stack]) items.push({ stable_id: s.chunk.stable_id, version: s.chunk.version });

  const rendered = renderPack({
    header, alwaysOn: renderAlwaysOn(alwaysOn), template: template?.body ?? '',
    retrieved: trimmed.retrieved.map((s) => renderChunk(s.chunk)).join('\n\n'),
    stack: trimmed.stack.map((s) => renderChunk(s.chunk)).join('\n\n'),
    footer,
  });
  const pack = await insertPack(deps.q, {
    feature_id: feature.id, phase, scope, focus, items, rendered, token_count: countTokens(rendered), budget, degraded, over_budget: trimmed.over_budget,
  }, createdBy);
  return { pack, warnings };
}
```

- [ ] **Step 6: Implement src/assembler/lite.ts**

```ts
import { listAlwaysOn } from '../store/knowledge.js';
import type { AppRow } from '../store/rows.js';
import type { RetrievedChunk } from '../store/retrieval.js';
import { countTokens } from '../tokens.js';
import type { AssemblerDeps } from './assemble.js';
import { trimToBudget } from './budget.js';
import { extractExactIds } from './exactIds.js';
import { attachedLayers } from './layers.js';
import { renderAlwaysOn, renderChunk, renderStopConditions } from './render.js';
import { DEFAULT_MIN_SIMILARITY, retrieve } from './retrieve.js';

export interface LitePack {
  rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean;
  items: { stable_id: string; version: number }[]; warnings: string[];
}

export async function buildLitePack(deps: AssemblerDeps, input: { app: AppRow; taskDescription: string; stack: string[] }): Promise<LitePack> {
  const { app } = input;
  const warnings: string[] = [];
  const budget = app.token_budget ?? deps.defaultBudget;
  const alwaysOn = await listAlwaysOn(deps.q, app.id);
  const { layers, warnings: lw } = await attachedLayers(deps.q, input.stack.length > 0 ? input.stack : app.default_stack);
  warnings.push(...lw);
  const stackPacks = layers.filter((l) => l.kind === 'stack_guide').map((l) => l.pack_name);
  const fixed = `# Lite pack\n\n## Always-on standards\n\n${renderAlwaysOn(alwaysOn) || '(none)'}\n\n## Stack guides\n\n`;
  const footer = `\n\n## Stop conditions\n\n${renderStopConditions(app.stop_conditions)}`;
  const fixedTokens = countTokens(fixed + footer);
  const guides = stackPacks.length === 0
    ? { chunks: [] as RetrievedChunk[], degraded: false }
    : await retrieve(deps, { query: input.taskDescription, ids: extractExactIds(input.taskDescription), minSimilarity: app.min_similarity ?? DEFAULT_MIN_SIMILARITY,
        filter: { scope: { appIds: [app.id] }, framework: null, frameworkPackVersion: null, phase: null, kinds: ['stack_guide'], packNames: stackPacks } });
  if (guides.degraded) warnings.push('retrieval degraded: embedding provider unavailable');
  const scored = guides.chunks.map((c) => ({ chunk: c, tokens: countTokens(renderChunk(c)), score: c.score }));
  const trimmed = trimToBudget(fixedTokens, [], scored, budget);
  if (trimmed.over_budget) warnings.push(`over budget: always-on standards use ${fixedTokens} tokens of ${budget}`);
  const rendered = fixed + (trimmed.stack.map((s) => renderChunk(s.chunk)).join('\n\n') || '(none)') + footer;
  return {
    rendered, token_count: countTokens(rendered), budget, degraded: guides.degraded, over_budget: trimmed.over_budget,
    items: [...alwaysOn.map((i) => ({ stable_id: i.stable_id, version: i.version })), ...trimmed.stack.map((s) => ({ stable_id: s.chunk.stable_id, version: s.chunk.version }))],
    warnings,
  };
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/assembler && npm run typecheck`
Expected: PASS. If the trimming test does not drop `react.hooks`, lower the budget in the test until the fixed positions plus retrieved chunks exceed it but the fixed positions alone do not; print `fixedTokens` once to calibrate, then remove the print.

- [ ] **Step 8: Commit**

```bash
git add src/assembler test/integration/assembler
git commit -m "feat(assembler): retrieval orchestration, attached layers, context pack and lite pack"
```

---

## Part H: Ingestion and CLI

### Task 28: Pack schema and loader

**Files:**
- Create: `src/ingest/schema.ts`, `src/ingest/load.ts`, `test/fixtures/packs/mini-framework/pack.yaml`, `test/fixtures/packs/mini-framework/templates/proposal.md`, `test/fixtures/packs/mini-framework/templates/apply.md`, `test/fixtures/packs/mini-framework/guides/writing-proposals.md`, `test/fixtures/packs/mini-company/pack.yaml`, `test/fixtures/packs/mini-company/constitution.md`
- Test: `test/unit/ingest/load.test.ts`

**Interfaces:**

```ts
// src/ingest/schema.ts
export const PackManifestSchema   // name, kind, framework (null), version (semver), source_url, license, app (null), tracks (framework packs)
export type PackManifest = z.infer<typeof PackManifestSchema>
export const FrontMatterSchema    // id, kind?, tier (retrieved), framework?, app?, memory_type?, human_id?, phases ([]), stack_tags ([]), title, supersedes?
export type FrontMatter = z.infer<typeof FrontMatterSchema>
// src/ingest/load.ts
export interface LoadedItem { frontMatter: FrontMatter; body: string; sourcePath: string; sourceHash: string }
export interface LoadedPack { dir: string; manifest: PackManifest; items: LoadedItem[] }
export async function loadPack(dir: string): Promise<LoadedPack>   // pack.yaml + every *.md except README.md, recursively, sorted by path
export function effectiveKind(pack, item): KnowledgeKind; effectiveFramework(pack, item): string | null; effectiveApp(pack, item): string | null
```

- [ ] **Step 1: Create the fixture packs**

`test/fixtures/packs/mini-framework/pack.yaml`:

```yaml
name: mini
kind: framework_pack
framework: mini
version: 1.0.0
source_url: https://example.com/mini
license: MIT
tracks:
  default:
    phases:
      specify:   { alias: proposal, command: "/mini:proposal", template: mini.template.proposal }
      plan:      skipped
      tasks:     skipped
      implement: { alias: apply, template: mini.template.apply }
      verify:    { alias: verify }
      integrate: { alias: archive }
      learn:     skipped
    gates:
      - transition: specify->implement
        artifacts: [proposal.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: proposal.md, sections: [Why, What Changes] } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence }
```

`test/fixtures/packs/mini-framework/templates/proposal.md`:

```markdown
---
id: mini.template.proposal
phases: [specify]
title: Proposal template
---
## Why

State the problem in two sentences.

## What Changes

List each behaviour change.

## Impact

Affected code, data and users.
```

`test/fixtures/packs/mini-framework/templates/apply.md`:

```markdown
---
id: mini.template.apply
phases: [implement]
title: Apply template
---
## Steps

Work through tasks in order, tests first.
```

`test/fixtures/packs/mini-framework/guides/writing-proposals.md`:

```markdown
---
id: mini.guide.proposals
phases: [specify]
title: Writing good proposals
---
## Keep it short

A proposal fits on one screen.

## Rationale

Reviewers read the why before the what.
```

`test/fixtures/packs/mini-company/pack.yaml`:

```yaml
name: mini-company
kind: standard
version: 1.0.0
license: MIT
```

`test/fixtures/packs/mini-company/constitution.md`:

```markdown
---
id: mini-company.constitution
tier: always_on
title: Constitution
---
- No personal data in logs (GDPR fines are per incident)
- Every endpoint has a timeout (a hung upstream took checkout down in INC-12)
```

- [ ] **Step 2: Write the failing test**

`test/unit/ingest/load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack, effectiveKind, effectiveFramework } from '../../../src/ingest/load.js';
import { PackManifestSchema, FrontMatterSchema } from '../../../src/ingest/schema.js';

const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));

describe('loadPack', () => {
  it('loads the manifest and every markdown item with hashes', async () => {
    const pack = await loadPack(`${fixtures}mini-framework`);
    expect(pack.manifest.name).toBe('mini');
    expect(Object.keys(pack.manifest.tracks ?? {})).toEqual(['default']);
    expect(pack.items.map((i) => i.frontMatter.id)).toEqual(['mini.guide.proposals', 'mini.template.apply', 'mini.template.proposal']);
    const proposal = pack.items.find((i) => i.frontMatter.id === 'mini.template.proposal')!;
    expect(proposal.body.startsWith('## Why')).toBe(true);
    expect(proposal.sourcePath).toBe('templates/proposal.md');
    expect(proposal.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(effectiveKind(pack, proposal)).toBe('framework_pack');
    expect(effectiveFramework(pack, proposal)).toBe('mini');
  });
  it('applies front matter defaults', () => {
    const fm = FrontMatterSchema.parse({ id: 'x', title: 'X' });
    expect(fm).toMatchObject({ tier: 'retrieved', phases: [], stack_tags: [] });
  });
  it('rejects a manifest without a semver version', () => {
    expect(PackManifestSchema.safeParse({ name: 'x', kind: 'standard', version: 'v1' }).success).toBe(false);
  });
  it('fails clearly when pack.yaml is missing', async () => {
    await expect(loadPack(`${fixtures}nope`)).rejects.toThrow(/pack\.yaml/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/unit/ingest/load.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement src/ingest/schema.ts**

```ts
import { z } from 'zod';
import { PHASES } from '../domain/types.js';
import { TracksSchema } from '../lifecycle/track.js';

const KindSchema = z.enum(['framework_pack', 'standard', 'stack_guide', 'app_memory']);
const MemoryTypeSchema = z.enum(['adr', 'decision', 'constraint', 'incident']);

export const PackManifestSchema = z.object({
  name: z.string().min(1),
  kind: KindSchema,
  framework: z.string().min(1).nullable().default(null),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver x.y.z'),
  source_url: z.string().nullable().default(null),
  license: z.string().nullable().default(null),
  app: z.string().min(1).nullable().default(null),
  tracks: TracksSchema.optional(),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

export const FrontMatterSchema = z.object({
  id: z.string().min(1),
  kind: KindSchema.optional(),
  tier: z.enum(['always_on', 'retrieved']).default('retrieved'),
  framework: z.string().min(1).nullable().optional(),
  app: z.string().min(1).nullable().optional(),
  memory_type: MemoryTypeSchema.nullable().optional(),
  human_id: z.string().min(1).nullable().optional(),
  phases: z.array(z.enum(PHASES)).default([]),
  stack_tags: z.array(z.string().min(1)).default([]),
  title: z.string().min(1),
  supersedes: z.string().min(1).nullable().optional(),
});
export type FrontMatter = z.infer<typeof FrontMatterSchema>;
```

- [ ] **Step 5: Implement src/ingest/load.ts**

```ts
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import type { KnowledgeKind } from '../domain/types.js';
import { FrontMatterSchema, PackManifestSchema, type FrontMatter, type PackManifest } from './schema.js';

export interface LoadedItem { frontMatter: FrontMatter; body: string; sourcePath: string; sourceHash: string }
export interface LoadedPack { dir: string; manifest: PackManifest; items: LoadedItem[] }

async function markdownFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await markdownFiles(root, full)));
    else if (entry.endsWith('.md') && entry !== 'README.md') out.push(full);
  }
  return out.sort();
}

export async function loadPack(dir: string): Promise<LoadedPack> {
  const manifestPath = join(dir, 'pack.yaml');
  let raw: string;
  try { raw = await readFile(manifestPath, 'utf8'); } catch { throw new Error(`no pack.yaml found in ${dir}`); }
  const manifest = PackManifestSchema.parse(parseYaml(raw));
  const items: LoadedItem[] = [];
  for (const file of await markdownFiles(dir)) {
    const text = await readFile(file, 'utf8');
    const parsed = matter(text);
    const fm = FrontMatterSchema.safeParse(parsed.data);
    const sourcePath = relative(dir, file);
    if (!fm.success) throw new Error(`${sourcePath}: invalid front matter: ${fm.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    items.push({ frontMatter: fm.data, body: parsed.content.trim(), sourcePath, sourceHash: createHash('sha256').update(text, 'utf8').digest('hex') });
  }
  return { dir, manifest, items: items.sort((a, b) => a.frontMatter.id.localeCompare(b.frontMatter.id)) };
}

export function effectiveKind(pack: LoadedPack, item: LoadedItem): KnowledgeKind {
  return item.frontMatter.kind ?? pack.manifest.kind;
}
export function effectiveFramework(pack: LoadedPack, item: LoadedItem): string | null {
  return item.frontMatter.framework === undefined ? pack.manifest.framework : item.frontMatter.framework;
}
export function effectiveApp(pack: LoadedPack, item: LoadedItem): string | null {
  return item.frontMatter.app === undefined ? pack.manifest.app : item.frontMatter.app;
}
```

- [ ] **Step 6: Run test**

Run: `npx vitest run test/unit/ingest/load.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ingest/schema.ts src/ingest/load.ts test/fixtures/packs test/unit/ingest/load.test.ts
git commit -m "feat(ingest): pack manifest and front matter schemas, pack loader"
```

### Task 29: Pack validation rules

**Files:**
- Create: `src/ingest/validate.ts`
- Test: `test/unit/ingest/validate.test.ts`

**Interfaces:**
- `validatePack(pack: LoadedPack, ctx: { knownAppSlugs: Set<string> }): { errors: string[]; warnings: string[] }`
- Constants `ALWAYS_ON_WARN_TOKENS = 1200`, `TEMPLATE_WARN_TOKENS = 3000`.
- Errors (spec §12.4): duplicate ids; `always_on` item that is not a `standard`; `app_memory` without `app` or without `memory_type`; unknown app slug; framework pack without `tracks`; a track that does not map all seven phases or skips a mandatory one; gate naming an unknown check, invalid params, or an undeclared artifact; a phase `template` id absent from the pack; gate transition not a forward edge.

- [ ] **Step 1: Write the failing test**

`test/unit/ingest/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack, type LoadedPack } from '../../../src/ingest/load.js';
import { validatePack } from '../../../src/ingest/validate.js';

const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const ctx = { knownAppSlugs: new Set(['checkout']) };

function clone(p: LoadedPack): LoadedPack { return structuredClone(p); }

describe('validatePack', () => {
  it('accepts the fixture packs', async () => {
    expect(validatePack(await loadPack(`${fixtures}mini-framework`), ctx)).toEqual({ errors: [], warnings: [] });
    expect(validatePack(await loadPack(`${fixtures}mini-company`), ctx)).toEqual({ errors: [], warnings: [] });
  });
  it('rejects duplicate ids', async () => {
    const p = clone(await loadPack(`${fixtures}mini-framework`));
    p.items.push({ ...p.items[0]!, sourcePath: 'dup.md' });
    expect(validatePack(p, ctx).errors).toContain('duplicate id "mini.guide.proposals" (guides/writing-proposals.md, dup.md)');
  });
  it('rejects always_on on a non-standard, app_memory without app or memory_type, unknown app', async () => {
    const p = clone(await loadPack(`${fixtures}mini-framework`));
    p.items[0]!.frontMatter.tier = 'always_on';
    p.items[1]!.frontMatter.kind = 'app_memory';
    p.items[2]!.frontMatter.kind = 'app_memory';
    p.items[2]!.frontMatter.app = 'nope';
    p.items[2]!.frontMatter.memory_type = 'adr';
    const { errors } = validatePack(p, ctx);
    expect(errors).toContain('mini.guide.proposals: only standard items may be always_on');
    expect(errors).toContain('mini.template.apply: app_memory items require app');
    expect(errors).toContain('mini.template.apply: app_memory items require memory_type');
    expect(errors).toContain('mini.template.proposal: unknown app "nope"');
  });
  it('rejects framework packs with bad tracks', async () => {
    const p = clone(await loadPack(`${fixtures}mini-framework`));
    const track = p.manifest.tracks!.default!;
    track.phases.verify = 'skipped';
    track.gates[0]!.checks.push({ name: 'nope' });
    track.phases.implement = { alias: 'apply', template: 'mini.template.missing' };
    const { errors } = validatePack(p, ctx);
    expect(errors).toContain('track default: phase verify is mandatory and cannot be skipped');
    expect(errors).toContain('track default gate specify->implement: unknown check "nope"');
    expect(errors).toContain('track default: phase implement names template "mini.template.missing" which is not in this pack');
    const noTracks = clone(await loadPack(`${fixtures}mini-framework`));
    delete noTracks.manifest.tracks;
    expect(validatePack(noTracks, ctx).errors).toContain('framework packs must declare tracks');
  });
  it('warns on oversized always-on standards and templates', async () => {
    const p = clone(await loadPack(`${fixtures}mini-company`));
    p.items[0]!.body = 'word '.repeat(1300);
    expect(validatePack(p, ctx).warnings[0]).toMatch(/always-on standards for company total \d+ tokens, above 1200/);
    const f = clone(await loadPack(`${fixtures}mini-framework`));
    f.items.find((i) => i.frontMatter.id === 'mini.template.proposal')!.body = 'word '.repeat(3200);
    expect(validatePack(f, ctx).warnings[0]).toMatch(/template mini.template.proposal is \d+ tokens, above 3000/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/ingest/validate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/ingest/validate.ts**

```ts
import { PHASES, type TrackDecl } from '../domain/types.js';
import { validateGateDecl } from '../gates/library.js';
import { validateTrackShape } from '../lifecycle/track.js';
import { countTokens } from '../tokens.js';
import { effectiveApp, effectiveKind, type LoadedPack } from './load.js';

export const ALWAYS_ON_WARN_TOKENS = 1200;
export const TEMPLATE_WARN_TOKENS = 3000;

export function validatePack(pack: LoadedPack, ctx: { knownAppSlugs: Set<string> }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, string[]>();
  for (const item of pack.items) ids.set(item.frontMatter.id, [...(ids.get(item.frontMatter.id) ?? []), item.sourcePath]);
  for (const [id, paths] of ids) if (paths.length > 1) errors.push(`duplicate id "${id}" (${paths.join(', ')})`);

  const alwaysOnTokens = new Map<string, number>();
  for (const item of pack.items) {
    const id = item.frontMatter.id;
    const kind = effectiveKind(pack, item);
    const app = effectiveApp(pack, item);
    if (item.frontMatter.tier === 'always_on' && kind !== 'standard') errors.push(`${id}: only standard items may be always_on`);
    if (kind === 'app_memory' && !app) errors.push(`${id}: app_memory items require app`);
    if (kind === 'app_memory' && !item.frontMatter.memory_type) errors.push(`${id}: app_memory items require memory_type`);
    if (app && !ctx.knownAppSlugs.has(app)) errors.push(`${id}: unknown app "${app}"`);
    if (item.frontMatter.tier === 'always_on') {
      const key = app ?? 'company';
      alwaysOnTokens.set(key, (alwaysOnTokens.get(key) ?? 0) + countTokens(item.body));
    }
  }
  for (const [key, tokens] of alwaysOnTokens) {
    if (tokens > ALWAYS_ON_WARN_TOKENS) warnings.push(`always-on standards for ${key} total ${tokens} tokens, above ${ALWAYS_ON_WARN_TOKENS}`);
  }

  if (pack.manifest.kind === 'framework_pack') {
    if (!pack.manifest.tracks || Object.keys(pack.manifest.tracks).length === 0) {
      errors.push('framework packs must declare tracks');
    } else {
      for (const [name, track] of Object.entries(pack.manifest.tracks) as [string, TrackDecl][]) {
        for (const e of validateTrackShape(track)) errors.push(`track ${name}: ${e}`);
        for (const phase of PHASES) {
          const entry = track.phases[phase];
          if (entry !== 'skipped' && entry.template && !ids.has(entry.template)) {
            errors.push(`track ${name}: phase ${phase} names template "${entry.template}" which is not in this pack`);
          }
          if (entry !== 'skipped' && entry.template && ids.has(entry.template)) {
            const item = pack.items.find((i) => i.frontMatter.id === entry.template)!;
            const tokens = countTokens(item.body);
            if (tokens > TEMPLATE_WARN_TOKENS) {
              const msg = `template ${entry.template} is ${tokens} tokens, above ${TEMPLATE_WARN_TOKENS}`;
              if (!warnings.includes(msg)) warnings.push(msg);
            }
          }
        }
        for (const gate of track.gates) for (const e of validateGateDecl(gate)) errors.push(`track ${name} gate ${gate.transition}: ${e}`);
      }
    }
  } else if (pack.manifest.tracks) {
    warnings.push('tracks are ignored on non-framework packs');
  }
  return { errors, warnings };
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/ingest/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/validate.ts test/unit/ingest/validate.test.ts
git commit -m "feat(ingest): pack validation rules"
```

### Task 30: Markdown chunker

**Files:**
- Create: `src/ingest/chunk.ts`
- Test: `test/unit/ingest/chunk.test.ts`

**Interfaces:**
- `CHUNK_TOKEN_CAP = 512`
- `Chunk { ordinal: number; heading_path: string; text: string; token_count: number }`
- `chunkMarkdown(body: string, cap = CHUNK_TOKEN_CAP): Chunk[]` — split on H2; an H2 over the cap splits on H3; still over the cap splits on paragraphs; fenced code blocks and tables are atomic; no overlap. `heading_path` is `H2` or `H2 > H3` (empty for text before the first H2).
- `embedText(title: string, chunk: Chunk): string` returns `${title} > ${heading_path}\n\n${text}` (or `${title}\n\n${text}` when the path is empty). This is what gets embedded; `text` is what gets rendered.

- [ ] **Step 1: Write the failing test**

`test/unit/ingest/chunk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chunkMarkdown, embedText, CHUNK_TOKEN_CAP } from '../../../src/ingest/chunk.js';
import { countTokens } from '../../../src/tokens.js';

const para = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} about exports and orders.`).join(' ');

describe('chunkMarkdown', () => {
  it('splits on H2 with heading paths and ordinals', () => {
    const c = chunkMarkdown('intro text\n\n## Goal\ngoal text\n\n## Rationale\nwhy');
    expect(c.map((x) => [x.ordinal, x.heading_path])).toEqual([[0, ''], [1, 'Goal'], [2, 'Rationale']]);
    expect(c[1]?.text).toBe('goal text');
    expect(c[1]?.token_count).toBe(countTokens('goal text'));
  });
  it('splits an oversized H2 on H3, then on paragraphs, never over the cap', () => {
    const md = `## Big\n\n### A\n\n${para(40)}\n\n${para(40)}\n\n### B\n\n${para(20)}`;
    const c = chunkMarkdown(md);
    expect(c.length).toBeGreaterThan(2);
    for (const x of c) expect(x.token_count).toBeLessThanOrEqual(CHUNK_TOKEN_CAP);
    expect(c.every((x) => x.heading_path.startsWith('Big > '))).toBe(true);
  });
  it('never splits inside a fence or a table', () => {
    const fence = '```ts\n' + Array.from({ length: 300 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n```';
    const table = Array.from({ length: 120 }, (_, i) => `| r${i} | value ${i} |`).join('\n');
    const c = chunkMarkdown(`## Code\n\n${fence}\n\n## Table\n\n| a | b |\n|---|---|\n${table}`);
    const code = c.filter((x) => x.heading_path === 'Code');
    expect(code).toHaveLength(1);
    expect(code[0]?.text.split('```').length).toBe(3);
    const tbl = c.filter((x) => x.heading_path === 'Table');
    expect(tbl).toHaveLength(1);
  });
  it('builds the embedded text with the title and path', () => {
    const [c] = chunkMarkdown('## Rationale\nwhy');
    expect(embedText('ADR-7 Streaming', c!)).toBe('ADR-7 Streaming > Rationale\n\nwhy');
    const [p] = chunkMarkdown('preamble');
    expect(embedText('Doc', p!)).toBe('Doc\n\npreamble');
  });
  it('returns nothing for an empty body', () => {
    expect(chunkMarkdown('   \n')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/ingest/chunk.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/ingest/chunk.ts**

```ts
import { lines, type Line } from '../gates/markdown.js';
import { countTokens } from '../tokens.js';

export const CHUNK_TOKEN_CAP = 512;
export interface Chunk { ordinal: number; heading_path: string; text: string; token_count: number }

interface Section { path: string; lines: Line[] }

function splitByHeading(ls: Line[], level: number, basePath: string): Section[] {
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*#*\\s*$`);
  const out: Section[] = [];
  let current: Section = { path: basePath, lines: [] };
  for (const line of ls) {
    const m = line.inFence ? null : re.exec(line.text);
    if (m) {
      if (current.lines.some((l) => l.text.trim() !== '')) out.push(current);
      current = { path: basePath ? `${basePath} > ${m[1]!.trim()}` : m[1]!.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.text.trim() !== '')) out.push(current);
  return out;
}

/** Atomic blocks: fenced code, tables (consecutive `|` lines), otherwise paragraphs separated by blank lines. */
function blocks(ls: Line[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let mode: 'para' | 'fence' | 'table' = 'para';
  const flush = () => { if (buf.length > 0) { out.push(buf.join('\n')); buf = []; } };
  for (const line of ls) {
    const isFenceLine = /^\s*(```|~~~)/.test(line.text);
    const isTableLine = /^\s*\|/.test(line.text);
    if (mode === 'fence') { buf.push(line.text); if (isFenceLine) { flush(); mode = 'para'; } continue; }
    if (isFenceLine) { flush(); mode = 'fence'; buf.push(line.text); continue; }
    if (mode === 'table' && !isTableLine) { flush(); mode = 'para'; }
    if (isTableLine) { if (mode !== 'table') { flush(); mode = 'table'; } buf.push(line.text); continue; }
    if (line.text.trim() === '') { flush(); continue; }
    buf.push(line.text);
  }
  flush();
  return out;
}

function packBlocks(bs: string[], cap: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const b of bs) {
    const candidate = cur ? `${cur}\n\n${b}` : b;
    if (cur && countTokens(candidate) > cap) { out.push(cur); cur = b; } else cur = candidate;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkMarkdown(body: string, cap = CHUNK_TOKEN_CAP): Chunk[] {
  const texts: { path: string; text: string }[] = [];
  for (const h2 of splitByHeading(lines(body), 2, '')) {
    const whole = blocks(h2.lines).join('\n\n');
    if (!whole.trim()) continue;
    if (countTokens(whole) <= cap) { texts.push({ path: h2.path, text: whole }); continue; }
    for (const h3 of splitByHeading(h2.lines, 3, h2.path)) {
      const bs = blocks(h3.lines);
      for (const text of packBlocks(bs, cap)) texts.push({ path: h3.path, text });
    }
  }
  return texts.map((t, i) => ({ ordinal: i, heading_path: t.path, text: t.text, token_count: countTokens(t.text) }));
}

export function embedText(title: string, chunk: Chunk): string {
  return chunk.heading_path ? `${title} > ${chunk.heading_path}\n\n${chunk.text}` : `${title}\n\n${chunk.text}`;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/unit/ingest/chunk.test.ts`
Expected: PASS. A single atomic block over the cap (the 300-line fence) becomes one chunk above the cap; the "never over the cap" assertion applies only to the paragraph fixture, which is what the test checks.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/chunk.ts test/unit/ingest/chunk.test.ts
git commit -m "feat(ingest): heading-aware markdown chunker with atomic fences and tables"
```

### Task 31: ingestPack, reindexAll and approveProposal

**Files:**
- Create: `src/ingest/ingest.ts`, `src/ingest/reindex.ts`, `src/services/approveProposal.ts`
- Test: `test/integration/ingest/ingest.test.ts`

**Interfaces:**

```ts
// src/ingest/ingest.ts
export interface IngestDeps { pool: pg.Pool; embedder: EmbeddingProvider }
export interface IngestReport { pack: string; version: string; created: string[]; skipped: string[]; warnings: string[] }
export async function ingestPack(deps, pack: LoadedPack, actor: string): Promise<IngestReport>
// unchanged file (same source_hash) is skipped, except framework_pack items whose pack_version changed (they must exist at the pinned version)
// src/ingest/reindex.ts
export async function reindexAll(deps: IngestDeps, actor: string): Promise<{ chunks: number }>
// src/services/approveProposal.ts
export async function approveProposal(deps: IngestDeps, proposalId: string, reviewer: string): Promise<KnowledgeItemRow>
// stable_id = `<app slug>.<memory_type>.<4-digit seq>` for app_memory, `<app slug>.standard.<4-digit seq>` for standard; pack_name 'proposals'; human_id from a leading ADR-n/REQ-n/US-n/INC-n in the title; supersedes marks the named current item
```

- [ ] **Step 1: Write the failing test**

`test/integration/ingest/ingest.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { loadPack } from '../../../src/ingest/load.js';
import { ingestPack } from '../../../src/ingest/ingest.js';
import { reindexAll } from '../../../src/ingest/reindex.js';
import { approveProposal } from '../../../src/services/approveProposal.js';
import { FakeEmbeddingProvider } from '../../../src/embedding/fake.js';
import { createApp } from '../../../src/store/apps.js';
import { createFeature } from '../../../src/store/features.js';
import { currentItem, itemVersion, insertItemVersion } from '../../../src/store/knowledge.js';
import { currentFramework } from '../../../src/store/frameworks.js';
import { getEmbeddingConfig, setEmbeddingConfig } from '../../../src/store/embeddingConfig.js';
import { insertProposal } from '../../../src/store/proposals.js';
import { exactIdSearch } from '../../../src/store/retrieval.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const embedder = new FakeEmbeddingProvider();

describe.skipIf(!url)('ingestPack', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('ingests a framework pack: items, chunks, framework row, embedding config', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-framework`);
    const report = await ingestPack({ pool, embedder }, pack, 'cli');
    expect(report.created.sort()).toEqual(['mini.guide.proposals', 'mini.template.apply', 'mini.template.proposal']);
    expect(report.skipped).toEqual([]);
    const fw = await currentFramework(pool, 'mini');
    expect(fw?.pack_version).toBe('1.0.0');
    expect(fw?.gate_library_version).toBe('1');
    const item = await currentItem(pool, 'mini.template.proposal');
    expect(item).toMatchObject({ kind: 'framework_pack', framework: 'mini', pack_name: 'mini', pack_version: '1.0.0', phase_tags: ['specify'], license: 'MIT', source_url: 'https://example.com/mini' });
    const chunks = await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks c JOIN knowledge_items i ON i.id = c.item_id WHERE i.stable_id = $1', ['mini.guide.proposals']);
    expect(chunks.rows[0].n).toBe(2);
    expect(await getEmbeddingConfig(pool)).toMatchObject({ provider: 'fake', model: 'fake-1024', dimension: 1024 });
  });

  it('skips unchanged files, versions changed ones, warns on removed ones', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-company`);
    await ingestPack({ pool, embedder }, pack, 'cli');
    const again = await ingestPack({ pool, embedder }, pack, 'cli');
    expect(again.skipped).toEqual(['mini-company.constitution']);
    const changed = structuredClone(pack);
    changed.items[0]!.body += '\n- New rule (reason)';
    changed.items[0]!.sourceHash = 'changed';
    const r2 = await ingestPack({ pool, embedder }, changed, 'cli');
    expect(r2.created).toEqual(['mini-company.constitution']);
    expect((await currentItem(pool, 'mini-company.constitution'))?.version).toBe(2);
    expect((await itemVersion(pool, 'mini-company.constitution', 1))?.superseded_by).not.toBeNull();
    const removed = structuredClone(pack);
    removed.items = [];
    const r3 = await ingestPack({ pool, embedder }, removed, 'cli');
    expect(r3.warnings).toContain('mini-company.constitution is active in the database but no longer in the pack; deprecate it explicitly if intended');
    expect((await currentItem(pool, 'mini-company.constitution'))?.version).toBe(2);
  });

  it('re-versions framework items when the pack version changes even if unchanged', async () => {
    const pool = await getTestPool();
    const pack = await loadPack(`${fixtures}mini-framework`);
    await ingestPack({ pool, embedder }, pack, 'cli');
    const bumped = structuredClone(pack);
    bumped.manifest.version = '1.1.0';
    const r = await ingestPack({ pool, embedder }, bumped, 'cli');
    expect(r.created).toHaveLength(3);
    expect((await currentItem(pool, 'mini.template.proposal'))?.pack_version).toBe('1.1.0');
    expect((await currentFramework(pool, 'mini'))?.pack_version).toBe('1.1.0');
  });

  it('refuses an invalid pack and writes nothing', async () => {
    const pool = await getTestPool();
    const pack = structuredClone(await loadPack(`${fixtures}mini-framework`));
    pack.manifest.tracks!.default!.gates[0]!.checks.push({ name: 'nope' });
    await expect(ingestPack({ pool, embedder }, pack, 'cli')).rejects.toThrow(/unknown check "nope"/);
    expect((await pool.query('SELECT count(*)::int AS n FROM knowledge_items')).rows[0].n).toBe(0);
  });

  it('honours supersedes in front matter and app-scoped items', async () => {
    const pool = await getTestPool();
    await createApp(pool, { slug: 'checkout', name: 'C' }, 'cli');
    const pack = structuredClone(await loadPack(`${fixtures}mini-company`));
    pack.manifest.name = 'checkout-steering';
    pack.items[0]!.frontMatter.id = 'checkout.steering';
    pack.items[0]!.frontMatter.app = 'checkout';
    await ingestPack({ pool, embedder }, pack, 'cli');
    const next = structuredClone(pack);
    next.items[0]!.frontMatter.id = 'checkout.steering-v2';
    next.items[0]!.frontMatter.supersedes = 'checkout.steering';
    next.items[0]!.sourceHash = 'h2';
    await ingestPack({ pool, embedder }, next, 'cli');
    const old = await currentItem(pool, 'checkout.steering');
    expect(old).toBeNull();
    expect((await itemVersion(pool, 'checkout.steering', 1))?.superseded_by).toBe((await currentItem(pool, 'checkout.steering-v2'))?.id);
    expect((await currentItem(pool, 'checkout.steering-v2'))?.app_id).not.toBeNull();
  });

  it('refuses ingestion on embedding mismatch', async () => {
    const pool = await getTestPool();
    await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024 }, 'cli');
    await expect(ingestPack({ pool, embedder }, await loadPack(`${fixtures}mini-company`), 'cli')).rejects.toMatchObject({ code: 'EMBEDDING_MODEL_MISMATCH' });
  });
});

describe.skipIf(!url)('reindexAll and approveProposal', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('re-embeds every chunk and rewrites the config', async () => {
    const pool = await getTestPool();
    await ingestPack({ pool, embedder }, await loadPack(`${fixtures}mini-framework`), 'cli');
    await setEmbeddingConfig(pool, { provider: 'voyage', model: 'voyage-3.5', dimension: 1024 }, 'cli');
    const r = await reindexAll({ pool, embedder }, 'cli');
    expect(r.chunks).toBeGreaterThan(0);
    const cfg = await getEmbeddingConfig(pool);
    expect(cfg).toMatchObject({ provider: 'fake', model: 'fake-1024' });
    expect(cfg?.reindexed_at).not.toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM knowledge_chunks WHERE embedding_model <> 'fake-1024'`)).rows[0].n).toBe(0);
  });

  it('turns an approved proposal into a retrievable item and retires the superseded one', async () => {
    const pool = await getTestPool();
    const app = await createApp(pool, { slug: 'checkout', name: 'C' }, 'cli');
    const feature = await createFeature(pool, { app_id: app.id, slug: 's', intent: 'feature', framework: 'mini', framework_pack_version: '1.0.0', track: 'default', high_risk: false, policy_version: null, policy_override_reason: null, source_task: 't', external_ref: null, trigger_ref: null, decision: { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'x', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' }, workspace: null }, 'd');
    const old = await insertItemVersion(pool, { stable_id: 'checkout.decision.0001', kind: 'app_memory', tier: 'retrieved', framework: null, app_id: app.id, memory_type: 'decision', human_id: null, stack_tags: [], phase_tags: [], title: 'Old rule', body: 'old', front_matter: {}, pack_name: 'proposals', pack_version: null, source_path: null, source_hash: null, source_url: null, license: null }, 'cli');
    const p = await insertProposal(pool, { app_id: app.id, feature_id: feature.id, payload: { kind: 'app_memory', memory_type: 'decision', title: 'ADR-9 CSV exports stream rather than buffer', body: '## Decision\nStream.\n## Rationale\nMemory.', stack_tags: ['node'], links: ['openspec/changes/archive/x/'] }, supersedes: 'checkout.decision.0001' }, 'daniel');
    const item = await approveProposal({ pool, embedder }, p.id, 'admin');
    expect(item).toMatchObject({ stable_id: 'checkout.decision.0002', human_id: 'ADR-9', pack_name: 'proposals', pack_version: null, phase_tags: [], app_id: app.id, created_by: 'admin' });
    expect((await pool.query('SELECT status FROM proposals WHERE id = $1', [p.id])).rows[0].status).toBe('approved');
    expect((await pool.query('SELECT superseded_by FROM knowledge_items WHERE id = $1', [old.id])).rows[0].superseded_by).toBe(item.id);
    const hits = await exactIdSearch(pool, ['ADR-9'], { scope: { appIds: [app.id] }, framework: null, frameworkPackVersion: null, phase: null, kinds: ['app_memory'] });
    expect(hits[0]?.stable_id).toBe('checkout.decision.0002');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/ingest`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/ingest/ingest.ts**

```ts
import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { EMBEDDING_DIMENSION } from '../embedding/provider.js';
import { GATE_LIBRARY_VERSION } from '../gates/library.js';
import { listApps } from '../store/apps.js';
import { insertChunks, type NewChunk } from '../store/chunks.js';
import { getEmbeddingConfig, setEmbeddingConfig } from '../store/embeddingConfig.js';
import { upsertFramework } from '../store/frameworks.js';
import { currentItem, insertItemVersion, listActivePackItems, markSuperseded, type NewKnowledgeItem } from '../store/knowledge.js';
import { TOKENIZER } from '../tokens.js';
import { chunkMarkdown, embedText, type Chunk } from './chunk.js';
import { effectiveApp, effectiveFramework, effectiveKind, type LoadedItem, type LoadedPack } from './load.js';
import { validatePack } from './validate.js';

export interface IngestDeps { pool: pg.Pool; embedder: EmbeddingProvider }
export interface IngestReport { pack: string; version: string; created: string[]; skipped: string[]; warnings: string[] }

interface Planned { item: LoadedItem; row: NewKnowledgeItem; chunks: Chunk[]; embeddings: number[][] }

export async function ingestPack(deps: IngestDeps, pack: LoadedPack, actor: string): Promise<IngestReport> {
  const { pool, embedder } = deps;
  const apps = await listApps(pool);
  const { errors, warnings } = validatePack(pack, { knownAppSlugs: new Set(apps.map((a) => a.slug)) });
  if (errors.length > 0) throw new Error(`pack ${pack.manifest.name} is invalid:\n- ${errors.join('\n- ')}`);
  await assertEmbeddingConfigMatches(pool, embedder);
  const appIdBySlug = new Map(apps.map((a) => [a.slug, a.id]));

  const planned: Planned[] = [];
  const skipped: string[] = [];
  for (const item of pack.items) {
    const kind = effectiveKind(pack, item);
    const current = await currentItem(pool, item.frontMatter.id);
    const unchanged = current?.source_hash === item.sourceHash && (kind !== 'framework_pack' || current.pack_version === pack.manifest.version);
    if (unchanged) { skipped.push(item.frontMatter.id); continue; }
    const appSlug = effectiveApp(pack, item);
    planned.push({
      item,
      row: {
        stable_id: item.frontMatter.id, kind, tier: item.frontMatter.tier, framework: effectiveFramework(pack, item),
        app_id: appSlug ? appIdBySlug.get(appSlug)! : null, memory_type: item.frontMatter.memory_type ?? null, human_id: item.frontMatter.human_id ?? null,
        stack_tags: item.frontMatter.stack_tags, phase_tags: item.frontMatter.phases, title: item.frontMatter.title, body: item.body,
        front_matter: item.frontMatter as unknown as Record<string, unknown>, pack_name: pack.manifest.name, pack_version: pack.manifest.version,
        source_path: item.sourcePath, source_hash: item.sourceHash, source_url: pack.manifest.source_url, license: pack.manifest.license,
      },
      chunks: chunkMarkdown(item.body),
      embeddings: [],
    });
  }

  const texts = planned.flatMap((p) => p.chunks.map((c) => embedText(p.item.frontMatter.title, c)));
  const vectors = texts.length > 0 ? await embedder.embed(texts, 'document') : [];
  let cursor = 0;
  for (const p of planned) { p.embeddings = vectors.slice(cursor, cursor + p.chunks.length); cursor += p.chunks.length; }

  const existing = await listActivePackItems(pool, pack.manifest.name);
  const inPack = new Set(pack.items.map((i) => i.frontMatter.id));
  for (const row of existing) {
    if (!inPack.has(row.stable_id)) warnings.push(`${row.stable_id} is active in the database but no longer in the pack; deprecate it explicitly if intended`);
  }

  await withTransaction(pool, async (tx) => {
    for (const p of planned) {
      const row = await insertItemVersion(tx, p.row, actor);
      const chunks: NewChunk[] = p.chunks.map((c, i) => ({
        ordinal: c.ordinal, heading_path: c.heading_path, text: c.text, embedding: p.embeddings[i]!, embedding_model: embedder.model, token_count: c.token_count, tokenizer: TOKENIZER,
      }));
      await insertChunks(tx, row.id, chunks, actor);
      if (p.item.frontMatter.supersedes) {
        const target = await currentItem(tx, p.item.frontMatter.supersedes);
        if (target) await markSuperseded(tx, target.id, row.id);
        else warnings.push(`${row.stable_id} supersedes "${p.item.frontMatter.supersedes}" which has no current version`);
      }
    }
    if (pack.manifest.kind === 'framework_pack' && pack.manifest.tracks) {
      await upsertFramework(tx, { name: pack.manifest.framework ?? pack.manifest.name, pack_version: pack.manifest.version, tracks: pack.manifest.tracks, gate_library_version: GATE_LIBRARY_VERSION }, actor);
    }
    if (!(await getEmbeddingConfig(tx))) await setEmbeddingConfig(tx, { provider: embedder.provider, model: embedder.model, dimension: EMBEDDING_DIMENSION }, actor);
  });

  return { pack: pack.manifest.name, version: pack.manifest.version, created: planned.map((p) => p.row.stable_id), skipped, warnings };
}
```

- [ ] **Step 4: Implement src/ingest/reindex.ts**

```ts
import { withTransaction } from '../db/pool.js';
import { EMBEDDING_DIMENSION } from '../embedding/provider.js';
import { listChunkTexts, updateChunkEmbedding } from '../store/chunks.js';
import { setEmbeddingConfig } from '../store/embeddingConfig.js';
import type { IngestDeps } from './ingest.js';

const BATCH = 64;

export async function reindexAll(deps: IngestDeps, actor: string): Promise<{ chunks: number }> {
  const rows = await listChunkTexts(deps.pool);
  const vectors: number[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => (r.heading_path ? `${r.title} > ${r.heading_path}\n\n${r.text}` : `${r.title}\n\n${r.text}`));
    vectors.push(...(await deps.embedder.embed(batch, 'document')));
  }
  await withTransaction(deps.pool, async (tx) => {
    for (let i = 0; i < rows.length; i++) await updateChunkEmbedding(tx, rows[i]!.id, vectors[i]!, deps.embedder.model);
    await setEmbeddingConfig(tx, { provider: deps.embedder.provider, model: deps.embedder.model, dimension: EMBEDDING_DIMENSION, reindexed: true }, actor);
  });
  return { chunks: rows.length };
}
```

- [ ] **Step 5: Implement src/services/approveProposal.ts**

```ts
import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import type { IngestDeps } from '../ingest/ingest.js';
import { chunkMarkdown, embedText } from '../ingest/chunk.js';
import { insertChunks } from '../store/chunks.js';
import { currentItem, insertItemVersion, markSuperseded, nextProposalSequence } from '../store/knowledge.js';
import { getProposal, reviewProposal } from '../store/proposals.js';
import type { KnowledgeItemRow } from '../store/rows.js';
import { TOKENIZER } from '../tokens.js';

export const ProposalPayloadSchema = z.object({
  kind: z.enum(['app_memory', 'standard']),
  memory_type: z.enum(['adr', 'decision', 'constraint', 'incident']).nullable().optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  stack_tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
});

const LEADING_ID = /^(ADR|REQ|US|INC)-\d+\b/;

export async function approveProposal(deps: IngestDeps, proposalId: string, reviewer: string): Promise<KnowledgeItemRow> {
  const proposal = await getProposal(deps.pool, proposalId);
  if (!proposal) throw new Error(`no proposal with id "${proposalId}"`);
  if (proposal.status !== 'pending') throw new Error(`proposal ${proposalId} is already ${proposal.status}`);
  const payload = ProposalPayloadSchema.parse(proposal.payload);
  const app = (await deps.pool.query<{ slug: string }>('SELECT slug FROM apps WHERE id = $1', [proposal.app_id])).rows[0]!;
  const memoryType = payload.kind === 'app_memory' ? payload.memory_type ?? null : null;
  if (payload.kind === 'app_memory' && !memoryType) throw new Error('app_memory proposals require memory_type');
  const seqKey = payload.kind === 'app_memory' ? memoryType! : 'standard';
  const body = payload.links.length > 0 ? `${payload.body.trim()}\n\n## Links\n${payload.links.map((l) => `- ${l}`).join('\n')}` : payload.body.trim();
  const chunks = chunkMarkdown(body);
  const vectors = chunks.length > 0 ? await deps.embedder.embed(chunks.map((c) => embedText(payload.title, c)), 'document') : [];

  return withTransaction(deps.pool, async (tx) => {
    const seq = await nextProposalSequence(tx, app.slug, seqKey);
    const stableId = `${app.slug}.${seqKey}.${String(seq).padStart(4, '0')}`;
    const row = await insertItemVersion(tx, {
      stable_id: stableId, kind: payload.kind, tier: 'retrieved', framework: null, app_id: proposal.app_id, memory_type: memoryType,
      human_id: LEADING_ID.exec(payload.title)?.[0] ?? null, stack_tags: payload.stack_tags, phase_tags: [], title: payload.title, body,
      front_matter: { proposal_id: proposal.id, feature_id: proposal.feature_id, links: payload.links }, pack_name: 'proposals', pack_version: null,
      source_path: null, source_hash: null, source_url: null, license: null,
    }, reviewer);
    await insertChunks(tx, row.id, chunks.map((c, i) => ({ ordinal: c.ordinal, heading_path: c.heading_path, text: c.text, embedding: vectors[i]!, embedding_model: deps.embedder.model, token_count: c.token_count, tokenizer: TOKENIZER })), reviewer);
    if (proposal.supersedes) {
      const target = await currentItem(tx, proposal.supersedes);
      if (target) await markSuperseded(tx, target.id, row.id);
    }
    await reviewProposal(tx, proposal.id, 'approved', reviewer, null);
    return row;
  });
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/ingest && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ingest/ingest.ts src/ingest/reindex.ts src/services/approveProposal.ts test/integration/ingest
git commit -m "feat(ingest): transactional pack ingestion with versioning, reindex and proposal approval"
```

### Task 32: sdd-admin CLI

**Files:**
- Create: `src/cli/index.ts`, `src/cli/context.ts`, `src/cli/commands/app.ts`, `src/cli/commands/ingest.ts`, `src/cli/commands/deprecate.ts`, `src/cli/commands/proposals.ts`, `src/cli/commands/reindex.ts`
- Test: `test/integration/cli/cli.test.ts`

**Interfaces:**
- `src/cli/context.ts`: `openCli(opts: { needEmbedder: boolean }): Promise<{ pool; embedder: EmbeddingProvider | null; config; close(): Promise<void> }>` (loads config from `process.env`, runs migrations).
- Commands exactly as spec §12.4, every write takes `--actor <name>` defaulting to `os.userInfo().username`:
  - `app register <slug> --name <name> [--compliance]`
  - `app update <slug> [--stack a,b] [--budget N] [--min-similarity X]`
  - `app set-policy <slug> <policy.json> --reason <text>`
  - `app add-stop-condition <slug> <text>`
  - `app list`
  - `ingest <dir>`
  - `deprecate <stable_id> [--successor <id>] --reason <text>`
  - `deprecate-framework <name> [--version V] --reason <text>`
  - `proposals list | approve <id> | reject <id> --reason <text>`
  - `reindex`
- Output is one JSON object per command on stdout; errors go to stderr with exit code 1.

- [ ] **Step 1: Write the failing test**

`test/integration/cli/cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const fixtures = fileURLToPath(new URL('../../fixtures/packs/', import.meta.url));
const run = promisify(execFile);

async function admin(...args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run('npx', ['tsx', 'src/cli/index.ts', ...args], {
    env: { ...process.env, SDD_DATABASE_URL: url!, SDD_EMBEDDING_PROVIDER: 'fake' }, cwd: process.cwd(),
  });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

describe.skipIf(!url)('sdd-admin', () => {
  beforeEach(async () => truncateAll(await getTestPool()));
  afterAll(closeTestPool);

  it('registers and configures apps', async () => {
    expect(await admin('app', 'register', 'checkout', '--name', 'Checkout', '--compliance', '--actor', 'daniel')).toMatchObject({ slug: 'checkout', compliance: true, created_by: 'daniel' });
    expect(await admin('app', 'update', 'checkout', '--stack', 'typescript,react', '--budget', '5000', '--min-similarity', '0.4')).toMatchObject({ default_stack: ['typescript', 'react'], token_budget: 5000 });
    const dir = await mkdtemp(join(tmpdir(), 'sdd-'));
    await writeFile(join(dir, 'policy.json'), JSON.stringify({ framework: null, path_rules: [{ glob: '**/payments/**', framework: 'bmad' }], risk_paths: ['**/webhooks/**'] }));
    expect(await admin('app', 'set-policy', 'checkout', join(dir, 'policy.json'), '--reason', 'PCI')).toMatchObject({ version: 1, reason: 'PCI' });
    expect(await admin('app', 'add-stop-condition', 'checkout', 'Never change tax rounding')).toMatchObject({ stop_conditions: ['Never change tax rounding'] });
    const list = await admin('app', 'list') as { apps: { slug: string; policy_version: number }[] };
    expect(list.apps).toEqual([expect.objectContaining({ slug: 'checkout', policy_version: 1 })]);
  });

  it('ingests, deprecates and reindexes', async () => {
    const r = await admin('ingest', `${fixtures}mini-framework`) as { created: string[] };
    expect(r.created).toHaveLength(3);
    expect(await admin('deprecate', 'mini.guide.proposals', '--reason', 'obsolete')).toMatchObject({ stable_id: 'mini.guide.proposals', status: 'deprecated' });
    expect(await admin('deprecate-framework', 'mini', '--version', '1.0.0', '--reason', 'unused')).toMatchObject({ deprecated: 1 });
    expect(await admin('reindex')).toMatchObject({ chunks: expect.any(Number) });
  });

  it('fails with exit code 1 and a message on an invalid pack', async () => {
    await expect(admin('ingest', `${fixtures}does-not-exist`)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('pack.yaml') });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/cli`
Expected: FAIL (tsx cannot find `src/cli/index.ts`).

- [ ] **Step 3: Implement src/cli/context.ts**

```ts
import { loadConfig, type Config } from '../config.js';
import { createPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding/index.js';
import type pg from 'pg';

export interface CliContext { pool: pg.Pool; embedder: EmbeddingProvider | null; config: Config; close(): Promise<void> }

export async function openCli(opts: { needEmbedder: boolean }): Promise<CliContext> {
  const env = { ...process.env };
  if (!opts.needEmbedder && !env.VOYAGE_API_KEY && (env.SDD_EMBEDDING_PROVIDER ?? 'voyage') === 'voyage') env.SDD_EMBEDDING_PROVIDER = 'fake';
  const config = loadConfig(env);
  await runMigrations(config.databaseUrl);
  const pool = createPool(config.databaseUrl);
  const embedder = opts.needEmbedder ? createEmbeddingProvider(config.embedding) : null;
  return { pool, embedder, config, close: () => pool.end() };
}

export function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
```

- [ ] **Step 4: Implement the command modules**

`src/cli/commands/app.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { addStopCondition, createApp, listApps, requireApp, updateApp } from '../../store/apps.js';
import { appendPolicy, PolicySchema } from '../../store/policies.js';
import { openCli, print } from '../context.js';

export function appCommand(actorOption: (c: Command) => Command): Command {
  const app = new Command('app').description('Manage apps');

  actorOption(app.command('register <slug>').requiredOption('--name <name>').option('--compliance', 'app is under compliance', false))
    .action(async (slug: string, o: { name: string; compliance: boolean; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print(await createApp(ctx.pool, { slug, name: o.name, compliance: o.compliance }, o.actor)); } finally { await ctx.close(); }
    });

  actorOption(app.command('update <slug>').option('--stack <list>', 'comma-separated default stack').option('--budget <n>', 'token budget').option('--min-similarity <x>', 'similarity floor'))
    .action(async (slug: string, o: { stack?: string; budget?: string; minSimilarity?: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const patch: Parameters<typeof updateApp>[2] = {};
        if (o.stack !== undefined) patch.default_stack = o.stack.split(',').map((s) => s.trim()).filter(Boolean);
        if (o.budget !== undefined) patch.token_budget = Number(o.budget);
        if (o.minSimilarity !== undefined) patch.min_similarity = Number(o.minSimilarity);
        print(await updateApp(ctx.pool, slug, patch, o.actor));
      } finally { await ctx.close(); }
    });

  actorOption(app.command('set-policy <slug> <file>').requiredOption('--reason <text>'))
    .action(async (slug: string, file: string, o: { reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try {
        const row = await requireApp(ctx.pool, slug);
        const policy = PolicySchema.parse(JSON.parse(await readFile(file, 'utf8')));
        print(await appendPolicy(ctx.pool, row.id, policy, o.reason, o.actor));
      } finally { await ctx.close(); }
    });

  actorOption(app.command('add-stop-condition <slug> <text>'))
    .action(async (slug: string, text: string, o: { actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print(await addStopCondition(ctx.pool, slug, text, o.actor)); } finally { await ctx.close(); }
    });

  app.command('list').action(async () => {
    const ctx = await openCli({ needEmbedder: false });
    try { print({ apps: await listApps(ctx.pool) }); } finally { await ctx.close(); }
  });

  return app;
}
```

`src/cli/commands/ingest.ts`:

```ts
import { Command } from 'commander';
import { ingestPack } from '../../ingest/ingest.js';
import { loadPack } from '../../ingest/load.js';
import { openCli, print } from '../context.js';

export function ingestCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('ingest').argument('<dir>').description('Validate and ingest a pack directory'))
    .action(async (dir: string, o: { actor: string }) => {
      const ctx = await openCli({ needEmbedder: true });
      try {
        const pack = await loadPack(dir);
        print(await ingestPack({ pool: ctx.pool, embedder: ctx.embedder! }, pack, o.actor));
      } finally { await ctx.close(); }
    });
}
```

`src/cli/commands/deprecate.ts`:

```ts
import { Command } from 'commander';
import { deprecateFramework } from '../../store/frameworks.js';
import { deprecateItem } from '../../store/knowledge.js';
import { openCli, print } from '../context.js';

export function deprecateCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('deprecate').argument('<stable_id>').option('--successor <id>').requiredOption('--reason <text>'))
    .action(async (stableId: string, o: { successor?: string; reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print(await deprecateItem(ctx.pool, stableId, o.successor ?? null, o.reason, o.actor)); } finally { await ctx.close(); }
    });
}

export function deprecateFrameworkCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('deprecate-framework').argument('<name>').option('--version <v>').requiredOption('--reason <text>'))
    .action(async (name: string, o: { version?: string; reason: string; actor: string }) => {
      const ctx = await openCli({ needEmbedder: false });
      try { print({ name, version: o.version ?? null, deprecated: await deprecateFramework(ctx.pool, name, o.version ?? null, o.reason, o.actor) }); } finally { await ctx.close(); }
    });
}
```

`src/cli/commands/proposals.ts`:

```ts
import { Command } from 'commander';
import { approveProposal } from '../../services/approveProposal.js';
import { listProposals, reviewProposal } from '../../store/proposals.js';
import { openCli, print } from '../context.js';

export function proposalsCommand(actorOption: (c: Command) => Command): Command {
  const cmd = new Command('proposals').description('Review agent proposals');
  cmd.command('list').option('--status <s>', 'pending, approved or rejected', 'pending').action(async (o: { status: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print({ proposals: await listProposals(ctx.pool, o.status as 'pending') }); } finally { await ctx.close(); }
  });
  actorOption(cmd.command('approve <id>')).action(async (id: string, o: { actor: string }) => {
    const ctx = await openCli({ needEmbedder: true });
    try { print(await approveProposal({ pool: ctx.pool, embedder: ctx.embedder! }, id, o.actor)); } finally { await ctx.close(); }
  });
  actorOption(cmd.command('reject <id>').requiredOption('--reason <text>')).action(async (id: string, o: { reason: string; actor: string }) => {
    const ctx = await openCli({ needEmbedder: false });
    try { print(await reviewProposal(ctx.pool, id, 'rejected', o.actor, o.reason)); } finally { await ctx.close(); }
  });
  return cmd;
}
```

`src/cli/commands/reindex.ts`:

```ts
import { Command } from 'commander';
import { reindexAll } from '../../ingest/reindex.js';
import { openCli, print } from '../context.js';

export function reindexCommand(actorOption: (c: Command) => Command): Command {
  return actorOption(new Command('reindex').description('Re-embed every chunk with the configured model'))
    .action(async (o: { actor: string }) => {
      const ctx = await openCli({ needEmbedder: true });
      try { print(await reindexAll({ pool: ctx.pool, embedder: ctx.embedder! }, o.actor)); } finally { await ctx.close(); }
    });
}
```

`src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { userInfo } from 'node:os';
import { Command } from 'commander';
import { appCommand } from './commands/app.js';
import { deprecateCommand, deprecateFrameworkCommand } from './commands/deprecate.js';
import { ingestCommand } from './commands/ingest.js';
import { proposalsCommand } from './commands/proposals.js';
import { reindexCommand } from './commands/reindex.js';
import { fail } from './context.js';

const defaultActor = (() => { try { return userInfo().username; } catch { return 'unknown'; } })();
const actorOption = (c: Command): Command => c.option('--actor <name>', 'display identity recorded as created_by', defaultActor);

const program = new Command('sdd-admin').description('SDD Orchestrator admin CLI');
program.addCommand(appCommand(actorOption));
program.addCommand(ingestCommand(actorOption));
program.addCommand(deprecateCommand(actorOption));
program.addCommand(deprecateFrameworkCommand(actorOption));
program.addCommand(proposalsCommand(actorOption));
program.addCommand(reindexCommand(actorOption));

program.parseAsync(process.argv).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 5: Run the CLI test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/cli && npm run typecheck`
Expected: PASS. The `app list` test expects `policy_version` from Task 20's `listApps`.

- [ ] **Step 6: Commit**

```bash
git add src/cli test/integration/cli
git commit -m "feat(cli): sdd-admin app, ingest, deprecate, proposals and reindex commands"
```

---

## Part I: Services (transport-independent use cases)

Services take `ServiceDeps` and plain inputs, throw `DomainError`, and return plain objects. The MCP layer (Part J) only validates input, calls a service and encodes the result. Contract tests in Part J cover the wire format; the tests here cover behaviour.

### Task 33: Service deps, feature state view, route_task and start_feature services

**Files:**
- Create: `src/services/deps.ts`, `src/services/featureState.ts`, `src/services/routeTask.ts`, `src/services/startFeature.ts`
- Test: `test/integration/services/routeAndStart.test.ts`, `test/helpers/seed.ts`

**Interfaces:**

```ts
// src/services/deps.ts
export interface ServiceDeps { pool: pg.Pool; embedder: EmbeddingProvider | null; tokenBudget: number; metrics?: Metrics }   // Metrics defined in Task 42; optional here
// src/services/featureState.ts
export interface FeatureState { feature_id; app; slug; intent; framework; framework_pack_version; track; current_phase; phase_alias; status; blocked_reason; high_risk; failed_cycles; external_ref; trigger_ref; allowed_targets: { forward: string[]; backward: string[] } }
export async function featureState(q, feature: FeatureRow): Promise<{ state: FeatureState; track: TrackDecl }>
// src/services/routeTask.ts
export interface RouteTaskInput { task_description: string; app: string; workspace: Workspace; framework_preference?: string | null }
export interface RouteTaskResult { decision: Decision; clarifying_questions: string[]; guidance: string | null; lite_pack: LitePack | null; attached_layers: AttachedLayer[]; warnings: string[] }
export async function routeTask(deps, input): Promise<RouteTaskResult>      // writes nothing
// src/services/startFeature.ts
export interface StartFeatureInput { app; actor; task_description; decision: Decision; workspace?: Workspace | null; feature_slug?: string | null; external_ref?: string | null; trigger_ref?: string | null; policy_override_reason?: string | null }
export interface StartFeatureResult { feature_id: string; context_pack: string; pack_id: string; feature: FeatureState; next_instructions: string; warnings: string[] }
export async function startFeature(deps, input): Promise<StartFeatureResult>
```

- [ ] **Step 1: Create the shared seed helper**

`test/helpers/seed.ts` ingests the two fixture packs plus a minimal quality layer and a React stack guide, registers `checkout`, and returns ids. Every service and contract test uses it.

```ts
import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { loadPack, type LoadedPack } from '../../src/ingest/load.js';
import { ingestPack } from '../../src/ingest/ingest.js';
import { FakeEmbeddingProvider } from '../../src/embedding/fake.js';
import { createApp, updateApp, addStopCondition } from '../../src/store/apps.js';

const fixtures = fileURLToPath(new URL('../fixtures/packs/', import.meta.url));
export const embedder = new FakeEmbeddingProvider();

function syntheticPack(name: string, kind: 'standard' | 'stack_guide', items: { id: string; title: string; body: string; stack_tags?: string[] }[]): LoadedPack {
  return {
    dir: name,
    manifest: { name, kind, framework: null, version: '1.0.0', source_url: null, license: 'MIT', app: null },
    items: items.map((i) => ({
      frontMatter: { id: i.id, tier: 'retrieved', phases: [], stack_tags: i.stack_tags ?? [], title: i.title },
      body: i.body, sourcePath: `${i.id}.md`, sourceHash: `hash-${i.id}`,
    })),
  };
}

export async function seedAll(pool: pg.Pool): Promise<{ appId: string }> {
  const app = await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'seed');
  await updateApp(pool, 'checkout', { token_budget: 6000 }, 'seed');
  await addStopCondition(pool, 'checkout', 'Never change tax rounding', 'seed');
  const deps = { pool, embedder };
  await ingestPack(deps, await loadPack(`${fixtures}mini-framework`), 'seed');
  await ingestPack(deps, await loadPack(`${fixtures}mini-company`), 'seed');
  await ingestPack(deps, syntheticPack('quality-layer', 'standard', [{ id: 'quality.tdd', title: 'Test-driven development', body: 'Write the failing test first. Exports and orders included.' }]), 'seed');
  await ingestPack(deps, syntheticPack('stack-guides/react', 'stack_guide', [{ id: 'react.hooks', title: 'Hooks', body: 'Keep effects small. csv export orders hooks.', stack_tags: ['react'] }]), 'seed');
  return { appId: app.id };
}
```

- [ ] **Step 2: Write the failing test**

`test/integration/services/routeAndStart.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { routeTask } from '../../../src/services/routeTask.js';
import { startFeature } from '../../../src/services/startFeature.js';
import type { ServiceDeps } from '../../../src/services/deps.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('routeTask and startFeature', () => {
  let deps: ServiceDeps;
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); deps = { pool, embedder, tokenBudget: 6000 }; });
  afterAll(closeTestPool);

  it('routes without writing and attaches layers', async () => {
    const r = await routeTask(deps, { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false, stack: ['react'] }, framework_preference: 'mini' });
    expect(r.decision).toMatchObject({ framework: 'mini', track: 'default', rule: '2-preference', framework_pack_version: '1.0.0', policy_version: null });
    expect(r.attached_layers).toEqual([
      { pack_name: 'quality-layer', pack_version: '1.0.0', kind: 'standard' },
      { pack_name: 'stack-guides/react', pack_version: '1.0.0', kind: 'stack_guide' },
    ]);
    expect(r.lite_pack).toBeNull();
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM context_packs')).rows[0].n).toBe(0);
  });

  it('returns a lite pack for trivial work', async () => {
    const r = await routeTask(deps, { task_description: 'Rename a label', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1, paths_touched: ['src/a.tsx'], stack: ['react'] } });
    expect(r.decision).toMatchObject({ intent: 'trivial', framework: 'none', rule: '4-trivial' });
    expect(r.lite_pack?.rendered).toContain('[mini-company.constitution v1]');
    expect(r.lite_pack?.rendered).toContain('- Never change tax rounding');
    expect((await deps.pool.query('SELECT count(*)::int AS n FROM context_packs')).rows[0].n).toBe(0);
  });

  it('fails on unknown app and unknown preference', async () => {
    await expect(routeTask(deps, { task_description: 'x', app: 'nope', workspace: {} })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
    await expect(routeTask(deps, { task_description: 'x', app: 'checkout', workspace: {}, framework_preference: 'aiup' })).rejects.toMatchObject({ code: 'UNKNOWN_FRAMEWORK' });
  });

  it('starts a feature pinned to the current framework version with the specify pack', async () => {
    const r = await routeTask(deps, { task_description: 'Add CSV export to the orders page', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' });
    const s = await startFeature(deps, { app: 'checkout', actor: 'daniel', task_description: 'Add CSV export to the orders page', decision: r.decision, workspace: { estimated_files: 4 }, external_ref: 'YAL-123' });
    expect(s.feature_id).toMatch(/^f_/);
    expect(s.feature).toMatchObject({ framework: 'mini', framework_pack_version: '1.0.0', track: 'default', current_phase: 'specify', phase_alias: 'proposal', status: 'active', external_ref: 'YAL-123', slug: 'yal-123-add-csv-export-to-the-orders-page' });
    expect(s.feature.allowed_targets).toEqual({ forward: ['implement'], backward: [] });
    expect(s.context_pack).toContain('## Why');
    expect(s.next_instructions).toContain(`Keep the feature id ${s.feature_id}`);
    expect(s.pack_id).toMatch(/^cp_/);
    expect(s.warnings).toEqual([]);
    const row = (await deps.pool.query('SELECT * FROM features WHERE id = $1', [s.feature_id])).rows[0];
    expect(row.decision.rule).toBe('2-preference');
    expect(row.created_by).toBe('daniel');
  });

  it('refuses framework none, unknown framework, missing track and policy override without reason', async () => {
    const base = { app: 'checkout', actor: 'daniel', task_description: 'x' };
    const dec = (over: Record<string, unknown>) => ({ intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0', ...over }) as never;
    await expect(startFeature(deps, { ...base, decision: dec({ framework: 'none', track: null }) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(startFeature(deps, { ...base, decision: dec({ framework: 'aiup' }) })).rejects.toMatchObject({ code: 'UNKNOWN_FRAMEWORK' });
    await expect(startFeature(deps, { ...base, decision: dec({ track: 'nope' }) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await deps.pool.query(`INSERT INTO app_policies (id, app_id, version, policy, reason, created_by) SELECT 'pol_1', id, 1, '{"framework":"spec-kit","path_rules":[],"risk_paths":[]}', 'r', 'seed' FROM apps WHERE slug = 'checkout'`);
    await expect(startFeature(deps, { ...base, decision: dec({}) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('policy_override_reason') });
    const ok = await startFeature(deps, { ...base, decision: dec({}), policy_override_reason: 'spec-kit pack not ingested here' });
    expect(ok.feature.framework).toBe('mini');
  });

  it('warns when the decision names a stale pack version', async () => {
    const dec = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '0.9.0' } as const;
    const s = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'x', decision: dec });
    expect(s.feature.framework_pack_version).toBe('1.0.0');
    expect(s.warnings[0]).toMatch(/decision named pack version 0.9.0; pinned 1.0.0/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/routeAndStart.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement deps.ts and featureState.ts**

`src/services/deps.ts`:

```ts
import type pg from 'pg';
import type { EmbeddingProvider } from '../embedding/provider.js';

export interface MetricsHooks {
  routed(rule: string): void;
  gate(check: string, result: 'pass' | 'fail'): void;
  degradedPack(): void;
  overBudgetPack(): void;
  failedCycle(): void;
}

export interface ServiceDeps {
  pool: pg.Pool;
  embedder: EmbeddingProvider | null;
  tokenBudget: number;
  metrics?: MetricsHooks;
}
```

`src/services/featureState.ts`:

```ts
import type { Queryable } from '../db/pool.js';
import type { TrackDecl } from '../domain/types.js';
import { allowedTargets } from '../lifecycle/reachability.js';
import { phaseAlias } from '../lifecycle/track.js';
import { getFrameworkVersion, trackOf } from '../store/frameworks.js';
import type { FeatureRow } from '../store/rows.js';

export interface FeatureState {
  feature_id: string; app: string; slug: string; intent: string; framework: string; framework_pack_version: string; track: string | null;
  current_phase: string; phase_alias: string; status: string; blocked_reason: string | null; high_risk: boolean; failed_cycles: number;
  external_ref: string | null; trigger_ref: string | null; allowed_targets: { forward: string[]; backward: string[] };
}

export async function loadTrack(q: Queryable, feature: FeatureRow): Promise<TrackDecl> {
  const fw = await getFrameworkVersion(q, feature.framework, feature.framework_pack_version);
  if (!fw) throw new Error(`pinned framework ${feature.framework}@${feature.framework_pack_version} is missing`);
  return trackOf(fw, feature.track);
}

export async function featureState(q: Queryable, feature: FeatureRow): Promise<{ state: FeatureState; track: TrackDecl }> {
  const track = await loadTrack(q, feature);
  const app = (await q.query<{ slug: string }>('SELECT slug FROM apps WHERE id = $1', [feature.app_id])).rows[0]!;
  const targets = feature.status === 'archived' ? { forward: [], backward: [] } : allowedTargets(track, feature.current_phase);
  return {
    track,
    state: {
      feature_id: feature.id, app: app.slug, slug: feature.slug, intent: feature.intent, framework: feature.framework,
      framework_pack_version: feature.framework_pack_version, track: feature.track, current_phase: feature.current_phase,
      phase_alias: phaseAlias(track, feature.current_phase), status: feature.status, blocked_reason: feature.blocked_reason,
      high_risk: feature.high_risk, failed_cycles: feature.failed_cycles, external_ref: feature.external_ref, trigger_ref: feature.trigger_ref,
      allowed_targets: { forward: targets.forward, backward: targets.backward },
    },
  };
}
```

- [ ] **Step 5: Implement routeTask.ts**

```ts
import { attachedLayers } from '../assembler/layers.js';
import { buildLitePack, type LitePack } from '../assembler/lite.js';
import type { AttachedLayer, Decision, Workspace } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { route } from '../router/router.js';
import { requireApp } from '../store/apps.js';
import { listCurrentFrameworks, trackNames } from '../store/frameworks.js';
import { currentPolicy } from '../store/policies.js';
import type { ServiceDeps } from './deps.js';

export interface RouteTaskInput { task_description: string; app: string; workspace: Workspace; framework_preference?: string | null }
export interface RouteTaskResult {
  decision: Decision; clarifying_questions: string[]; guidance: string | null; lite_pack: LitePack | null; attached_layers: AttachedLayer[]; warnings: string[];
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
  const stack = input.workspace.stack ?? app.default_stack;
  const { layers, warnings: layerWarnings } = await attachedLayers(q, stack);
  const warnings = [...out.warnings, ...layerWarnings];
  let litePack: LitePack | null = null;
  if (out.lite) {
    if (deps.embedder) await assertEmbeddingConfigMatches(q, deps.embedder);
    litePack = await buildLitePack({ q, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, { app, taskDescription: input.task_description, stack });
    warnings.push(...litePack.warnings);
    if (litePack.degraded) deps.metrics?.degradedPack();
  }
  return { decision: out.decision, clarifying_questions: out.clarifying_questions, guidance: out.guidance, lite_pack: litePack, attached_layers: layers, warnings };
}
```

- [ ] **Step 6: Implement startFeature.ts**

```ts
import { assembleContextPack } from '../assembler/assemble.js';
import { withTransaction } from '../db/pool.js';
import type { Decision, Workspace } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { DomainError } from '../errors.js';
import { renderPhaseInstructions } from '../lifecycle/instructions.js';
import { defaultFeatureSlug, slugify } from '../lifecycle/slug.js';
import { parseFrameworkRef } from '../router/router.js';
import { requireApp } from '../store/apps.js';
import { createFeature } from '../store/features.js';
import { currentFramework, trackNames, trackOf } from '../store/frameworks.js';
import { currentPolicy } from '../store/policies.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface StartFeatureInput {
  app: string; actor: string; task_description: string; decision: Decision; workspace?: Workspace | null; feature_slug?: string | null;
  external_ref?: string | null; trigger_ref?: string | null; policy_override_reason?: string | null;
}
export interface StartFeatureResult { feature_id: string; context_pack: string; pack_id: string; feature: FeatureState; next_instructions: string; warnings: string[] }

export async function startFeature(deps: ServiceDeps, input: StartFeatureInput): Promise<StartFeatureResult> {
  const warnings: string[] = [];
  const decision = input.decision;
  if (decision.framework === 'none') throw new DomainError('VALIDATION_ERROR', 'start_feature needs a framework; the decision names "none" (spike or trivial)', { field: 'decision.framework' });
  if (deps.embedder) await assertEmbeddingConfigMatches(deps.pool, deps.embedder);

  return withTransaction(deps.pool, async (tx) => {
    const app = await requireApp(tx, input.app);
    const fw = await currentFramework(tx, decision.framework);
    if (!fw) throw new DomainError('UNKNOWN_FRAMEWORK', `framework "${decision.framework}" has no current version`, { framework: decision.framework });
    const tracks = trackNames(fw);
    let track: string;
    if (tracks.length === 1 && tracks[0] === 'default') {
      track = 'default';
      if (decision.track && decision.track !== 'default') throw new DomainError('VALIDATION_ERROR', `framework "${fw.name}" has no track "${decision.track}"`, { field: 'decision.track', tracks });
    } else {
      if (!decision.track) throw new DomainError('VALIDATION_ERROR', `framework "${fw.name}" has tracks (${tracks.join(', ')}); decision.track is required`, { field: 'decision.track', tracks });
      if (!tracks.includes(decision.track)) throw new DomainError('VALIDATION_ERROR', `framework "${fw.name}" has no track "${decision.track}"`, { field: 'decision.track', tracks });
      track = decision.track;
    }
    const policy = await currentPolicy(tx, app.id);
    const policyFramework = policy?.policy.framework ? parseFrameworkRef(policy.policy.framework).name : null;
    if (policyFramework && policyFramework !== decision.framework && !input.policy_override_reason) {
      throw new DomainError('VALIDATION_ERROR', `app policy names ${policyFramework}; policy_override_reason is required to start a ${decision.framework} feature`, { field: 'policy_override_reason' });
    }
    if (decision.framework_pack_version && decision.framework_pack_version !== fw.pack_version) {
      warnings.push(`decision named pack version ${decision.framework_pack_version}; pinned ${fw.pack_version}`);
    }
    const feature = await createFeature(tx, {
      app_id: app.id,
      slug: input.feature_slug ? slugify(input.feature_slug) : defaultFeatureSlug(input.task_description, input.external_ref ?? null),
      intent: decision.intent, framework: fw.name, framework_pack_version: fw.pack_version, track, high_risk: decision.high_risk,
      policy_version: policy?.version ?? null, policy_override_reason: input.policy_override_reason ?? null, source_task: input.task_description,
      external_ref: input.external_ref ?? null, trigger_ref: input.trigger_ref ?? null, decision, workspace: input.workspace ?? null,
    }, input.actor);
    const { pack, warnings: packWarnings } = await assembleContextPack({ q: tx, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, { feature, app, phase: 'specify', focus: null, scope: 'app', createdBy: input.actor });
    warnings.push(...packWarnings);
    if (pack.degraded) deps.metrics?.degradedPack();
    if (pack.over_budget) deps.metrics?.overBudgetPack();
    const { state } = await featureState(tx, feature);
    const nextInstructions = renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: 'specify', track_decl: trackOf(fw, track) });
    return { feature_id: feature.id, context_pack: pack.rendered, pack_id: pack.id, feature: state, next_instructions: nextInstructions, warnings };
  });
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/routeAndStart.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/deps.ts src/services/featureState.ts src/services/routeTask.ts src/services/startFeature.ts test/helpers/seed.ts test/integration/services/routeAndStart.test.ts
git commit -m "feat(services): route_task and start_feature"
```

### Task 34: advance_phase and get_context services

**Files:**
- Create: `src/services/advancePhase.ts`, `src/services/getContext.ts`
- Test: `test/integration/services/advance.test.ts`

**Interfaces:**

```ts
// src/services/advancePhase.ts
export interface AdvancePhaseInput {
  feature_id: string; actor: string; expected_phase: Phase; target_phase: string; artifacts?: Record<string, string>; evidence?: unknown;
  human_approved?: boolean; cycle_failed?: boolean; pack_id?: string | null; reason?: string | null; repin?: boolean;
}
export interface AdvancePhaseResult { result: 'pass' | 'fail'; findings: Finding[]; next_instructions: string | null; feature: FeatureState; warnings: string[] }
export async function advancePhase(deps, input): Promise<AdvancePhaseResult>
// src/services/getContext.ts
export interface GetContextInput { feature_id: string; actor: string; phase?: Phase | null; focus?: string | null; scope?: Scope }
export interface GetContextResult { context_pack: string; pack_id: string; feature: FeatureState; warnings: string[] }
export async function getContext(deps, input): Promise<GetContextResult>   // allowed on archived features; createdBy = actor
```

Error precedence inside `advancePhase` (spec §7.5, §10.3), all inside one transaction with `SELECT ... FOR UPDATE`:
1. `VALIDATION_ERROR`: backward move without `reason`; `cycle_failed` on any move other than backward verify→implement; `repin` on a forward move; `pack_id` that does not belong to this feature.
2. `FEATURE_NOT_FOUND`
3. `FEATURE_ARCHIVED`
4. `STALE_STATE`
5. `FEATURE_BLOCKED` (forward moves only)
6. `PHASE_ORDER_VIOLATION` (with allowed targets)

Because input-shape validation needs the target classification, the order of evaluation is: load and lock (2), archived (3), stale (4), classify target (6 if null), then 1 for the input rules that depend on direction, then 5. Report the first failing code in precedence order by collecting candidates and using `firstByPrecedence`.

- [ ] **Step 1: Write the failing test**

`test/integration/services/advance.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getContext } from '../../../src/services/getContext.js';
import type { ServiceDeps } from '../../../src/services/deps.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' } as const;
const goodProposal = '## Why\nExports are manual.\n\n## What Changes\nAdd a CSV button.\n';
const evidence = { tests: { command: 'npm test', passed: 3, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/a.ts'] };

describe.skipIf(!url)('advancePhase', () => {
  let deps: ServiceDeps;
  let fid: string;
  beforeEach(async () => {
    const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool);
    deps = { pool, embedder, tokenBudget: 6000 };
    fid = (await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision })).feature_id;
  });
  afterAll(closeTestPool);

  it('fails the gate as a normal result and leaves the phase unchanged', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': '## Why\nTBD\n' }, human_approved: true });
    expect(r.result).toBe('fail');
    expect(r.findings.map((f) => f.check).sort()).toEqual(['placeholder_scan', 'required_sections']);
    expect(r.feature.current_phase).toBe('specify');
    expect(r.next_instructions).toBeNull();
    const t = (await deps.pool.query('SELECT * FROM phase_transitions WHERE feature_id = $1', [fid])).rows;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ result: 'fail', direction: 'forward', human_approved: true });
    expect(t[0].pack_id).toMatch(/^cp_/);
    const a = (await deps.pool.query('SELECT name, content FROM feature_artifacts WHERE transition_id = $1', [t[0].id])).rows;
    expect(a).toEqual([{ name: 'proposal.md', content: '## Why\nTBD\n' }]);
  });

  it('mandates human approval out of specify', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal } });
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([expect.objectContaining({ check: 'human_approved' })]);
  });

  it('passes and returns next instructions for the new phase', async () => {
    const r = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    expect(r.result).toBe('pass');
    expect(r.feature).toMatchObject({ current_phase: 'implement', phase_alias: 'apply' });
    expect(r.next_instructions).toContain('Phase: implement (apply)');
    expect(r.next_instructions).toContain(`Feature: ${fid}`);
  });

  it('enforces STALE_STATE, PHASE_ORDER_VIOLATION with targets, and archived', async () => {
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' })).rejects.toMatchObject({ code: 'STALE_STATE' });
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'verify' })).rejects.toMatchObject({ code: 'PHASE_ORDER_VIOLATION', details: { forward: ['implement'], backward: [] } });
    await expect(advancePhase(deps, { feature_id: 'f_nope', actor: 'd', expected_phase: 'specify', target_phase: 'implement' })).rejects.toMatchObject({ code: 'FEATURE_NOT_FOUND' });
  });

  it('runs the full loop to archived and refuses further moves', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    expect((await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' })).result).toBe('pass');
    const v = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(v.result).toBe('pass');
    const a = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' });
    expect(a.result).toBe('pass');
    expect(a.feature.status).toBe('archived');
    expect(a.next_instructions).toContain('archived');
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' })).rejects.toMatchObject({ code: 'FEATURE_ARCHIVED' });
    const ctx = await getContext(deps, { feature_id: fid, actor: 'd' });
    expect(ctx.feature.status).toBe('archived');
    expect(ctx.context_pack).toContain('Phase: integrate');
  });

  it('requires evidence out of verify and mandates approval there for high risk', async () => {
    const risky = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Fix auth', decision: { ...decision, high_risk: true } });
    const id = risky.feature_id;
    await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'implement', target_phase: 'verify' });
    const noEvidence = await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', human_approved: true });
    expect(noEvidence.findings[0]).toMatchObject({ check: 'verify_evidence', severity: 'blocker' });
    const noApproval = await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(noApproval.findings).toEqual([expect.objectContaining({ check: 'human_approved' })]);
    expect((await advancePhase(deps, { feature_id: id, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence, human_approved: true })).result).toBe('pass');
  });

  it('handles backward moves, failed cycles, blocking and the unblock', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' });
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'implement' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('reason') });
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'specify', cycle_failed: true, reason: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('cycle_failed') });
    for (let i = 1; i <= 3; i++) {
      const back = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'implement', cycle_failed: true, reason: `red ${i}` });
      expect(back.feature.failed_cycles).toBe(i);
      expect(back.feature.current_phase).toBe('implement');
      if (i < 3) { expect(back.feature.status).toBe('active'); await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' }); }
      else expect(back.feature).toMatchObject({ status: 'blocked', blocked_reason: 'red 3' });
    }
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' })).rejects.toMatchObject({ code: 'FEATURE_BLOCKED' });
    const unblock = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'rethink' });
    expect(unblock.feature).toMatchObject({ status: 'active', failed_cycles: 0, current_phase: 'specify', blocked_reason: null });
    const t = (await deps.pool.query('SELECT direction, reason FROM phase_transitions WHERE feature_id = $1 AND direction = $2 ORDER BY created_at', [fid, 'backward'])).rows;
    expect(t.map((x) => x.reason)).toEqual(['red 1', 'red 2', 'red 3', 'rethink']);
  });

  it('repins to the current framework version on a backward move', async () => {
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    await deps.pool.query(`INSERT INTO frameworks (id, name, pack_version, tracks, gate_library_version, status, created_by) SELECT 'fw_new', name, '1.1.0', tracks, gate_library_version, 'active', 'seed' FROM frameworks WHERE name = 'mini'`);
    const noRepin = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'x' });
    expect(noRepin.feature.framework_pack_version).toBe('1.0.0');
    await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true });
    const repinned = await advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'specify', reason: 'x', repin: true });
    expect(repinned.feature.framework_pack_version).toBe('1.1.0');
    await expect(advancePhase(deps, { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', repin: true, artifacts: { 'proposal.md': goodProposal }, human_approved: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('repin') });
  });

  it('serialises concurrent transitions: one passes, the other gets STALE_STATE', async () => {
    const input = { feature_id: fid, actor: 'd', expected_phase: 'specify' as const, target_phase: 'implement', artifacts: { 'proposal.md': goodProposal }, human_approved: true };
    const results = await Promise.allSettled([advancePhase(deps, input), advancePhase(deps, input)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toMatchObject({ code: 'STALE_STATE' });
  });

  it('getContext persists a pack for the requested phase with focus and scope', async () => {
    const c = await getContext(deps, { feature_id: fid, actor: 'prompt', phase: 'specify', focus: 'ADR-1', scope: 'company' });
    expect(c.pack_id).toMatch(/^cp_/);
    const row = (await deps.pool.query('SELECT * FROM context_packs WHERE id = $1', [c.pack_id])).rows[0];
    expect(row).toMatchObject({ created_by: 'prompt', focus: 'ADR-1', scope: 'company', phase: 'specify' });
    await expect(getContext(deps, { feature_id: fid, actor: 'd', phase: 'plan' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/advance.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement src/services/advancePhase.ts**

```ts
import { withTransaction } from '../db/pool.js';
import type { Finding, Phase, PhaseOrArchived } from '../domain/types.js';
import { isPhase } from '../domain/phases.js';
import { DomainError, firstByPrecedence } from '../errors.js';
import { runGate } from '../gates/run.js';
import { applyBackwardMove, isCycleMove } from '../lifecycle/cycles.js';
import { renderPhaseInstructions } from '../lifecycle/instructions.js';
import { allowedTargets, classifyMove, mandatesApproval } from '../lifecycle/reachability.js';
import { gateFor } from '../lifecycle/track.js';
import { requireFeature, updateFeature } from '../store/features.js';
import { currentFramework } from '../store/frameworks.js';
import { getPack, latestPack } from '../store/packs.js';
import { insertArtifacts, insertTransition, sha256 } from '../store/transitions.js';
import type { ServiceDeps } from './deps.js';
import { featureState, loadTrack, type FeatureState } from './featureState.js';

export interface AdvancePhaseInput {
  feature_id: string; actor: string; expected_phase: Phase; target_phase: string; artifacts?: Record<string, string>; evidence?: unknown;
  human_approved?: boolean; cycle_failed?: boolean; pack_id?: string | null; reason?: string | null; repin?: boolean;
}
export interface AdvancePhaseResult { result: 'pass' | 'fail'; findings: Finding[]; next_instructions: string | null; feature: FeatureState; warnings: string[] }

export async function advancePhase(deps: ServiceDeps, input: AdvancePhaseInput): Promise<AdvancePhaseResult> {
  return withTransaction(deps.pool, async (tx) => {
    const feature = await requireFeature(tx, input.feature_id, { forUpdate: true });
    const errors: DomainError[] = [];
    if (feature.status === 'archived') errors.push(new DomainError('FEATURE_ARCHIVED', `feature ${feature.id} is archived`, { feature_id: feature.id }));
    if (feature.current_phase !== input.expected_phase) {
      errors.push(new DomainError('STALE_STATE', `expected_phase ${input.expected_phase} but the feature is in ${feature.current_phase}`, { current_phase: feature.current_phase }));
    }
    if (errors.length > 0) throw firstByPrecedence(errors);

    const track = await loadTrack(tx, feature);
    const direction = classifyMove(track, feature.current_phase, input.target_phase);
    if (!direction) {
      const targets = allowedTargets(track, feature.current_phase);
      throw new DomainError('PHASE_ORDER_VIOLATION', `cannot move from ${feature.current_phase} to ${input.target_phase}`, { forward: targets.forward, backward: targets.backward });
    }
    const target = input.target_phase as PhaseOrArchived;
    const validation = (msg: string, field: string) => new DomainError('VALIDATION_ERROR', msg, { field });
    if (direction === 'backward' && !input.reason) errors.push(validation('reason is required for backward moves', 'reason'));
    if (input.cycle_failed && !(direction === 'backward' && isPhase(target) && isCycleMove(feature.current_phase, target))) {
      errors.push(validation('cycle_failed is accepted only on the backward move from verify to implement', 'cycle_failed'));
    }
    if (input.repin && direction === 'forward') errors.push(validation('repin is accepted only on backward moves', 'repin'));
    let packId: string | null = null;
    if (input.pack_id) {
      const pack = await getPack(tx, input.pack_id);
      if (!pack || pack.feature_id !== feature.id) errors.push(validation(`pack_id ${input.pack_id} does not belong to this feature`, 'pack_id'));
      else packId = pack.id;
    } else {
      packId = (await latestPack(tx, feature.id, feature.current_phase))?.id ?? null;
    }
    if (direction === 'forward' && feature.status === 'blocked') {
      errors.push(new DomainError('FEATURE_BLOCKED', `feature is blocked: ${feature.blocked_reason ?? 'no reason recorded'}`, { blocked_reason: feature.blocked_reason }));
    }
    if (errors.length > 0) throw firstByPrecedence(errors);

    const artifacts = input.artifacts ?? {};
    const artifactHashes = Object.fromEntries(Object.entries(artifacts).map(([n, c]) => [n, sha256(c)]));
    const warnings: string[] = [];

    if (direction === 'forward') {
      const gate = gateFor(track, feature.current_phase, target);
      const mandated = mandatesApproval(track, feature.current_phase, target, feature.high_risk);
      const outcome = runGate(gate, { artifacts, evidence: input.evidence ?? null, human_approved: input.human_approved ?? false }, mandated);
      for (const f of outcome.findings) deps.metrics?.gate(f.check, f.severity === 'blocker' ? 'fail' : 'pass');
      const transition = await insertTransition(tx, {
        feature_id: feature.id, from_phase: feature.current_phase, to_phase: target, direction, result: outcome.result, findings: outcome.findings,
        evidence: input.evidence ?? null, pack_id: packId, artifact_hashes: artifactHashes, human_approved: input.human_approved ?? false, reason: input.reason ?? null,
      }, input.actor);
      await insertArtifacts(tx, transition.id, artifacts, input.actor);
      if (outcome.result === 'fail') {
        const { state } = await featureState(tx, feature);
        return { result: 'fail', findings: outcome.findings, next_instructions: null, feature: state, warnings };
      }
      const updated = target === 'archived'
        ? await updateFeature(tx, feature.id, { status: 'archived' })
        : await updateFeature(tx, feature.id, { current_phase: target });
      const { state } = await featureState(tx, updated);
      const next = target === 'archived'
        ? `Feature ${feature.id} is archived. Its packs, transitions and artifacts remain readable through get_feature_status and get_context.`
        : renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: target, track_decl: track });
      return { result: 'pass', findings: outcome.findings, next_instructions: next, feature: state, warnings };
    }

    // backward
    const to = target as Phase;
    const cycle = applyBackwardMove({ failed_cycles: feature.failed_cycles, status: feature.status as 'active' | 'blocked' }, feature.current_phase, to, input.cycle_failed ?? false, input.reason!);
    if (input.cycle_failed) deps.metrics?.failedCycle();
    let packVersion = feature.framework_pack_version;
    if (input.repin) {
      const current = await currentFramework(tx, feature.framework);
      if (current && current.pack_version !== packVersion) { packVersion = current.pack_version; warnings.push(`repinned to ${feature.framework}@${packVersion}`); }
      else warnings.push('repin requested but the feature is already on the current version');
    }
    await insertTransition(tx, {
      feature_id: feature.id, from_phase: feature.current_phase, to_phase: to, direction, result: 'pass', findings: [], evidence: null, pack_id: packId,
      artifact_hashes: artifactHashes, human_approved: input.human_approved ?? false, reason: input.reason ?? null,
    }, input.actor);
    const updated = await updateFeature(tx, feature.id, {
      current_phase: to, status: cycle.status, failed_cycles: cycle.failed_cycles,
      blocked_reason: cycle.status === 'blocked' ? (cycle.blocked_reason ?? feature.blocked_reason) : null, framework_pack_version: packVersion,
    });
    const trackNow = await loadTrack(tx, updated);
    const { state } = await featureState(tx, updated);
    if (cycle.blocked_now) warnings.push('feature is now blocked after three failed cycles; any backward move unblocks it');
    return { result: 'pass', findings: [], next_instructions: renderPhaseInstructions({ feature_id: feature.id, framework: feature.framework, track: feature.track, phase: to, track_decl: trackNow }), feature: state, warnings };
  });
}
```

- [ ] **Step 4: Implement src/services/getContext.ts**

```ts
import { assembleContextPack } from '../assembler/assemble.js';
import { withTransaction } from '../db/pool.js';
import type { Phase, Scope } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { DomainError } from '../errors.js';
import { phaseOrder } from '../lifecycle/track.js';
import { requireFeature } from '../store/features.js';
import type { AppRow } from '../store/rows.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface GetContextInput { feature_id: string; actor: string; phase?: Phase | null; focus?: string | null; scope?: Scope }
export interface GetContextResult { context_pack: string; pack_id: string; feature: FeatureState; warnings: string[] }

export async function getContext(deps: ServiceDeps, input: GetContextInput): Promise<GetContextResult> {
  if (deps.embedder) await assertEmbeddingConfigMatches(deps.pool, deps.embedder);
  return withTransaction(deps.pool, async (tx) => {
    const feature = await requireFeature(tx, input.feature_id);
    const { state, track } = await featureState(tx, feature);
    const phase = input.phase ?? feature.current_phase;
    if (!phaseOrder(track).includes(phase)) {
      throw new DomainError('VALIDATION_ERROR', `phase ${phase} is skipped in track ${feature.track ?? 'default'}`, { field: 'phase', phases: phaseOrder(track) });
    }
    const app = (await tx.query<AppRow>('SELECT * FROM apps WHERE id = $1', [feature.app_id])).rows[0]!;
    const { pack, warnings } = await assembleContextPack({ q: tx, embedder: deps.embedder, defaultBudget: deps.tokenBudget }, {
      feature, app, phase, focus: input.focus ?? null, scope: input.scope ?? 'app', createdBy: input.actor,
    });
    if (pack.degraded) deps.metrics?.degradedPack();
    if (pack.over_budget) deps.metrics?.overBudgetPack();
    return { context_pack: pack.rendered, pack_id: pack.id, feature: state, warnings };
  });
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/advance.test.ts && npm run typecheck`
Expected: PASS. The concurrency test relies on `FOR UPDATE`: the second transaction waits for the first to commit, then sees `current_phase = implement` and throws `STALE_STATE`.

- [ ] **Step 6: Commit**

```bash
git add src/services/advancePhase.ts src/services/getContext.ts test/integration/services/advance.test.ts
git commit -m "feat(services): advance_phase with locking, gates, cycles, archive and repin; get_context"
```

### Task 35: get_feature_status, list_features, search_memory, propose_memory services

**Files:**
- Create: `src/services/featureStatus.ts`, `src/services/listFeatures.ts`, `src/services/searchMemory.ts`, `src/services/proposeMemory.ts`
- Test: `test/integration/services/readAndPropose.test.ts`

**Interfaces:**

```ts
// src/services/featureStatus.ts
export interface FeatureStatusResult extends FeatureState { transitions: { id; from_phase; to_phase; direction; result; human_approved; reason; created_by; created_at; findings_count: number }[]; latest_pack_per_phase: Record<string, string> }
export async function getFeatureStatus(deps, featureId: string): Promise<FeatureStatusResult>
// src/services/listFeatures.ts
export interface ListFeaturesInput { app: string; status?: FeatureStatus[]; external_ref?: string | null; limit?: number }
export async function listFeaturesService(deps, input): Promise<{ features: { feature_id; slug; intent; framework; track; current_phase; status; external_ref; trigger_ref; updated_at: string }[] }>
// src/services/searchMemory.ts
export interface SearchMemoryInput { query: string; app: string; scope?: Scope; kinds?: KnowledgeKind[]; limit?: number }
export interface SearchChunk { item_id; stable_id; version; app: string | null; kind; memory_type; heading_path; text; score; match }
export async function searchMemory(deps, input): Promise<{ chunks: SearchChunk[]; degraded: boolean; warnings: string[] }>
// src/services/proposeMemory.ts
export interface ProposeMemoryInput { feature_id; actor; kind: 'app_memory' | 'standard'; memory_type?: MemoryType | null; title; body; stack_tags?: string[]; links?: string[]; supersedes?: string | null }
export async function proposeMemory(deps, input): Promise<{ proposal_id: string; status: 'pending' }>   // FEATURE_ARCHIVED on archived; VALIDATION_ERROR for app_memory without memory_type
```

- [ ] **Step 1: Write the failing test**

`test/integration/services/readAndPropose.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedAll, embedder } from '../../helpers/seed.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getFeatureStatus } from '../../../src/services/featureStatus.js';
import { listFeaturesService } from '../../../src/services/listFeatures.js';
import { searchMemory } from '../../../src/services/searchMemory.js';
import { proposeMemory } from '../../../src/services/proposeMemory.js';
import { createApp } from '../../../src/store/apps.js';
import { insertItemVersion } from '../../../src/store/knowledge.js';
import { insertChunks } from '../../../src/store/chunks.js';
import { fakeEmbed } from '../../../src/embedding/fake.js';
import type { ServiceDeps } from '../../../src/services/deps.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' } as const;

describe.skipIf(!url)('read services and propose_memory', () => {
  let deps: ServiceDeps;
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); deps = { pool, embedder, tokenBudget: 6000 }; });
  afterAll(closeTestPool);

  it('reports status with transitions and latest packs', async () => {
    const s = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision, external_ref: 'YAL-1' });
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': 'TBD' }, human_approved: true });
    const st = await getFeatureStatus(deps, s.feature_id);
    expect(st).toMatchObject({ feature_id: s.feature_id, current_phase: 'specify', phase_alias: 'proposal', external_ref: 'YAL-1', allowed_targets: { forward: ['implement'], backward: [] } });
    expect(st.transitions).toHaveLength(1);
    expect(st.transitions[0]).toMatchObject({ from_phase: 'specify', to_phase: 'implement', result: 'fail', created_by: 'd' });
    expect(st.transitions[0]?.findings_count).toBeGreaterThan(0);
    expect(st.latest_pack_per_phase).toEqual({ specify: s.pack_id });
    await expect(getFeatureStatus(deps, 'f_nope')).rejects.toMatchObject({ code: 'FEATURE_NOT_FOUND' });
  });

  it('lists features by app, status and external_ref', async () => {
    const a = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'A', decision, external_ref: 'YAL-1' });
    const b = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'B', decision });
    await deps.pool.query(`UPDATE features SET status = 'archived' WHERE id = $1`, [b.feature_id]);
    expect((await listFeaturesService(deps, { app: 'checkout' })).features.map((f) => f.feature_id)).toEqual([a.feature_id]);
    expect((await listFeaturesService(deps, { app: 'checkout', status: ['archived'] })).features.map((f) => f.feature_id)).toEqual([b.feature_id]);
    expect((await listFeaturesService(deps, { app: 'checkout', status: ['active', 'archived'], external_ref: 'YAL-1' })).features).toHaveLength(1);
    expect((await listFeaturesService(deps, { app: 'checkout' })).features[0]).toMatchObject({ slug: 'yal-1-a', framework: 'mini', current_phase: 'specify', updated_at: expect.any(String) });
    await expect(listFeaturesService(deps, { app: 'nope' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });

  it('searches memory with scope semantics and exact ids', async () => {
    const billing = await createApp(deps.pool, { slug: 'billing', name: 'B' }, 'seed');
    const checkoutId = (await deps.pool.query(`SELECT id FROM apps WHERE slug = 'checkout'`)).rows[0].id;
    for (const [slug, appId, id, title] of [['checkout', checkoutId, 'checkout.adr.0001', 'ADR-1 csv export orders'], ['billing', billing.id, 'billing.adr.0001', 'billing csv export orders']] as const) {
      const row = await insertItemVersion(deps.pool, { stable_id: id, kind: 'app_memory', tier: 'retrieved', framework: null, app_id: appId, memory_type: 'adr', human_id: title.startsWith('ADR') ? 'ADR-1' : null, stack_tags: [], phase_tags: [], title, body: 'csv export orders', front_matter: {}, pack_name: 'proposals', pack_version: null, source_path: null, source_hash: null, source_url: null, license: null }, 'seed');
      await insertChunks(deps.pool, row.id, [{ ordinal: 0, heading_path: '', text: `${slug} csv export orders`, embedding: fakeEmbed(`${title}\n\n${slug} csv export orders`), embedding_model: 'fake-1024', token_count: 4, tokenizer: 'cl100k_base' }], 'seed');
    }
    const app = await searchMemory(deps, { query: 'csv export orders', app: 'checkout' });
    expect(app.chunks.map((c) => c.stable_id)).toContain('checkout.adr.0001');
    expect(app.chunks.map((c) => c.stable_id)).not.toContain('billing.adr.0001');
    expect(app.chunks.find((c) => c.stable_id === 'checkout.adr.0001')?.app).toBe('checkout');
    const company = await searchMemory(deps, { query: 'csv export orders', app: 'checkout', scope: 'company' });
    expect(company.chunks.map((c) => c.stable_id)).not.toContain('checkout.adr.0001');
    const listed = await searchMemory(deps, { query: 'csv export orders', app: 'checkout', scope: ['billing'], kinds: ['app_memory'] });
    expect(listed.chunks.map((c) => c.stable_id)).toEqual(['billing.adr.0001']);
    const exact = await searchMemory(deps, { query: 'what did ADR-1 decide', app: 'checkout' });
    expect(exact.chunks[0]).toMatchObject({ stable_id: 'checkout.adr.0001', match: 'exact_id' });
    const degraded = await searchMemory({ ...deps, embedder: null }, { query: 'ADR-1', app: 'checkout' });
    expect(degraded.degraded).toBe(true);
    expect(degraded.chunks.map((c) => c.stable_id)).toEqual(['checkout.adr.0001']);
  });

  it('stores proposals and refuses archived features', async () => {
    const s = await startFeature(deps, { app: 'checkout', actor: 'd', task_description: 'A', decision });
    const p = await proposeMemory(deps, { feature_id: s.feature_id, actor: 'd', kind: 'app_memory', memory_type: 'adr', title: 'ADR-9 stream exports', body: 'Stream.', links: ['archive/x'], supersedes: 'checkout.adr.0001' });
    expect(p).toEqual({ proposal_id: expect.stringMatching(/^p_/), status: 'pending' });
    const row = (await deps.pool.query('SELECT * FROM proposals WHERE id = $1', [p.proposal_id])).rows[0];
    expect(row).toMatchObject({ supersedes: 'checkout.adr.0001', created_by: 'd', status: 'pending' });
    expect(row.payload).toMatchObject({ kind: 'app_memory', memory_type: 'adr', title: 'ADR-9 stream exports', links: ['archive/x'] });
    await expect(proposeMemory(deps, { feature_id: s.feature_id, actor: 'd', kind: 'app_memory', title: 't', body: 'b' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await deps.pool.query(`UPDATE features SET status = 'archived' WHERE id = $1`, [s.feature_id]);
    await expect(proposeMemory(deps, { feature_id: s.feature_id, actor: 'd', kind: 'standard', title: 't', body: 'b' })).rejects.toMatchObject({ code: 'FEATURE_ARCHIVED' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services/readAndPropose.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the four services**

`src/services/featureStatus.ts`:

```ts
import { requireFeature } from '../store/features.js';
import { latestPackPerPhase } from '../store/packs.js';
import { listTransitions } from '../store/transitions.js';
import type { ServiceDeps } from './deps.js';
import { featureState, type FeatureState } from './featureState.js';

export interface TransitionSummary {
  id: string; from_phase: string; to_phase: string; direction: string; result: string; human_approved: boolean; reason: string | null;
  created_by: string; created_at: string; findings_count: number;
}
export interface FeatureStatusResult extends FeatureState { transitions: TransitionSummary[]; latest_pack_per_phase: Record<string, string> }

export async function getFeatureStatus(deps: ServiceDeps, featureId: string): Promise<FeatureStatusResult> {
  const q = deps.pool;
  const feature = await requireFeature(q, featureId);
  const { state } = await featureState(q, feature);
  const transitions = (await listTransitions(q, feature.id)).map((t) => ({
    id: t.id, from_phase: t.from_phase, to_phase: t.to_phase, direction: t.direction, result: t.result, human_approved: t.human_approved,
    reason: t.reason, created_by: t.created_by, created_at: t.created_at.toISOString(), findings_count: t.findings.length,
  }));
  return { ...state, transitions, latest_pack_per_phase: await latestPackPerPhase(q, feature.id) };
}
```

`src/services/listFeatures.ts`:

```ts
import type { FeatureStatus } from '../domain/types.js';
import { requireApp } from '../store/apps.js';
import { listFeatures } from '../store/features.js';
import type { ServiceDeps } from './deps.js';

export interface ListFeaturesInput { app: string; status?: FeatureStatus[]; external_ref?: string | null; limit?: number }
export interface FeatureSummary {
  feature_id: string; slug: string; intent: string; framework: string; track: string | null; current_phase: string; status: string;
  external_ref: string | null; trigger_ref: string | null; updated_at: string;
}

export async function listFeaturesService(deps: ServiceDeps, input: ListFeaturesInput): Promise<{ features: FeatureSummary[] }> {
  const app = await requireApp(deps.pool, input.app);
  const rows = await listFeatures(deps.pool, app.id, input.status ?? ['active', 'blocked'], input.external_ref ?? null, input.limit ?? 50);
  return {
    features: rows.map((f) => ({
      feature_id: f.id, slug: f.slug, intent: f.intent, framework: f.framework, track: f.track, current_phase: f.current_phase, status: f.status,
      external_ref: f.external_ref, trigger_ref: f.trigger_ref, updated_at: f.updated_at.toISOString(),
    })),
  };
}
```

`src/services/searchMemory.ts`:

```ts
import { extractExactIds } from '../assembler/exactIds.js';
import { resolveScope } from '../assembler/layers.js';
import { DEFAULT_MIN_SIMILARITY, retrieve } from '../assembler/retrieve.js';
import type { KnowledgeKind, MemoryType, Scope } from '../domain/types.js';
import { assertEmbeddingConfigMatches } from '../embedding/index.js';
import { requireApp } from '../store/apps.js';
import type { ServiceDeps } from './deps.js';

export interface SearchMemoryInput { query: string; app: string; scope?: Scope; kinds?: KnowledgeKind[]; limit?: number }
export interface SearchChunk {
  item_id: string; stable_id: string; version: number; app: string | null; kind: KnowledgeKind; memory_type: MemoryType | null;
  heading_path: string; text: string; score: number; match: 'vector' | 'exact_id';
}

export async function searchMemory(deps: ServiceDeps, input: SearchMemoryInput): Promise<{ chunks: SearchChunk[]; degraded: boolean; warnings: string[] }> {
  const q = deps.pool;
  const app = await requireApp(q, input.app);
  if (deps.embedder) await assertEmbeddingConfigMatches(q, deps.embedder);
  const scope = await resolveScope(q, input.scope ?? 'app', app);
  const { chunks, degraded } = await retrieve({ q, embedder: deps.embedder }, {
    query: input.query, ids: extractExactIds(input.query), minSimilarity: app.min_similarity ?? DEFAULT_MIN_SIMILARITY, limit: input.limit ?? 8,
    filter: { scope, framework: null, frameworkPackVersion: null, phase: null, kinds: input.kinds ?? ['framework_pack', 'standard', 'stack_guide', 'app_memory'] },
  });
  const appIds = [...new Set(chunks.map((c) => c.app_id).filter((x): x is string => x !== null))];
  const slugs = appIds.length > 0 ? new Map((await q.query<{ id: string; slug: string }>('SELECT id, slug FROM apps WHERE id = ANY($1)', [appIds])).rows.map((r) => [r.id, r.slug])) : new Map<string, string>();
  return {
    chunks: chunks.map((c) => ({ item_id: c.item_id, stable_id: c.stable_id, version: c.version, app: c.app_id ? slugs.get(c.app_id) ?? null : null, kind: c.kind, memory_type: c.memory_type, heading_path: c.heading_path, text: c.text, score: c.score, match: c.match })),
    degraded,
    warnings: degraded ? ['retrieval degraded: embedding provider unavailable, exact-id matches only'] : [],
  };
}
```

`src/services/proposeMemory.ts`:

```ts
import type { MemoryType } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { requireFeature } from '../store/features.js';
import { insertProposal } from '../store/proposals.js';
import type { ServiceDeps } from './deps.js';

export interface ProposeMemoryInput {
  feature_id: string; actor: string; kind: 'app_memory' | 'standard'; memory_type?: MemoryType | null; title: string; body: string;
  stack_tags?: string[]; links?: string[]; supersedes?: string | null;
}

export async function proposeMemory(deps: ServiceDeps, input: ProposeMemoryInput): Promise<{ proposal_id: string; status: 'pending' }> {
  if (input.kind === 'app_memory' && !input.memory_type) throw new DomainError('VALIDATION_ERROR', 'memory_type is required for app_memory proposals', { field: 'memory_type' });
  const feature = await requireFeature(deps.pool, input.feature_id);
  if (feature.status === 'archived') throw new DomainError('FEATURE_ARCHIVED', `feature ${feature.id} is archived`, { feature_id: feature.id });
  const row = await insertProposal(deps.pool, {
    app_id: feature.app_id, feature_id: feature.id, supersedes: input.supersedes ?? null,
    payload: { kind: input.kind, memory_type: input.memory_type ?? null, title: input.title, body: input.body, stack_tags: input.stack_tags ?? [], links: input.links ?? [] },
  }, input.actor);
  return { proposal_id: row.id, status: 'pending' };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/services && npm run typecheck`
Expected: PASS for all service tests.

- [ ] **Step 5: Commit**

```bash
git add src/services test/integration/services/readAndPropose.test.ts
git commit -m "feat(services): feature status, list features, search memory and propose memory"
```

---

## Part J: MCP surface and transports

Wire rules (spec §7.2): every successful tool result carries `structuredContent` matching a declared `outputSchema` plus one `text` block; `route_task`, `start_feature`, `get_context` and `advance_phase` put the rendered pack or instructions in that text block, other tools put pretty JSON there. Domain errors are results with `isError: true` and a single text block `{code, message, details}`. Zod input failures inside a handler are encoded as `VALIDATION_ERROR`.

### Task 36: Result encoding, shared schemas, server factory, stdio entry, contract harness and route_task

**Files:**
- Create: `src/mcp/encode.ts`, `src/mcp/schemas.ts`, `src/mcp/server.ts`, `src/mcp/tools/routeTask.ts`, `src/mcp/stdio.ts`, `src/index.ts`, `src/logging.ts`, `test/helpers/mcp.ts`
- Test: `test/unit/mcp/encode.test.ts`, `test/contract/routeTask.test.ts`

**Interfaces:**

```ts
// src/mcp/encode.ts
export function okResult<T extends Record<string, unknown>>(structured: T, text: string): CallToolResult
export function errorResult(err: DomainError): CallToolResult
export async function guarded<T extends Record<string, unknown>>(logger, tool: string, fn: () => Promise<{ structured: T; text: string }>): Promise<CallToolResult>
// src/mcp/schemas.ts
export const WorkspaceShape, DecisionShape, ScopeSchema, PhaseSchema, ActorSchema, FeatureStateShape, WarningsShape
// src/mcp/server.ts
export interface McpDeps extends ServiceDeps { logger: Logger }
export function createMcpServer(deps: McpDeps): McpServer          // registers 8 tools, resources, prompts
// src/mcp/stdio.ts
export async function runStdio(deps: McpDeps): Promise<void>
// src/index.ts: `sdd-orchestrator` (HTTP, Task 42) or `sdd-orchestrator --stdio`
// test/helpers/mcp.ts
export async function withClient(mode: 'stdio' | 'http', fn: (client: Client, info: { baseUrl: string | null }) => Promise<void>): Promise<void>
export function textOf(result): string; export function structuredOf<T>(result): T; export function errorOf(result): { code; message; details }
```

- [ ] **Step 1: Write the failing unit test for encoding**

`test/unit/mcp/encode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { okResult, errorResult, guarded } from '../../../src/mcp/encode.js';
import { DomainError } from '../../../src/errors.js';
import { z } from 'zod';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => logger } as never;

describe('encode', () => {
  it('okResult carries structuredContent and one text block', () => {
    const r = okResult({ a: 1, warnings: [] }, 'hello');
    expect(r.structuredContent).toEqual({ a: 1, warnings: [] });
    expect(r.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(r.isError).toBeUndefined();
  });
  it('errorResult encodes the domain error as JSON text', () => {
    const r = errorResult(new DomainError('STALE_STATE', 'stale', { current_phase: 'plan' }));
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ code: 'STALE_STATE', message: 'stale', details: { current_phase: 'plan' } });
  });
  it('guarded maps DomainError and ZodError, rethrows others', async () => {
    const dom = await guarded(logger, 't', async () => { throw new DomainError('APP_NOT_FOUND', 'x'); });
    expect(dom.isError).toBe(true);
    const zod = await guarded(logger, 't', async () => { z.object({ a: z.string() }).parse({}); return { structured: {}, text: '' }; });
    expect(JSON.parse((zod.content[0] as { text: string }).text)).toMatchObject({ code: 'VALIDATION_ERROR', details: { issues: [expect.objectContaining({ path: 'a' })] } });
    await expect(guarded(logger, 't', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/mcp/encode.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement logging.ts and encode.ts**

`src/logging.ts`:

```ts
import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level = process.env.SDD_LOG_LEVEL ?? 'info'): Logger {
  // fd 2 is stderr: stdout belongs to the stdio transport.
  return pino({ level, base: { service: 'sdd-orchestrator' } }, pino.destination({ dest: 2, sync: false }));
}
```

Logs go to stderr so stdio transport (which owns stdout) stays clean.

`src/mcp/encode.ts`:

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { DomainError, isDomainError } from '../errors.js';
import type { Logger } from '../logging.js';

export function okResult<T extends Record<string, unknown>>(structured: T, text: string): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

export function errorResult(err: DomainError): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
}

export async function guarded<T extends Record<string, unknown>>(
  logger: Logger, tool: string, fn: () => Promise<{ structured: T; text: string }>,
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const { structured, text } = await fn();
    logger.info({ tool, duration_ms: Date.now() - started, ok: true }, 'tool call');
    return okResult(structured, text);
  } catch (e) {
    if (isDomainError(e)) {
      logger.info({ tool, duration_ms: Date.now() - started, ok: false, code: e.code }, 'tool call failed');
      return errorResult(e);
    }
    if (e instanceof ZodError) {
      const err = new DomainError('VALIDATION_ERROR', e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), {
        issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return errorResult(err);
    }
    logger.error({ tool, err: e }, 'tool call crashed');
    throw e;
  }
}
```

- [ ] **Step 4: Implement schemas.ts**

`src/mcp/schemas.ts`:

```ts
import { z } from 'zod';
import { INTENTS, PHASES } from '../domain/types.js';

export const PhaseSchema = z.enum(PHASES);
export const ActorSchema = z.string().min(1).describe('Display identity of the person or agent making the call; attribution only');
export const ScopeSchema = z.union([z.literal('app'), z.literal('company'), z.array(z.string().min(1))])
  .describe('"app" = company items plus this app; "company" = company items only; ["slug", ...] = company items plus the listed apps');

export const WorkspaceShape = z.object({
  stack: z.array(z.string()).nullable().optional(),
  intent: z.enum([...INTENTS, 'auto']).nullable().optional(),
  is_greenfield: z.boolean().nullable().optional(),
  has_spec_library: z.boolean().nullable().optional(),
  estimated_files: z.number().int().nonnegative().nullable().optional(),
  paths_touched: z.array(z.string()).nullable().optional(),
  repositories: z.number().int().nonnegative().nullable().optional(),
  new_subsystem: z.boolean().nullable().optional(),
  host: z.string().nullable().optional(),
}).describe('Workspace facts derived by the host (see docs/verification/workspace-facts.sh); null means unknown');

export const DecisionShape = z.object({
  intent: z.enum(INTENTS),
  framework: z.string(),
  track: z.string().nullable(),
  confidence: z.enum(['high', 'medium']),
  rule: z.string(),
  reasons: z.array(z.string()),
  high_risk: z.boolean(),
  policy_version: z.number().int().nullable(),
  framework_pack_version: z.string().nullable(),
});

export const FeatureStateShape = z.object({
  feature_id: z.string(), app: z.string(), slug: z.string(), intent: z.string(), framework: z.string(), framework_pack_version: z.string(),
  track: z.string().nullable(), current_phase: z.string(), phase_alias: z.string(), status: z.string(), blocked_reason: z.string().nullable(),
  high_risk: z.boolean(), failed_cycles: z.number().int(), external_ref: z.string().nullable(), trigger_ref: z.string().nullable(),
  allowed_targets: z.object({ forward: z.array(z.string()), backward: z.array(z.string()) }),
});

export const WarningsShape = z.array(z.string());
export const FindingShape = z.object({ check: z.string(), severity: z.enum(['blocker', 'warning']), location: z.string().nullable(), message: z.string() });
export const AttachedLayerShape = z.object({ pack_name: z.string(), pack_version: z.string(), kind: z.string() });
export const LitePackShape = z.object({ rendered: z.string(), token_count: z.number().int(), budget: z.number().int(), degraded: z.boolean(), over_budget: z.boolean(), items: z.array(z.object({ stable_id: z.string(), version: z.number().int() })) });
```

- [ ] **Step 5: Implement the route_task tool**

`src/mcp/tools/routeTask.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { routeTask } from '../../services/routeTask.js';
import { guarded } from '../encode.js';
import { AttachedLayerShape, DecisionShape, LitePackShape, WarningsShape, WorkspaceShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerRouteTask(server: McpServer, deps: McpDeps): void {
  server.registerTool('route_task', {
    title: 'Route a task to an SDD framework',
    description: [
      'Decides which spec-driven-development framework and track fit a task, using explainable rules over the app policy, the task text and workspace facts.',
      'Use it first for any new piece of work, and again with better facts when it returns clarifying_questions. It is read-only and writes nothing.',
      'Returns decision {intent, framework or "none", track, confidence, rule, reasons, high_risk, policy_version, framework_pack_version}, clarifying_questions at medium confidence,',
      'guidance for spikes, a lite_pack for trivial work (no feature, no gates) and attached_layers. Pass the decision to start_feature to create lifecycle state.',
      'Example: route_task({"task_description":"Add CSV export to the orders page","app":"checkout","workspace":{"stack":["typescript","react"],"is_greenfield":false,"has_spec_library":true,"estimated_files":4,"paths_touched":["src/orders/"],"host":"claude-code"}})',
    ].join(' '),
    inputSchema: {
      task_description: z.string().min(1),
      app: z.string().min(1).describe('App slug registered with sdd-admin'),
      workspace: WorkspaceShape,
      framework_preference: z.string().min(1).optional().describe('Framework name, optionally with a track: "bmad:quick"'),
    },
    outputSchema: {
      decision: DecisionShape,
      clarifying_questions: z.array(z.string()),
      guidance: z.string().nullable(),
      lite_pack: LitePackShape.nullable(),
      attached_layers: z.array(AttachedLayerShape),
      warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'route_task', async () => {
    const r = await routeTask(deps, { task_description: args.task_description, app: args.app, workspace: args.workspace, framework_preference: args.framework_preference ?? null });
    const structured = {
      decision: r.decision, clarifying_questions: r.clarifying_questions, guidance: r.guidance,
      lite_pack: r.lite_pack ? { rendered: r.lite_pack.rendered, token_count: r.lite_pack.token_count, budget: r.lite_pack.budget, degraded: r.lite_pack.degraded, over_budget: r.lite_pack.over_budget, items: r.lite_pack.items } : null,
      attached_layers: r.attached_layers, warnings: r.warnings,
    };
    const text = r.lite_pack ? r.lite_pack.rendered : r.guidance ?? JSON.stringify({ decision: r.decision, clarifying_questions: r.clarifying_questions, attached_layers: r.attached_layers, warnings: r.warnings }, null, 2);
    return { structured, text };
  }));
}
```

- [ ] **Step 6: Implement server.ts, stdio.ts and index.ts**

`src/mcp/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../logging.js';
import type { ServiceDeps } from '../services/deps.js';
import { registerRouteTask } from './tools/routeTask.js';

export interface McpDeps extends ServiceDeps { logger: Logger }

export const SERVER_INFO = { name: 'sdd-orchestrator', version: '0.1.0' };

export type Registrar = (server: McpServer, deps: McpDeps) => void;
const registrars: Registrar[] = [registerRouteTask];

/** Later tasks push their registrars here (tools, resources, prompts). */
export function addRegistrar(r: Registrar): void { registrars.push(r); }

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const r of registrars) r(server, deps);
  return server;
}
```

Instead of `addRegistrar` calls at import time, Tasks 37 to 41 append their registrar to the `registrars` array literal directly. Keep the array literal as the single list of what the server exposes.

`src/mcp/stdio.ts`:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, type McpDeps } from './server.js';

export async function runStdio(deps: McpDeps): Promise<void> {
  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
  deps.logger.info('stdio transport connected');
}
```

`src/index.ts` (HTTP branch is completed in Task 42; for now it only supports `--stdio`):

```ts
#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { createEmbeddingProvider } from './embedding/index.js';
import { createLogger } from './logging.js';
import { runStdio } from './mcp/stdio.js';
import type { McpDeps } from './mcp/server.js';

export async function buildDeps(): Promise<McpDeps> {
  const config = loadConfig(process.env);
  const logger = createLogger();
  await runMigrations(config.databaseUrl, (m) => logger.debug(m));
  const pool = createPool(config.databaseUrl);
  const embedder = createEmbeddingProvider(config.embedding);
  return { pool, embedder, tokenBudget: config.tokenBudget, logger };
}

async function main(): Promise<void> {
  const deps = await buildDeps();
  if (process.argv.includes('--stdio')) { await runStdio(deps); return; }
  const { runHttp } = await import('./mcp/http.js');
  await runHttp(deps, loadConfig(process.env));
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
```

Create a placeholder-free `src/mcp/http.ts` in Task 42; until then `tsc` fails on the dynamic import only if the file is missing, so create it now with the real implementation moved forward is not allowed. Instead, in this task write `src/mcp/http.ts` with just:

```ts
import type { Config } from '../config.js';
import type { McpDeps } from './server.js';

export async function runHttp(_deps: McpDeps, _config: Config): Promise<void> {
  throw new Error('HTTP transport is implemented in Task 42; use --stdio');
}
```

Task 42 replaces this file entirely.

- [ ] **Step 7: Write the contract harness**

`test/helpers/mcp.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const TRANSPORTS = ['stdio', 'http'] as const;
export type TransportMode = (typeof TRANSPORTS)[number];

const env = { ...process.env, SDD_DATABASE_URL: process.env.SDD_TEST_DATABASE_URL!, SDD_EMBEDDING_PROVIDER: 'fake', SDD_LOG_LEVEL: 'warn' };

async function waitForHealth(url: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not become healthy`);
}

export interface ClientInfo { baseUrl: string | null }

export async function withClient(mode: TransportMode, fn: (client: Client, info: ClientInfo) => Promise<void>): Promise<void> {
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  let child: ChildProcess | null = null;
  const info: ClientInfo = { baseUrl: null };
  try {
    if (mode === 'stdio') {
      await client.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/index.ts', '--stdio'], env, stderr: 'ignore' }));
    } else {
      const port = 18_000 + Math.floor(Math.random() * 1000);
      child = spawn('npx', ['tsx', 'src/index.ts'], { env: { ...env, SDD_LISTEN: `127.0.0.1:${port}`, SDD_ALLOWED_HOSTS: `127.0.0.1:${port},localhost:${port}` }, stdio: 'ignore' });
      info.baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(`${info.baseUrl}/healthz`);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    }
    await fn(client, info);
  } finally {
    await client.close().catch(() => undefined);
    child?.kill('SIGTERM');
  }
}

export function textOf(result: unknown): string {
  return ((result as CallToolResult).content[0] as { text: string }).text;
}
export function structuredOf<T>(result: unknown): T {
  return (result as CallToolResult).structuredContent as T;
}
export function errorOf(result: unknown): { code: string; message: string; details: Record<string, unknown> } {
  const r = result as CallToolResult;
  if (!r.isError) throw new Error('expected an error result');
  return JSON.parse(textOf(r));
}
```

- [ ] **Step 8: Write the failing contract test for route_task**

`test/contract/routeTask.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;

describe.skipIf(!url)('route_task over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('lists exactly the eight tools with output schemas', async () => {
    await withClient('stdio', async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['advance_phase', 'get_context', 'get_feature_status', 'list_features', 'propose_memory', 'route_task', 'search_memory', 'start_feature']);
      for (const t of tools) { expect(t.description).toMatch(/Example:/); expect(t.outputSchema).toBeDefined(); }
    });
  });

  it('routes, returns structuredContent, and writes nothing', async () => {
    await withClient('stdio', async (client) => {
      const r = await client.callTool({ name: 'route_task', arguments: { task_description: 'Add CSV export', app: 'checkout', workspace: { estimated_files: 4, is_greenfield: false }, framework_preference: 'mini' } });
      const s = structuredOf<{ decision: { framework: string }; attached_layers: unknown[] }>(r);
      expect(s.decision.framework).toBe('mini');
      expect(s.attached_layers).toHaveLength(2);
      expect(JSON.parse(textOf(r)).decision.framework).toBe('mini');
      const pool = await getTestPool();
      expect((await pool.query('SELECT count(*)::int AS n FROM features')).rows[0].n).toBe(0);
    });
  });

  it('returns a lite pack for trivial and errors as isError results', async () => {
    await withClient('stdio', async (client) => {
      const lite = await client.callTool({ name: 'route_task', arguments: { task_description: 'Rename', app: 'checkout', workspace: { intent: 'trivial', estimated_files: 1 } } });
      expect(textOf(lite)).toContain('# Lite pack');
      const err = await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'nope', workspace: {} } });
      expect(errorOf(err)).toMatchObject({ code: 'APP_NOT_FOUND' });
      const unknown = await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: {}, framework_preference: 'aiup' } });
      expect(errorOf(unknown).code).toBe('UNKNOWN_FRAMEWORK');
    });
  });
});
```

The tool-list assertion expects all eight tools; it passes only after Tasks 37 to 39. Run this file after those tasks; for this task, verify only the second and third tests pass by running them with `-t "routes|lite"`.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run test/unit/mcp && SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/routeTask.test.ts -t "routes|lite" && npm run typecheck`
Expected: PASS for encode tests and the two route_task contract tests.

- [ ] **Step 10: Commit**

```bash
git add src/logging.ts src/mcp src/index.ts test/helpers/mcp.ts test/unit/mcp test/contract/routeTask.test.ts
git commit -m "feat(mcp): result encoding, shared schemas, server factory, stdio entry and route_task tool"
```

### Task 37: start_feature and get_context tools

**Files:**
- Create: `src/mcp/tools/startFeature.ts`, `src/mcp/tools/getContext.ts`
- Modify: `src/mcp/server.ts` (add both registrars to the `registrars` array)
- Test: `test/contract/startAndContext.test.ts`

- [ ] **Step 1: Write the failing contract test**

`test/contract/startAndContext.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('start_feature and get_context over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('starts a feature and returns the pack inline', async () => {
    await withClient('stdio', async (client) => {
      const r = await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'daniel', task_description: 'Add CSV export', decision, workspace: { estimated_files: 4 } } });
      const s = structuredOf<{ feature_id: string; pack_id: string; feature: { current_phase: string }; next_instructions: string; context_pack: string }>(r);
      expect(s.feature_id).toMatch(/^f_/);
      expect(s.feature.current_phase).toBe('specify');
      expect(textOf(r)).toBe(s.context_pack);
      expect(textOf(r)).toContain('## Why');
      const ctx = await client.callTool({ name: 'get_context', arguments: { feature_id: s.feature_id, actor: 'daniel', focus: 'ADR-1', scope: 'company' } });
      const c = structuredOf<{ pack_id: string; feature: { feature_id: string } }>(ctx);
      expect(c.pack_id).not.toBe(s.pack_id);
      expect(textOf(ctx)).toContain('# Context pack');
    });
  });

  it('refuses none, unknown framework, missing track and unknown feature', async () => {
    await withClient('stdio', async (client) => {
      const base = { app: 'checkout', actor: 'd', task_description: 'x' };
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { ...base, decision: { ...decision, framework: 'none', track: null } } })).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { ...base, decision: { ...decision, framework: 'aiup' } } })).code).toBe('UNKNOWN_FRAMEWORK');
      expect(errorOf(await client.callTool({ name: 'start_feature', arguments: { ...base, decision: { ...decision, track: 'nope' } } })).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await client.callTool({ name: 'get_context', arguments: { feature_id: 'f_nope', actor: 'd' } })).code).toBe('FEATURE_NOT_FOUND');
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/startAndContext.test.ts`
Expected: FAIL: tool `start_feature` not found.

- [ ] **Step 3: Implement the two tools**

`src/mcp/tools/startFeature.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { startFeature } from '../../services/startFeature.js';
import { guarded } from '../encode.js';
import { ActorSchema, DecisionShape, FeatureStateShape, WarningsShape, WorkspaceShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerStartFeature(server: McpServer, deps: McpDeps): void {
  server.registerTool('start_feature', {
    title: 'Start a feature from an accepted routing decision',
    description: [
      'Creates lifecycle state for a task after the user accepted the route_task decision, pins the current framework version and policy, and builds the first context pack for the specify phase.',
      'Use it once per unit of work; to resume later use get_context or get_feature_status with the feature id. Refused when decision.framework is "none".',
      'Returns feature_id (keep it), context_pack (also in the text block), pack_id, feature state and next_instructions.',
      'Example: start_feature({"app":"checkout","actor":"daniel","task_description":"Add CSV export","decision":{...from route_task...},"workspace":{"estimated_files":4},"external_ref":"YAL-123"})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1), actor: ActorSchema, task_description: z.string().min(1),
      decision: DecisionShape.describe('The decision object returned by route_task, possibly with framework or track overridden by the user'),
      workspace: WorkspaceShape.optional(), feature_slug: z.string().min(1).optional(), external_ref: z.string().min(1).optional(),
      trigger_ref: z.string().min(1).optional(), policy_override_reason: z.string().min(1).optional(),
    },
    outputSchema: {
      feature_id: z.string(), context_pack: z.string(), pack_id: z.string(), feature: FeatureStateShape, next_instructions: z.string(), warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'start_feature', async () => {
    const r = await startFeature(deps, {
      app: args.app, actor: args.actor, task_description: args.task_description, decision: args.decision, workspace: args.workspace ?? null,
      feature_slug: args.feature_slug ?? null, external_ref: args.external_ref ?? null, trigger_ref: args.trigger_ref ?? null, policy_override_reason: args.policy_override_reason ?? null,
    });
    return { structured: { ...r }, text: r.context_pack };
  }));
}
```

`src/mcp/tools/getContext.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getContext } from '../../services/getContext.js';
import { guarded } from '../encode.js';
import { ActorSchema, FeatureStateShape, PhaseSchema, ScopeSchema, WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerGetContext(server: McpServer, deps: McpDeps): void {
  server.registerTool('get_context', {
    title: 'Get the context pack for a feature phase',
    description: [
      'Assembles and persists a budgeted context pack for a feature: header and instructions, always-on standards, the phase template, retrieved app memory and standards, stack guide sections, stop conditions and the next gate.',
      'Use it to resume a feature in a new session, to refresh context in the current phase, or to steer retrieval with focus. Works on archived features. Each call persists a new pack.',
      'Returns context_pack (also in the text block), pack_id and feature state.',
      'Example: get_context({"feature_id":"f_01j9...","actor":"daniel","focus":"csv encoding","scope":"app"})',
    ].join(' '),
    inputSchema: {
      feature_id: z.string().min(1), actor: ActorSchema, phase: PhaseSchema.optional().describe('Defaults to the current phase'),
      focus: z.string().min(1).optional(), scope: ScopeSchema.optional(),
    },
    outputSchema: { context_pack: z.string(), pack_id: z.string(), feature: FeatureStateShape, warnings: WarningsShape },
  }, async (args) => guarded(deps.logger, 'get_context', async () => {
    const r = await getContext(deps, { feature_id: args.feature_id, actor: args.actor, phase: args.phase ?? null, focus: args.focus ?? null, scope: args.scope ?? 'app' });
    return { structured: { ...r }, text: r.context_pack };
  }));
}
```

- [ ] **Step 4: Register them**

In `src/mcp/server.ts`, change the import block and the array to:

```ts
import { registerGetContext } from './tools/getContext.js';
import { registerRouteTask } from './tools/routeTask.js';
import { registerStartFeature } from './tools/startFeature.js';
// ...
const registrars: Registrar[] = [registerRouteTask, registerStartFeature, registerGetContext];
```

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/startAndContext.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp test/contract/startAndContext.test.ts
git commit -m "feat(mcp): start_feature and get_context tools"
```

### Task 38: advance_phase, get_feature_status and list_features tools

**Files:**
- Create: `src/mcp/tools/advancePhase.ts`, `src/mcp/tools/getFeatureStatus.ts`, `src/mcp/tools/listFeatures.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/contract/lifecycle.test.ts`

- [ ] **Step 1: Write the failing contract test**

`test/contract/lifecycle.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, textOf, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };
const proposal = '## Why\nManual.\n\n## What Changes\nButton.\n';
const evidence = { tests: { command: 'npm test', passed: 1, failed: 0 }, lint: 'pass', security: { status: 'skipped', new_high: 0, skipped_reason: 'no scanner' }, files_changed: ['a.ts'] };

describe.skipIf(!url)('lifecycle tools over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('walks a feature to archived with gate failure as a normal result', async () => {
    await withClient('stdio', async (client) => {
      const start = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision, external_ref: 'YAL-9' } }));
      const fid = start.feature_id;
      const fail = await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': 'TODO' }, human_approved: true } });
      expect(fail.isError).toBeUndefined();
      const f = structuredOf<{ result: string; findings: { check: string }[]; next_instructions: string | null }>(fail);
      expect(f.result).toBe('fail');
      expect(f.findings.map((x) => x.check)).toContain('placeholder_scan');
      expect(f.next_instructions).toBeNull();
      expect(JSON.parse(textOf(fail)).result).toBe('fail');
      const pass = structuredOf<{ result: string; next_instructions: string }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': proposal }, human_approved: true } }));
      expect(pass.result).toBe('pass');
      expect(pass.next_instructions).toContain('Phase: implement (apply)');
      await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'implement', target_phase: 'verify' } });
      const v = structuredOf<{ result: string; findings: { severity: string }[] }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate', evidence } }));
      expect(v.result).toBe('pass');
      expect(v.findings).toEqual([expect.objectContaining({ severity: 'warning' })]);
      const a = structuredOf<{ feature: { status: string } }>(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' } }));
      expect(a.feature.status).toBe('archived');
      expect(errorOf(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'integrate', target_phase: 'archived' } })).code).toBe('FEATURE_ARCHIVED');
      const status = structuredOf<{ transitions: unknown[]; status: string; latest_pack_per_phase: Record<string, string> }>(await client.callTool({ name: 'get_feature_status', arguments: { feature_id: fid } }));
      expect(status.status).toBe('archived');
      expect(status.transitions).toHaveLength(5);
      expect(Object.keys(status.latest_pack_per_phase)).toEqual(['specify']);
      const list = structuredOf<{ features: { feature_id: string }[] }>(await client.callTool({ name: 'list_features', arguments: { app: 'checkout', status: ['archived'], external_ref: 'YAL-9' } }));
      expect(list.features.map((x) => x.feature_id)).toEqual([fid]);
      expect(structuredOf<{ features: unknown[] }>(await client.callTool({ name: 'list_features', arguments: { app: 'checkout' } })).features).toEqual([]);
    });
  });

  it('encodes precedence errors: STALE_STATE, PHASE_ORDER_VIOLATION with targets, VALIDATION_ERROR', async () => {
    await withClient('stdio', async (client) => {
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      expect(errorOf(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'verify', target_phase: 'integrate' } })).code).toBe('STALE_STATE');
      const order = errorOf(await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'specify', target_phase: 'verify' } }));
      expect(order).toMatchObject({ code: 'PHASE_ORDER_VIOLATION', details: { forward: ['implement'], backward: [] } });
      const bad = await client.callTool({ name: 'advance_phase', arguments: { feature_id: fid, actor: 'd', expected_phase: 'nope', target_phase: 'implement' } }).catch((e: Error) => e);
      const code = bad instanceof Error ? bad.message : errorOf(bad).code;
      expect(code).toMatch(/VALIDATION_ERROR|expected_phase|Invalid/);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/lifecycle.test.ts`
Expected: FAIL: tool `advance_phase` not found.

- [ ] **Step 3: Implement the three tools**

`src/mcp/tools/advancePhase.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { advancePhase } from '../../services/advancePhase.js';
import { guarded } from '../encode.js';
import { ActorSchema, FeatureStateShape, FindingShape, PhaseSchema, WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerAdvancePhase(server: McpServer, deps: McpDeps): void {
  server.registerTool('advance_phase', {
    title: 'Move a feature to the next or an earlier phase',
    description: [
      'Runs the deterministic gate checks declared by the pinned framework track for a forward move and records the transition, artifact hashes and artifact text; backward moves record a reason and run no checks.',
      'Use it when the current phase\'s artifacts are ready (forward) or when work must return to an earlier phase (backward). A gate failure is a normal result with result "fail" and findings, not an error.',
      'expected_phase must equal the current phase or the call fails with STALE_STATE. Evidence is required on the move out of verify. cycle_failed is accepted only on verify->implement.',
      'Returns result, findings, next_instructions (on pass) and feature state.',
      'Example: advance_phase({"feature_id":"f_01j9...","actor":"daniel","expected_phase":"specify","target_phase":"implement","artifacts":{"proposal.md":"..."},"human_approved":true})',
    ].join(' '),
    inputSchema: {
      feature_id: z.string().min(1), actor: ActorSchema, expected_phase: PhaseSchema,
      target_phase: z.string().min(1).describe('A phase name or the literal "archived"'),
      artifacts: z.record(z.string()).optional().describe('Artifact name to content; the transition declares which names it needs'),
      evidence: z.record(z.unknown()).optional().describe('Verify evidence object (spec section 10.4); required out of verify'),
      human_approved: z.boolean().optional(), cycle_failed: z.boolean().optional(), pack_id: z.string().optional(),
      reason: z.string().min(1).optional().describe('Required for backward moves'), repin: z.boolean().optional(),
    },
    outputSchema: {
      result: z.enum(['pass', 'fail']), findings: z.array(FindingShape), next_instructions: z.string().nullable(), feature: FeatureStateShape, warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'advance_phase', async () => {
    const r = await advancePhase(deps, {
      feature_id: args.feature_id, actor: args.actor, expected_phase: args.expected_phase, target_phase: args.target_phase, artifacts: args.artifacts,
      evidence: args.evidence, human_approved: args.human_approved, cycle_failed: args.cycle_failed, pack_id: args.pack_id ?? null, reason: args.reason ?? null, repin: args.repin,
    });
    const text = r.result === 'pass' && r.next_instructions ? r.next_instructions : JSON.stringify({ result: r.result, findings: r.findings, feature: r.feature, warnings: r.warnings }, null, 2);
    return { structured: { ...r }, text };
  }));
}
```

`src/mcp/tools/getFeatureStatus.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getFeatureStatus } from '../../services/featureStatus.js';
import { guarded } from '../encode.js';
import { FeatureStateShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerGetFeatureStatus(server: McpServer, deps: McpDeps): void {
  server.registerTool('get_feature_status', {
    title: 'Read a feature\'s state and history',
    description: [
      'Returns a feature\'s intent, framework and pinned version, track, current phase and alias, status, blocked reason, high_risk, failed_cycles, refs, allowed forward and backward targets, transition summaries and the latest pack id per phase.',
      'Use it to resume work, to check what the next gate expects, or to audit what happened. Read-only.',
      'Example: get_feature_status({"feature_id":"f_01j9..."})',
    ].join(' '),
    inputSchema: { feature_id: z.string().min(1) },
    outputSchema: {
      ...FeatureStateShape.shape,
      transitions: z.array(z.object({
        id: z.string(), from_phase: z.string(), to_phase: z.string(), direction: z.string(), result: z.string(), human_approved: z.boolean(),
        reason: z.string().nullable(), created_by: z.string(), created_at: z.string(), findings_count: z.number().int(),
      })),
      latest_pack_per_phase: z.record(z.string()),
    },
  }, async (args) => guarded(deps.logger, 'get_feature_status', async () => {
    const r = await getFeatureStatus(deps, args.feature_id);
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
```

`src/mcp/tools/listFeatures.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listFeaturesService } from '../../services/listFeatures.js';
import { guarded } from '../encode.js';
import type { McpDeps } from '../server.js';

export function registerListFeatures(server: McpServer, deps: McpDeps): void {
  server.registerTool('list_features', {
    title: 'List features of an app',
    description: [
      'Lists features for an app filtered by status (default active and blocked) and optionally by exact external_ref, newest first.',
      'Use it before route_task when working through a backlog, so an in-flight ticket is resumed with get_context instead of routed twice. Read-only.',
      'Returns features[] {feature_id, slug, intent, framework, track, current_phase, status, external_ref, trigger_ref, updated_at}.',
      'Example: list_features({"app":"checkout","external_ref":"YAL-123"})',
    ].join(' '),
    inputSchema: {
      app: z.string().min(1), status: z.array(z.enum(['active', 'blocked', 'archived'])).optional(), external_ref: z.string().min(1).optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    outputSchema: {
      features: z.array(z.object({
        feature_id: z.string(), slug: z.string(), intent: z.string(), framework: z.string(), track: z.string().nullable(), current_phase: z.string(),
        status: z.string(), external_ref: z.string().nullable(), trigger_ref: z.string().nullable(), updated_at: z.string(),
      })),
    },
  }, async (args) => guarded(deps.logger, 'list_features', async () => {
    const r = await listFeaturesService(deps, { app: args.app, status: args.status, external_ref: args.external_ref ?? null, limit: args.limit });
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
```

- [ ] **Step 4: Register them in src/mcp/server.ts**

```ts
const registrars: Registrar[] = [registerRouteTask, registerStartFeature, registerGetContext, registerAdvancePhase, registerGetFeatureStatus, registerListFeatures];
```

with the matching imports.

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/lifecycle.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp test/contract/lifecycle.test.ts
git commit -m "feat(mcp): advance_phase, get_feature_status and list_features tools"
```

### Task 39: search_memory and propose_memory tools

**Files:**
- Create: `src/mcp/tools/searchMemory.ts`, `src/mcp/tools/proposeMemory.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/contract/memory.test.ts`

- [ ] **Step 1: Write the failing contract test**

`test/contract/memory.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf, errorOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('memory tools over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('searches with scope and proposes memory', async () => {
    await withClient('stdio', async (client) => {
      const s = structuredOf<{ chunks: { stable_id: string; match: string }[]; degraded: boolean }>(await client.callTool({ name: 'search_memory', arguments: { query: 'failing test first', app: 'checkout', kinds: ['standard'], limit: 3 } }));
      expect(s.degraded).toBe(false);
      expect(s.chunks.map((c) => c.stable_id)).toContain('quality.tdd');
      expect(s.chunks.length).toBeLessThanOrEqual(3);
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      const p = structuredOf<{ proposal_id: string; status: string }>(await client.callTool({ name: 'propose_memory', arguments: { feature_id: fid, actor: 'd', kind: 'app_memory', memory_type: 'adr', title: 'ADR-9 Stream exports', body: 'Stream.', links: ['archive/x'] } }));
      expect(p).toEqual({ proposal_id: expect.stringMatching(/^p_/), status: 'pending' });
      expect(errorOf(await client.callTool({ name: 'propose_memory', arguments: { feature_id: fid, actor: 'd', kind: 'app_memory', title: 't', body: 'b' } })).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await client.callTool({ name: 'search_memory', arguments: { query: 'x', app: 'checkout', scope: ['nope'] } })).code).toBe('APP_NOT_FOUND');
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/memory.test.ts`
Expected: FAIL: tool not found.

- [ ] **Step 3: Implement the two tools**

`src/mcp/tools/searchMemory.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchMemory } from '../../services/searchMemory.js';
import { guarded } from '../encode.js';
import { ScopeSchema, WarningsShape } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerSearchMemory(server: McpServer, deps: McpDeps): void {
  server.registerTool('search_memory', {
    title: 'Search the knowledge base',
    description: [
      'Searches app memory, standards, stack guides and framework material by meaning and by exact identifiers (ADR-n, REQ-n, US-n, INC-n), scoped to the app by default.',
      'Use it for an explicit lookup outside the context pack, including cross-app questions with scope "company" or a list of app slugs. Read-only; degrades to exact-id matches when embeddings are unavailable.',
      'Returns chunks[] {item_id, stable_id, version, app, kind, memory_type, heading_path, text, score, match}.',
      'Example: search_memory({"query":"how do other apps handle CSV encoding","app":"checkout","scope":"company"})',
    ].join(' '),
    inputSchema: {
      query: z.string().min(1), app: z.string().min(1).describe('Referent app for scope "app"'), scope: ScopeSchema.optional(),
      kinds: z.array(z.enum(['framework_pack', 'standard', 'stack_guide', 'app_memory'])).optional(), limit: z.number().int().positive().max(50).optional(),
    },
    outputSchema: {
      chunks: z.array(z.object({
        item_id: z.string(), stable_id: z.string(), version: z.number().int(), app: z.string().nullable(), kind: z.string(), memory_type: z.string().nullable(),
        heading_path: z.string(), text: z.string(), score: z.number(), match: z.enum(['vector', 'exact_id']),
      })),
      degraded: z.boolean(), warnings: WarningsShape,
    },
  }, async (args) => guarded(deps.logger, 'search_memory', async () => {
    const r = await searchMemory(deps, { query: args.query, app: args.app, scope: args.scope, kinds: args.kinds, limit: args.limit });
    return { structured: { ...r }, text: JSON.stringify(r, null, 2) };
  }));
}
```

`src/mcp/tools/proposeMemory.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { proposeMemory } from '../../services/proposeMemory.js';
import { guarded } from '../encode.js';
import { ActorSchema } from '../schemas.js';
import type { McpDeps } from '../server.js';

export function registerProposeMemory(server: McpServer, deps: McpDeps): void {
  server.registerTool('propose_memory', {
    title: 'Propose new app memory or a standard',
    description: [
      'Records a proposal for a new ADR, decision, constraint, incident note or standard, linked to the feature that produced it, for an admin to approve with sdd-admin.',
      'Use it in the learn phase or whenever a durable decision was made. Approved proposals become retrievable items; supersedes retires the item a change replaces. Refused on archived features.',
      'Returns proposal_id and status "pending".',
      'Example: propose_memory({"feature_id":"f_01j9...","actor":"daniel","kind":"app_memory","memory_type":"adr","title":"ADR-9 CSV exports stream rather than buffer","body":"...","links":["openspec/changes/archive/2026-09-10-orders-csv-export/"]})',
    ].join(' '),
    inputSchema: {
      feature_id: z.string().min(1), actor: ActorSchema, kind: z.enum(['app_memory', 'standard']),
      memory_type: z.enum(['adr', 'decision', 'constraint', 'incident']).optional().describe('Required for app_memory'),
      title: z.string().min(1), body: z.string().min(1), stack_tags: z.array(z.string()).optional(),
      links: z.array(z.string()).optional().describe('Paths or ticket ids of archived artifacts'), supersedes: z.string().min(1).optional().describe('stable_id of an active item this one replaces'),
    },
    outputSchema: { proposal_id: z.string(), status: z.literal('pending') },
  }, async (args) => guarded(deps.logger, 'propose_memory', async () => {
    const r = await proposeMemory(deps, { ...args, memory_type: args.memory_type ?? null, supersedes: args.supersedes ?? null });
    return { structured: { ...r }, text: JSON.stringify(r) };
  }));
}
```

- [ ] **Step 4: Register them in src/mcp/server.ts**

```ts
const registrars: Registrar[] = [
  registerRouteTask, registerStartFeature, registerGetContext, registerAdvancePhase,
  registerGetFeatureStatus, registerListFeatures, registerSearchMemory, registerProposeMemory,
];
```

- [ ] **Step 5: Run all contract tests so far and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract && npm run typecheck`
Expected: PASS, including the eight-tool listing assertion from Task 36.

- [ ] **Step 6: Commit**

```bash
git add src/mcp test/contract/memory.test.ts
git commit -m "feat(mcp): search_memory and propose_memory tools"
```

### Task 40: Resources

**Files:**
- Create: `src/mcp/resources.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/contract/resources.test.ts`

**Interfaces:** five resource templates exactly as spec §7.3: `sdd://apps/{slug}`, `sdd://features/{id}`, `sdd://frameworks/{name}`, `sdd://knowledge/{stable_id}`, `sdd://knowledge/{stable_id}/v/{version}`. Each returns one `application/json` content block. Unknown ids raise an MCP error with the domain code in the message.

- [ ] **Step 1: Write the failing contract test**

`test/contract/resources.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

function json(r: { contents: { text?: string }[] }): Record<string, unknown> { return JSON.parse(r.contents[0]!.text!); }

describe.skipIf(!url)('resources over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('lists templates and reads each resource', async () => {
    await withClient('stdio', async (client) => {
      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(['sdd://apps/{slug}', 'sdd://features/{id}', 'sdd://frameworks/{name}', 'sdd://knowledge/{stable_id}', 'sdd://knowledge/{stable_id}/v/{version}']);
      const app = json(await client.readResource({ uri: 'sdd://apps/checkout' }));
      expect(app).toMatchObject({ slug: 'checkout', policy_version: null });
      expect((app.always_on as { stable_id: string }[]).map((i) => i.stable_id)).toEqual(['mini-company.constitution']);
      const fw = json(await client.readResource({ uri: 'sdd://frameworks/mini' }));
      expect(fw).toMatchObject({ name: 'mini', pack_version: '1.0.0' });
      expect(Object.keys(fw.tracks as object)).toEqual(['default']);
      const k = json(await client.readResource({ uri: 'sdd://knowledge/mini.template.proposal' }));
      expect(k).toMatchObject({ stable_id: 'mini.template.proposal', version: 1 });
      const kv = json(await client.readResource({ uri: 'sdd://knowledge/mini.template.proposal/v/1' }));
      expect(kv).toMatchObject({ version: 1 });
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      const f = json(await client.readResource({ uri: `sdd://features/${fid}` }));
      expect(f).toMatchObject({ feature_id: fid, current_phase: 'specify' });
      await expect(client.readResource({ uri: 'sdd://apps/nope' })).rejects.toThrow(/APP_NOT_FOUND/);
      await expect(client.readResource({ uri: 'sdd://knowledge/nope/v/3' })).rejects.toThrow(/not found/i);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/resources.test.ts`
Expected: FAIL (no templates).

- [ ] **Step 3: Implement src/mcp/resources.ts**

```ts
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isDomainError } from '../errors.js';
import { getFeatureStatus } from '../services/featureStatus.js';
import { requireApp } from '../store/apps.js';
import { currentFramework } from '../store/frameworks.js';
import { currentItem, itemVersion, listAlwaysOn } from '../store/knowledge.js';
import { currentPolicy } from '../store/policies.js';
import type { McpDeps } from './server.js';

function jsonContent(uri: URL, value: unknown) {
  return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] };
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (isDomainError(e)) throw new Error(`${e.code}: ${e.message}`);
    throw e;
  }
}

const one = (v: string | string[]): string => (Array.isArray(v) ? v[0]! : v);

export function registerResources(server: McpServer, deps: McpDeps): void {
  const q = deps.pool;

  server.registerResource('app', new ResourceTemplate('sdd://apps/{slug}', { list: undefined }),
    { title: 'App profile', description: 'App profile, current policy version and always-on standards', mimeType: 'application/json' },
    async (uri, { slug }) => wrap(async () => {
      const app = await requireApp(q, one(slug));
      const policy = await currentPolicy(q, app.id);
      const alwaysOn = (await listAlwaysOn(q, app.id)).map((i) => ({ stable_id: i.stable_id, version: i.version, title: i.title, app_scoped: i.app_id !== null }));
      return jsonContent(uri, { slug: app.slug, name: app.name, default_stack: app.default_stack, compliance: app.compliance, token_budget: app.token_budget, min_similarity: app.min_similarity, stop_conditions: app.stop_conditions, policy_version: policy?.version ?? null, policy: policy?.policy ?? null, always_on: alwaysOn });
    }));

  server.registerResource('feature', new ResourceTemplate('sdd://features/{id}', { list: undefined }),
    { title: 'Feature state', description: 'Feature state and transition summaries', mimeType: 'application/json' },
    async (uri, { id }) => wrap(async () => jsonContent(uri, await getFeatureStatus(deps, one(id)))));

  server.registerResource('framework', new ResourceTemplate('sdd://frameworks/{name}', { list: undefined }),
    { title: 'Framework', description: 'Current framework version: tracks, phases, artifacts and gates', mimeType: 'application/json' },
    async (uri, { name }) => wrap(async () => {
      const fw = await currentFramework(q, one(name));
      if (!fw) throw new Error(`UNKNOWN_FRAMEWORK: framework "${one(name)}" has no current version`);
      return jsonContent(uri, { name: fw.name, pack_version: fw.pack_version, gate_library_version: fw.gate_library_version, status: fw.status, tracks: fw.tracks });
    }));

  server.registerResource('knowledge-current', new ResourceTemplate('sdd://knowledge/{stable_id}', { list: undefined }),
    { title: 'Knowledge item', description: 'Current version of one knowledge item', mimeType: 'application/json' },
    async (uri, { stable_id }) => wrap(async () => {
      const item = await currentItem(q, one(stable_id));
      if (!item) throw new Error(`knowledge item "${one(stable_id)}" not found or not current`);
      return jsonContent(uri, item);
    }));

  server.registerResource('knowledge-version', new ResourceTemplate('sdd://knowledge/{stable_id}/v/{version}', { list: undefined }),
    { title: 'Knowledge item version', description: 'A specific version of one knowledge item', mimeType: 'application/json' },
    async (uri, { stable_id, version }) => wrap(async () => {
      const item = await itemVersion(q, one(stable_id), Number(one(version)));
      if (!item) throw new Error(`knowledge item "${one(stable_id)}" version ${one(version)} not found`);
      return jsonContent(uri, item);
    }));
}
```

- [ ] **Step 4: Register in src/mcp/server.ts**

Append `registerResources` to the `registrars` array with its import.

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/resources.test.ts && npm run typecheck`
Expected: PASS. If the SDK registers `sdd://knowledge/{stable_id}` so that it also matches `.../v/1`, register the versioned template before the current one; the SDK matches templates in registration order.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/resources.ts src/mcp/server.ts test/contract/resources.test.ts
git commit -m "feat(mcp): read-only resources for apps, features, frameworks and knowledge"
```

### Task 41: Prompts

**Files:**
- Create: `src/mcp/prompts.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/contract/prompts.test.ts`

**Interfaces:** seven prompts `sdd.specify`, `sdd.plan`, `sdd.tasks`, `sdd.implement`, `sdd.verify`, `sdd.integrate`, `sdd.learn`; argument `feature_id`; each returns one user message whose text is exactly the `get_context` pack for that phase, persisted with `created_by = 'prompt'`.

- [ ] **Step 1: Write the failing contract test**

`test/contract/prompts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('prompts over stdio', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('exposes one prompt per phase returning the pack persisted as prompt', async () => {
    await withClient('stdio', async (client) => {
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual(['sdd.implement', 'sdd.integrate', 'sdd.learn', 'sdd.plan', 'sdd.specify', 'sdd.tasks', 'sdd.verify']);
      const fid = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'x', decision } })).feature_id;
      const p = await client.getPrompt({ name: 'sdd.specify', arguments: { feature_id: fid } });
      const text = (p.messages[0]!.content as { text: string }).text;
      expect(text).toContain('# Context pack');
      expect(text).toContain('Phase: specify (proposal)');
      const pool = await getTestPool();
      const rows = (await pool.query(`SELECT created_by FROM context_packs WHERE feature_id = $1 ORDER BY created_at`, [fid])).rows;
      expect(rows.map((r) => r.created_by)).toEqual(['d', 'prompt']);
      await expect(client.getPrompt({ name: 'sdd.plan', arguments: { feature_id: fid } })).rejects.toThrow(/VALIDATION_ERROR/);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/prompts.test.ts`
Expected: FAIL (no prompts).

- [ ] **Step 3: Implement src/mcp/prompts.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PHASES } from '../domain/types.js';
import { isDomainError } from '../errors.js';
import { getContext } from '../services/getContext.js';
import type { McpDeps } from './server.js';

export function registerPrompts(server: McpServer, deps: McpDeps): void {
  for (const phase of PHASES) {
    server.registerPrompt(`sdd.${phase}`, {
      title: `SDD ${phase} phase`,
      description: `Returns the context pack for the ${phase} phase of a feature, exactly as get_context would, persisted with created_by "prompt".`,
      argsSchema: { feature_id: z.string().min(1).describe('Feature id returned by start_feature') },
    }, async ({ feature_id }) => {
      try {
        const r = await getContext(deps, { feature_id, actor: 'prompt', phase, scope: 'app' });
        return { messages: [{ role: 'user', content: { type: 'text', text: r.context_pack } }] };
      } catch (e) {
        if (isDomainError(e)) throw new Error(`${e.code}: ${e.message}`);
        throw e;
      }
    });
  }
}
```

- [ ] **Step 4: Register in src/mcp/server.ts**

Append `registerPrompts` to the `registrars` array with its import.

- [ ] **Step 5: Run the test and typecheck**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract/prompts.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/prompts.ts src/mcp/server.ts test/contract/prompts.test.ts
git commit -m "feat(mcp): one prompt per abstract phase"
```

### Task 42: Streamable HTTP transport, healthz, metrics, Docker, and the cross-transport contract run

**Files:**
- Create: `src/metrics.ts`, `src/mcp/http.ts` (replace the stub), `Dockerfile`, `docker-compose.yml`
- Modify: `src/index.ts` (wire metrics into deps)
- Test: `test/unit/metrics.test.ts`, `test/contract/http.test.ts`

**Interfaces:**
- `src/metrics.ts`: `createMetrics(): { registry: Registry; hooks: MetricsHooks }` with counters `sdd_routing_decisions_total{rule}`, `sdd_gate_results_total{check,result}`, `sdd_degraded_packs_total`, `sdd_over_budget_packs_total`, `sdd_failed_cycles_total`.
- `src/mcp/http.ts`: `createHttpApp(deps: McpDeps, config: Config): express.Express` with `POST|GET|DELETE /mcp` (stateless: a new server and transport per request, `sessionIdGenerator: undefined`, `enableDnsRebindingProtection: true`, `allowedHosts: config.allowedHosts`), `GET /healthz` (`{status, database, embedding}`; 503 when the database is unreachable), `GET /metrics` (Prometheus text). `runHttp(deps, config)` listens on `config.listen`.

- [ ] **Step 1: Write the failing tests**

`test/unit/metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMetrics } from '../../src/metrics.js';

describe('metrics', () => {
  it('exposes the five counters in prometheus format', async () => {
    const { registry, hooks } = createMetrics();
    hooks.routed('10-brownfield-small-medium');
    hooks.gate('placeholder_scan', 'fail');
    hooks.degradedPack(); hooks.overBudgetPack(); hooks.failedCycle();
    const text = await registry.metrics();
    expect(text).toContain('sdd_routing_decisions_total{rule="10-brownfield-small-medium"} 1');
    expect(text).toContain('sdd_gate_results_total{check="placeholder_scan",result="fail"} 1');
    expect(text).toContain('sdd_degraded_packs_total 1');
    expect(text).toContain('sdd_over_budget_packs_total 1');
    expect(text).toContain('sdd_failed_cycles_total 1');
  });
});
```

`test/contract/http.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../helpers/db.js';
import { seedAll } from '../helpers/seed.js';
import { withClient, structuredOf, errorOf, textOf } from '../helpers/mcp.js';

const url = process.env.SDD_TEST_DATABASE_URL;
const decision = { intent: 'feature', framework: 'mini', track: 'default', confidence: 'high', rule: 'r', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' };

describe.skipIf(!url)('Streamable HTTP transport', () => {
  beforeEach(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedAll(pool); });
  afterAll(closeTestPool);

  it('serves the same tools, resources and prompts as stdio, statelessly', async () => {
    await withClient('http', async (client) => {
      expect((await client.listTools()).tools).toHaveLength(8);
      expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(5);
      expect((await client.listPrompts()).prompts).toHaveLength(7);
      const s = structuredOf<{ feature_id: string }>(await client.callTool({ name: 'start_feature', arguments: { app: 'checkout', actor: 'd', task_description: 'Add CSV export', decision } }));
      const st = structuredOf<{ current_phase: string }>(await client.callTool({ name: 'get_feature_status', arguments: { feature_id: s.feature_id } }));
      expect(st.current_phase).toBe('specify');
      expect(errorOf(await client.callTool({ name: 'get_context', arguments: { feature_id: 'f_nope', actor: 'd' } })).code).toBe('FEATURE_NOT_FOUND');
      expect(textOf(await client.callTool({ name: 'route_task', arguments: { task_description: 'Can we cache?', app: 'checkout', workspace: {} } }))).toMatch(/Prototype first/);
    });
  });

  it('exposes healthz and metrics', async () => {
    await withClient('http', async (client, info) => {
      const origin = info.baseUrl!;
      const h = await fetch(`${origin}/healthz`);
      expect(h.status).toBe(200);
      expect(await h.json()).toMatchObject({ status: 'ok', database: 'ok', embedding: 'ok' });
      await client.callTool({ name: 'route_task', arguments: { task_description: 'x', app: 'checkout', workspace: { estimated_files: 2, is_greenfield: false }, framework_preference: 'mini' } });
      const m = await (await fetch(`${origin}/metrics`)).text();
      expect(m).toContain('sdd_routing_decisions_total{rule="2-preference"}');
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/metrics.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement src/metrics.ts**

```ts
import { Counter, Registry } from 'prom-client';
import type { MetricsHooks } from './services/deps.js';

export function createMetrics(): { registry: Registry; hooks: MetricsHooks } {
  const registry = new Registry();
  const routing = new Counter({ name: 'sdd_routing_decisions_total', help: 'Routing decisions by rule', labelNames: ['rule'], registers: [registry] });
  const gates = new Counter({ name: 'sdd_gate_results_total', help: 'Gate findings by check and result', labelNames: ['check', 'result'], registers: [registry] });
  const degraded = new Counter({ name: 'sdd_degraded_packs_total', help: 'Context packs built in degraded mode', registers: [registry] });
  const overBudget = new Counter({ name: 'sdd_over_budget_packs_total', help: 'Context packs whose fixed positions exceeded the budget', registers: [registry] });
  const failedCycles = new Counter({ name: 'sdd_failed_cycles_total', help: 'verify->implement moves flagged cycle_failed', registers: [registry] });
  return {
    registry,
    hooks: {
      routed: (rule) => routing.inc({ rule }),
      gate: (check, result) => gates.inc({ check, result }),
      degradedPack: () => degraded.inc(),
      overBudgetPack: () => overBudget.inc(),
      failedCycle: () => failedCycles.inc(),
    },
  };
}
```

- [ ] **Step 4: Implement src/mcp/http.ts (replacing the stub)**

```ts
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Registry } from 'prom-client';
import { createMcpServer, type McpDeps } from './server.js';

export interface HttpDeps extends McpDeps { registry: Registry }

export function createHttpApp(deps: HttpDeps, config: Config): Express {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const handle = async (req: Request, res: Response) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts: config.allowedHosts,
    });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      deps.logger.error({ err: e }, 'mcp request failed');
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
    }
  };
  app.post('/mcp', handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);

  app.get('/healthz', async (_req, res) => {
    let database = 'ok';
    try { await deps.pool.query('SELECT 1'); } catch { database = 'unreachable'; }
    const embedding = deps.embedder ? ((await deps.embedder.healthy()) ? 'ok' : 'unreachable') : 'disabled';
    const status = database === 'ok' ? 'ok' : 'degraded';
    res.status(database === 'ok' ? 200 : 503).json({ status, database, embedding });
  });

  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', deps.registry.contentType);
    res.send(await deps.registry.metrics());
  });

  return app;
}

export async function runHttp(deps: HttpDeps, config: Config): Promise<void> {
  const app = createHttpApp(deps, config);
  await new Promise<void>((resolve) => {
    app.listen(config.listen.port, config.listen.host, () => {
      deps.logger.info({ host: config.listen.host, port: config.listen.port }, 'streamable http listening');
      resolve();
    });
  });
}
```

Update `src/index.ts` so `buildDeps` creates metrics and returns `HttpDeps`:

```ts
import { createMetrics } from './metrics.js';
import type { HttpDeps } from './mcp/http.js';

export async function buildDeps(): Promise<HttpDeps> {
  const config = loadConfig(process.env);
  const logger = createLogger();
  await runMigrations(config.databaseUrl, (m) => logger.debug(m));
  const pool = createPool(config.databaseUrl);
  const embedder = createEmbeddingProvider(config.embedding);
  const { registry, hooks } = createMetrics();
  return { pool, embedder, tokenBudget: config.tokenBudget, logger, metrics: hooks, registry };
}
```

and keep `main` as written in Task 36 (the `runHttp` import now resolves to the real implementation).

- [ ] **Step 5: Create Dockerfile and docker-compose.yml**

`Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json
COPY packs ./packs
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: sdd
      POSTGRES_PASSWORD: sdd
      POSTGRES_DB: sdd
    volumes:
      - sdd-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sdd -d sdd"]
      interval: 5s
      timeout: 5s
      retries: 20

  sdd-orchestrator:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SDD_DATABASE_URL: postgres://sdd:sdd@postgres:5432/sdd
      SDD_EMBEDDING_PROVIDER: ${SDD_EMBEDDING_PROVIDER:-voyage}
      SDD_EMBEDDING_MODEL: ${SDD_EMBEDDING_MODEL:-voyage-3.5}
      VOYAGE_API_KEY: ${VOYAGE_API_KEY:-}
      OLLAMA_URL: ${OLLAMA_URL:-http://host.docker.internal:11434}
      SDD_LISTEN: 0.0.0.0:8080
      SDD_ALLOWED_HOSTS: ${SDD_ALLOWED_HOSTS:-localhost:8080,127.0.0.1:8080,sdd.internal:8080}
      SDD_TOKEN_BUDGET: ${SDD_TOKEN_BUDGET:-6000}
    ports:
      - "8080:8080"

volumes:
  sdd-pgdata: {}
```

- [ ] **Step 6: Run the unit test, the HTTP contract test, the whole suite, and build the image**

Run:

```bash
npx vitest run test/unit/metrics.test.ts
SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/contract
SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npm test
npm run typecheck && npm run build
docker compose build
```

Expected: all PASS, build clean, image builds. The HTTP contract test binds to `127.0.0.1` with the port in `SDD_ALLOWED_HOSTS`; if the SDK rejects the Host header, check that the allowlist entries include the port exactly as the client sends it.

- [ ] **Step 7: Commit**

```bash
git add src/metrics.ts src/mcp/http.ts src/index.ts Dockerfile docker-compose.yml test/unit/metrics.test.ts test/contract/http.test.ts
git commit -m "feat(mcp): stateless streamable HTTP transport, healthz, prometheus metrics and docker packaging"
```

---

## Part K: Seed packs

Every pack lives under `packs/<name>/` with a `pack.yaml` and Markdown items. `README.md` files are not ingested (Task 28) and hold attribution and licence notes. Templates carry only the headings the declared gates require plus one line of guidance per heading, so a host that fills them in passes the gate. Task 43 adds a test that loads and validates every directory under `packs/`, so each later pack task is verified by re-running that test plus a per-pack assertion.

### Task 43: company, quality-layer and stack-guides packs, and the all-packs validation test

**Files:**
- Create: `packs/company/pack.yaml`, `packs/company/constitution.md`, `packs/company/engineering-defaults.md`
- Create: `packs/quality-layer/pack.yaml`, `packs/quality-layer/README.md`, `packs/quality-layer/test-driven-development.md`, `packs/quality-layer/code-review.md`, `packs/quality-layer/security-hardening.md`, `packs/quality-layer/systematic-debugging.md`
- Create: `packs/stack-guides/README.md`, and for each of `react`, `node`, `go`, `frontend-design`, `web-design-audit`: `packs/stack-guides/<stack>/pack.yaml` and one guide file
- Test: `test/unit/packs/allPacks.test.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/packs/allPacks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { validatePack } from '../../../src/ingest/validate.js';

const root = fileURLToPath(new URL('../../../packs/', import.meta.url));

async function packDirs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if (!(await stat(full)).isDirectory()) continue;
    try { await stat(join(full, 'pack.yaml')); out.push(full); } catch { out.push(...(await packDirs(full))); }
  }
  return out.sort();
}

describe('seed packs', () => {
  it('every pack under packs/ loads and validates with no errors', async () => {
    const dirs = await packDirs(root);
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    for (const dir of dirs) {
      const pack = await loadPack(dir);
      const { errors, warnings } = validatePack(pack, { knownAppSlugs: new Set() });
      expect(errors, `${dir} errors`).toEqual([]);
      expect(warnings, `${dir} warnings`).toEqual([]);
      expect(pack.manifest.license, `${dir} license`).not.toBeNull();
    }
  });

  it('company ships one always-on constitution; quality layer and stack guides are retrieved and framework-null', async () => {
    const company = await loadPack(join(root, 'company'));
    expect(company.items.filter((i) => i.frontMatter.tier === 'always_on').map((i) => i.frontMatter.id)).toEqual(['company.constitution']);
    const quality = await loadPack(join(root, 'quality-layer'));
    expect(quality.manifest).toMatchObject({ kind: 'standard', framework: null });
    expect(quality.items.map((i) => i.frontMatter.id).sort()).toEqual(['quality.code-review', 'quality.security-hardening', 'quality.systematic-debugging', 'quality.tdd']);
    const react = await loadPack(join(root, 'stack-guides', 'react'));
    expect(react.manifest).toMatchObject({ name: 'stack-guides/react', kind: 'stack_guide' });
    expect(react.items.every((i) => i.frontMatter.stack_tags.includes('react'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/packs`
Expected: FAIL (fewer than 3 packs, or directory missing).

- [ ] **Step 3: Create the company pack**

`packs/company/pack.yaml`:

```yaml
name: company
kind: standard
version: 1.0.0
license: MIT
```

`packs/company/constitution.md` (one constraint per line with its reason, spec §9.1):

```markdown
---
id: company.constitution
tier: always_on
title: Company constitution
---
- No personal data in logs or error messages (GDPR fines are assessed per incident, and logs are retained for 90 days)
- Every outbound HTTP call has an explicit timeout and a retry budget (an unbounded upstream call took checkout down in INC-12)
- Database schema changes ship as reversible migrations with a tested down path (a one-way migration blocked a rollback during INC-31)
- Public API changes are additive within a major version; removals need a deprecation notice one release earlier (partners integrate against versioned contracts)
- Secrets come from the environment or the secret manager, never from source (a leaked key in a public repo cost a weekend rotation)
- Tests run in CI before merge and a red build blocks the merge (unreviewed hotfixes caused two regressions in 2025)
- Accessibility: interactive elements are keyboard reachable and labelled (procurement requires WCAG 2.1 AA)
```

`packs/company/engineering-defaults.md`:

```markdown
---
id: company.engineering-defaults
tier: retrieved
title: Engineering defaults
---
## Observability

Every service emits structured JSON logs with a request id and exposes `/healthz` and `/metrics`. Alerts page on symptoms (error rate, latency), not on causes.

## Dependencies

Prefer the standard library and existing dependencies. A new dependency needs a one-line reason in the pull request and a licence compatible with MIT or Apache-2.0.

## Feature flags

Behaviour changes that affect users ship behind a flag when they cannot be rolled back with a deploy. Flags are removed within two releases of full rollout.

## Data handling

Exports and reports stream rather than buffer when the result can exceed 10 MB. Personal data fields are listed in the app's data dictionary before they are stored.
```

- [ ] **Step 4: Create the quality layer pack**

`packs/quality-layer/pack.yaml`:

```yaml
name: quality-layer
kind: standard
framework: null
version: 1.0.0
source_url: https://github.com/addyosmani/agent-skills
license: MIT
```

`packs/quality-layer/README.md`:

```markdown
# Quality layer

Process skills attached to every routing decision (spec section 4.1). The
items summarise practices from Addy Osmani's `agent-skills` (MIT). Bodies are
written for this project; when vendoring upstream SKILL.md text, keep this
attribution and record the upstream commit in `source_url`.
```

`packs/quality-layer/test-driven-development.md`:

```markdown
---
id: quality.tdd
title: Test-driven development
---
## The cycle

Write one failing test that names the behaviour, run it and read the failure, write the smallest change that makes it pass, run the suite, then refactor with the suite green. Commit after each green step.

## What to test

Test behaviour at the boundary the caller sees: inputs to outputs, errors to error codes. Do not assert on private state or on the order of internal calls.

## When the test will not fail

If a new test passes before the implementation exists, the test is wrong or the behaviour already exists. Fix the test before writing code.

## Legacy code

Before changing code without tests, write characterization tests that pin the current behaviour, including behaviour that looks wrong. Change behaviour only after the pins are green.
```

`packs/quality-layer/code-review.md`:

```markdown
---
id: quality.code-review
title: Code review
---
## Read the spec first

A review checks the change against the accepted spec and plan. Scope that is not in the plan is a finding, even when the code is good.

## Order of concerns

Correctness, then security, then data integrity, then operability (logs, metrics, timeouts), then readability. Style comes last and is usually automated.

## Evidence over assertion

Ask for the test that proves the fix. A description of manual testing is not evidence; a test command and its output are.

## Findings

Each finding names the file and line, states what is wrong, and says whether it blocks the merge. Suggestions that do not block are marked as such.
```

`packs/quality-layer/security-hardening.md`:

```markdown
---
id: quality.security-hardening
title: Security hardening
---
## Input at the boundary

Validate every input at the boundary with a schema, reject what does not match, and never build queries, shell commands or file paths from unvalidated strings.

## Secrets and tokens

Read secrets from the environment or the secret manager. Never log them, never return them in tool results, and rotate any secret that appears in a diff.

## Dependencies

Run the dependency scanner in CI. A new high severity finding blocks the merge unless the scan is explicitly skipped with a written reason.

## Least privilege

Service accounts get the minimum role for the task. Network services bind to a private interface unless they are meant to be public.
```

`packs/quality-layer/systematic-debugging.md`:

```markdown
---
id: quality.systematic-debugging
title: Systematic debugging
---
## Reproduce first

Turn the report into a failing test or a deterministic script before changing code. If it cannot be reproduced, gather logs and metrics until it can.

## One hypothesis at a time

State what you think is wrong, make the smallest change that would confirm or refute it, and record the result. Do not stack speculative fixes.

## Three failed attempts

After three fix attempts that did not resolve the failure, stop and hand the problem to a human with the reproduction, the hypotheses tried and their results.

## Regression test

Every fix ships with the test that would have caught it.
```

- [ ] **Step 5: Create the stack guide packs**

`packs/stack-guides/README.md`:

```markdown
# Stack guides

One pack per stack, tagged by `stack_tags`, attached to a routing decision when
the tags intersect the workspace stack (spec section 7.1, `attached_layers`).
The guides here are written for this project. The `sdlc` plugin's domain
skills derive from `antigravity-awesome-skills`; do not copy them into these
packs until their licence is confirmed (spec section 12.3).
```

`packs/stack-guides/react/pack.yaml`:

```yaml
name: stack-guides/react
kind: stack_guide
version: 1.0.0
license: MIT
```

`packs/stack-guides/react/react.md`:

```markdown
---
id: stack.react.guide
title: React engineering guide
stack_tags: [react, typescript]
---
## Components

Function components only. One component per file, named export matching the file name. Props are typed with an interface; avoid `any` and avoid spreading unknown props onto DOM elements.

## State and effects

Keep state as close to where it is used as possible. Derive values instead of storing them. Effects synchronise with external systems only; data fetching goes through a query library with caching and cancellation, not raw effects.

## Data loading and errors

Every async view has loading, empty and error states. Errors surface to an error boundary with a retry action; they are never swallowed.

## Testing

Test with React Testing Library through the DOM the user sees: roles, labels and text. Do not test implementation details such as hook call order.

## Performance

Measure before memoising. Split bundles at route boundaries. Large lists virtualise above 200 rows.
```

`packs/stack-guides/node/pack.yaml`:

```yaml
name: stack-guides/node
kind: stack_guide
version: 1.0.0
license: MIT
```

`packs/stack-guides/node/node.md`:

```markdown
---
id: stack.node.guide
title: Node.js engineering guide
stack_tags: [node, typescript, javascript]
---
## Runtime and modules

Target the active LTS. ESM only, with explicit `.js` extensions in relative imports. Strict TypeScript with `noUncheckedIndexedAccess`.

## Async and errors

Every promise is awaited or explicitly handled. Errors are typed objects with a stable code, not strings. Unhandled rejections crash the process so the supervisor restarts it.

## I/O and streams

Stream anything that can exceed 10 MB. Set timeouts on every outbound request and every database query. Close pools and servers on SIGTERM.

## Configuration

Read configuration from the environment once at startup, validate it with a schema, and fail fast with a message naming the variable.

## Testing

Unit tests need no network or database. Integration tests run against a real database in Docker and truncate between tests.
```

`packs/stack-guides/go/pack.yaml`:

```yaml
name: stack-guides/go
kind: stack_guide
version: 1.0.0
license: MIT
```

`packs/stack-guides/go/go.md`:

```markdown
---
id: stack.go.guide
title: Go engineering guide
stack_tags: [go, golang]
---
## Errors

Return errors, do not panic. Wrap with `%w` and context about what was attempted. Check errors at every call site; never discard with `_` outside tests.

## Concurrency

Every goroutine has an owner that knows when it ends. Pass `context.Context` as the first argument and honour cancellation. Protect shared state with a mutex or a channel, never both.

## Packages

Small packages with one responsibility. No `util` packages. Exported identifiers have doc comments starting with the identifier name.

## Testing

Table-driven tests with `t.Run` sub-tests. Use `testing.TB` helpers for setup. Race detector runs in CI.

## Tooling

`gofmt`, `go vet` and `staticcheck` are clean before review. Dependencies are pinned in `go.mod` and tidied.
```

`packs/stack-guides/frontend-design/pack.yaml`:

```yaml
name: stack-guides/frontend-design
kind: stack_guide
version: 1.0.0
license: MIT
```

`packs/stack-guides/frontend-design/frontend-design.md`:

```markdown
---
id: stack.frontend-design.guide
title: Frontend design guide
stack_tags: [react, vue, svelte, frontend, css]
---
## Hierarchy

One primary action per screen. Headline, supporting text and controls follow a consistent scale; spacing comes from a fixed scale (4, 8, 16, 24, 32).

## Colour and contrast

Text contrast meets WCAG AA (4.5:1 body, 3:1 large text). Colour never carries meaning alone; pair it with an icon or label.

## Motion

Motion communicates state change and lasts under 200 ms for feedback, under 400 ms for transitions. Respect `prefers-reduced-motion`.

## Forms

Labels are visible, errors appear next to the field with a fix, and the submit button states what happens. Never clear a form on error.

## Responsiveness

Layouts are fluid between breakpoints. Wide content scrolls inside its container; the page never scrolls horizontally.
```

`packs/stack-guides/web-design-audit/pack.yaml`:

```yaml
name: stack-guides/web-design-audit
kind: stack_guide
version: 1.0.0
license: MIT
```

`packs/stack-guides/web-design-audit/web-design-audit.md`:

```markdown
---
id: stack.web-design-audit.guide
title: Web design audit checklist
stack_tags: [frontend, react, vue, svelte, css]
---
## Accessibility

Every interactive element is reachable by keyboard in a sensible order, has a visible focus state and an accessible name. Images carry alt text or are marked decorative.

## Performance

Largest Contentful Paint under 2.5 s on a mid-range phone over 4G. Images are sized and lazy-loaded below the fold. No layout shift after first paint.

## Content

Headings form an outline. Link text says where it goes. Error and empty states say what to do next.

## Consistency

Components come from the design system. One-off styles are a finding unless justified in the pull request.

## Verification

Run the automated accessibility scan and the Lighthouse audit; attach both reports to the pull request.
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/unit/packs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packs/company packs/quality-layer packs/stack-guides test/unit/packs
git commit -m "feat(packs): company constitution, quality layer and stack guide seed packs"
```

### Task 44: OpenSpec pack (tracks default, hotfix, refactor)

**Files:**
- Create: `packs/openspec/pack.yaml`, `packs/openspec/README.md`, `packs/openspec/templates/proposal.md`, `packs/openspec/templates/spec.md`, `packs/openspec/templates/tasks.md`, `packs/openspec/templates/apply.md`, `packs/openspec/templates/verify.md`, `packs/openspec/templates/archive.md`, `packs/openspec/templates/hotfix-proposal.md`, `packs/openspec/templates/hotfix-learn.md`, `packs/openspec/templates/refactor-proposal.md`, `packs/openspec/guides/workflow.md`
- Test: `test/unit/packs/openspec.test.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/packs/openspec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/openspec', import.meta.url));

describe('openspec pack', () => {
  it('declares the three tracks with the spec mappings', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks).sort()).toEqual(['default', 'hotfix', 'refactor']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'implement', 'verify', 'integrate']);
    expect(phaseOrder(tracks.hotfix!)).toEqual(['specify', 'implement', 'verify', 'integrate', 'learn']);
    expect(phaseOrder(tracks.refactor!)).toEqual(['specify', 'implement', 'verify', 'integrate']);
    expect(tracks.hotfix!.spec_review).toBe('deferred');
    expect(tracks.default!.phases.specify).toMatchObject({ alias: 'proposal' });
    expect(tracks.default!.gates.map((g) => g.transition)).toEqual(['specify->implement', 'verify->integrate']);
    const refactorVerify = tracks.refactor!.gates.find((g) => g.transition === 'verify->integrate')!;
    expect(refactorVerify.checks).toEqual([{ name: 'verify_evidence', params: { max_existing_tests_modified: 0 } }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/packs/openspec.test.ts`
Expected: FAIL, no pack.yaml.

- [ ] **Step 3: Create pack.yaml and README**

`packs/openspec/pack.yaml`:

```yaml
name: openspec
kind: framework_pack
framework: openspec
version: 1.0.0
source_url: https://github.com/Fission-AI/OpenSpec
license: MIT
tracks:
  default:
    spec_review: required
    phases:
      specify:   { alias: proposal, command: "/openspec:proposal", template: openspec.template.proposal }
      plan:      skipped
      tasks:     skipped
      implement: { alias: apply, command: "/openspec:apply", template: openspec.template.apply }
      verify:    { alias: verify, command: "/openspec:verify", template: openspec.template.verify }
      integrate: { alias: archive, command: "/openspec:archive", template: openspec.template.archive }
      learn:     skipped
    gates:
      - transition: specify->implement
        artifacts: [proposal.md, spec.md, tasks.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: proposal.md, sections: [Why, What Changes, Impact] } }
          - { name: delta_markers, params: { artifact: spec.md } }
          - { name: measurable_criteria, params: { artifact: spec.md, section: ADDED Requirements } }
          - { name: required_sections, params: { artifact: tasks.md, sections: [Tasks] } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence }
  hotfix:
    spec_review: deferred
    phases:
      specify:   { alias: proposal, command: "/openspec:proposal", template: openspec.template.hotfix-proposal }
      plan:      skipped
      tasks:     skipped
      implement: { alias: apply, command: "/openspec:apply", template: openspec.template.apply }
      verify:    { alias: verify, command: "/openspec:verify", template: openspec.template.verify }
      integrate: { alias: archive, command: "/openspec:archive", template: openspec.template.archive }
      learn:     { alias: learn, template: openspec.template.hotfix-learn }
    gates:
      - transition: specify->implement
        artifacts: [proposal.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: proposal.md, sections: [Reproduction, Expected Behaviour, Regression Test] } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence }
      - transition: learn->archived
        artifacts: [learn.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: learn.md, sections: [Incident Memory Proposal] } }
  refactor:
    spec_review: required
    phases:
      specify:   { alias: proposal, command: "/openspec:proposal", template: openspec.template.refactor-proposal }
      plan:      skipped
      tasks:     skipped
      implement: { alias: apply, command: "/openspec:apply", template: openspec.template.apply }
      verify:    { alias: verify, command: "/openspec:verify", template: openspec.template.verify }
      integrate: { alias: archive, command: "/openspec:archive", template: openspec.template.archive }
      learn:     skipped
    gates:
      - transition: specify->implement
        artifacts: [proposal.md, spec.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: proposal.md, sections: [Observed Behaviors, Assumed Contracts, Characterization Tests] } }
          - { name: delta_markers, params: { artifact: spec.md } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence, params: { max_existing_tests_modified: 0 } }
```

`packs/openspec/README.md`:

```markdown
# OpenSpec pack

Templates and phase mapping adapted from OpenSpec (Fission-AI, MIT). The
`hotfix` and `refactor` tracks and their templates are written for this
project following Graziano's brownfield guidance (spec section 12.3).
```

- [ ] **Step 4: Create the templates and guide**

`packs/openspec/templates/proposal.md`:

```markdown
---
id: openspec.template.proposal
phases: [specify]
title: OpenSpec proposal template
---
## Why

Two or three sentences on the problem and why now. Link the ticket.

## What Changes

One bullet per behaviour change, each starting with a verb. Mark breaking changes with **BREAKING**.

## Impact

Affected code paths, data, APIs and users. Name the specs this change touches.
```

`packs/openspec/templates/spec.md`:

```markdown
---
id: openspec.template.spec
phases: [specify]
title: OpenSpec delta spec template
---
## ADDED Requirements

### Requirement: <name>

The system SHALL <behaviour>. Every measurable statement carries a number and a unit, for example "within 800 ms for 10,000 rows".

#### Scenario: <name>

- **WHEN** <trigger>
- **THEN** <observable result>

## MODIFIED Requirements

### Requirement: <name>

Restate the full requirement as it reads after the change.

## REMOVED Requirements

### Requirement: <name>

**Reason**: why it goes.
**Migration**: what callers do instead.
```

`packs/openspec/templates/tasks.md`:

```markdown
---
id: openspec.template.tasks
phases: [specify]
title: OpenSpec tasks template
---
## Tasks

- [ ] 1. <first task, one sitting of work>
- [ ] 2. <second task>
- [ ] 3. Tests for the scenarios in spec.md
```

`packs/openspec/templates/apply.md`:

```markdown
---
id: openspec.template.apply
phases: [implement]
title: OpenSpec apply guidance
---
## Apply

Work through tasks.md in order. Tick each task in the file when its tests pass. Do not add scope that is not in proposal.md; if the spec is wrong, move back to specify with a reason.

## Tests

Every scenario in spec.md has at least one automated test named after it.
```

`packs/openspec/templates/verify.md`:

```markdown
---
id: openspec.template.verify
phases: [verify]
title: OpenSpec verify guidance
---
## Verify

Run the full test suite, lint and the security scanner. Compare the implementation against every scenario in spec.md and list the files changed.

## Evidence

Submit the evidence object with tests, lint, security and files_changed on the move to integrate. Sync the delta spec into the main spec library before archiving.
```

`packs/openspec/templates/archive.md`:

```markdown
---
id: openspec.template.archive
phases: [integrate]
title: OpenSpec archive guidance
---
## Archive

Open the pull request with the proposal summary, the evidence summary and the list of specs updated. After merge, move the change folder to `openspec/changes/archive/<date>-<name>/` and advance to archived.
```

`packs/openspec/templates/hotfix-proposal.md`:

```markdown
---
id: openspec.template.hotfix-proposal
phases: [specify]
title: OpenSpec hotfix proposal template
---
## Reproduction

Exact steps, environment and the incident id (INC-n). Include the failing request or log line.

## Expected Behaviour

What should happen instead, in one or two sentences.

## Regression Test

The test that fails today and will pass after the fix. Name the file and the test.
```

`packs/openspec/templates/hotfix-learn.md`:

```markdown
---
id: openspec.template.hotfix-learn
phases: [learn]
title: OpenSpec hotfix learn template
---
## Timeline

Detection, mitigation and resolution times.

## Root Cause

One paragraph. Name the component and the condition.

## Incident Memory Proposal

Call propose_memory with kind app_memory and memory_type incident: title "INC-n <summary>", body with the root cause and the guard added, links to the archived change. Record the proposal id here.
```

`packs/openspec/templates/refactor-proposal.md`:

```markdown
---
id: openspec.template.refactor-proposal
phases: [specify]
title: OpenSpec refactor design proposal template
---
## Observed Behaviors

What the code does today, including behaviour that looks wrong. Cite tests or logs for each item.

## Assumed Contracts

Callers and consumers that depend on the observed behaviour, and what they assume.

## Characterization Tests

The tests that pin the observed behaviours before any change. List file names; they must exist before implement.

## Approach

How the code changes without changing behaviour. The delta spec stays empty.
```

`packs/openspec/guides/workflow.md`:

```markdown
---
id: openspec.guide.workflow
title: OpenSpec workflow and commands
---
## Commands

`/openspec:proposal <name>` creates `openspec/changes/<name>/` with proposal.md, a delta spec and tasks.md. `/openspec:apply <name>` implements tasks. `/openspec:verify <name>` checks the implementation against the delta. `/openspec:archive <name>` merges the delta into `openspec/specs/` and archives the change.

## Delta specs

A delta lists ADDED, MODIFIED and REMOVED requirements. Removed requirements state a reason and a migration. Requirements use SHALL and each has at least one WHEN/THEN scenario.

## When to use which track

`default` for brownfield features. `hotfix` for production incidents: minimal proposal, deferred spec review, mandatory learn phase. `refactor` for behaviour-preserving changes: characterization tests first, no existing tests modified.
```

- [ ] **Step 5: Run the pack tests**

Run: `npx vitest run test/unit/packs`
Expected: PASS for both the openspec test and the all-packs validation.

- [ ] **Step 6: Commit**

```bash
git add packs/openspec test/unit/packs/openspec.test.ts
git commit -m "feat(packs): OpenSpec seed pack with default, hotfix and refactor tracks"
```

### Task 45: Spec Kit pack (tracks default, refactor)

**Files:**
- Create: `packs/spec-kit/pack.yaml`, `packs/spec-kit/README.md`, `packs/spec-kit/templates/spec.md`, `packs/spec-kit/templates/refactor-spec.md`, `packs/spec-kit/templates/plan.md`, `packs/spec-kit/templates/tasks.md`, `packs/spec-kit/templates/implement.md`, `packs/spec-kit/templates/verify.md`, `packs/spec-kit/templates/integrate.md`, `packs/spec-kit/templates/learn.md`, `packs/spec-kit/guides/workflow.md`
- Test: `test/unit/packs/spec-kit.test.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/packs/spec-kit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/spec-kit', import.meta.url));

describe('spec-kit pack', () => {
  it('maps all seven phases one to one and declares scope_drift on verify', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks).sort()).toEqual(['default', 'refactor']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
    expect(tracks.default!.phases.learn).toMatchObject({ alias: 'reconcile' });
    const verify = tracks.default!.gates.find((g) => g.transition === 'verify->integrate')!;
    expect(verify.artifacts).toEqual(['plan.md']);
    expect(verify.checks.map((c) => c.name)).toEqual(['verify_evidence', 'scope_drift']);
    const refactorSpecify = tracks.refactor!.gates.find((g) => g.transition === 'specify->plan')!;
    expect(refactorSpecify.checks[1]).toMatchObject({ name: 'required_sections', params: { sections: ['Observed Behaviors', 'Assumed Contracts', 'Characterization Tests'] } });
    expect(pack.items.some((i) => i.frontMatter.id === 'spec-kit.template.refactor-spec')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/packs/spec-kit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create pack.yaml and README**

`packs/spec-kit/pack.yaml`:

```yaml
name: spec-kit
kind: framework_pack
framework: spec-kit
version: 1.0.0
source_url: https://github.com/github/spec-kit
license: MIT
tracks:
  default:
    spec_review: required
    phases:
      specify:   { alias: specify, command: "/speckit.specify", template: spec-kit.template.spec }
      plan:      { alias: plan, command: "/speckit.plan", template: spec-kit.template.plan }
      tasks:     { alias: tasks, command: "/speckit.tasks", template: spec-kit.template.tasks }
      implement: { alias: implement, command: "/speckit.implement", template: spec-kit.template.implement }
      verify:    { alias: checklist, command: "/speckit.checklist", template: spec-kit.template.verify }
      integrate: { alias: pull-request, template: spec-kit.template.integrate }
      learn:     { alias: reconcile, template: spec-kit.template.learn }
    gates:
      - transition: specify->plan
        artifacts: [spec.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: spec.md, sections: [User Scenarios, Functional Requirements, Success Criteria] } }
          - { name: measurable_criteria, params: { artifact: spec.md, section: Success Criteria } }
      - transition: plan->tasks
        artifacts: [plan.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: plan.md, sections: [Technical Context, Project Structure] } }
      - transition: tasks->implement
        artifacts: [tasks.md]
        checks:
          - { name: placeholder_scan }
          - { name: task_ordering, params: { artifact: tasks.md, task_regex: "^- \\[ \\] (?<id>T\\d+)", dep_regex: "depends on (?<id>T\\d+)" } }
      - transition: verify->integrate
        artifacts: [plan.md]
        checks:
          - { name: verify_evidence }
          - { name: scope_drift, params: { plan_artifact: plan.md, files_section: Project Structure } }
  refactor:
    spec_review: required
    phases:
      specify:   { alias: specify, command: "/speckit.specify", template: spec-kit.template.refactor-spec }
      plan:      { alias: plan, command: "/speckit.plan", template: spec-kit.template.plan }
      tasks:     { alias: tasks, command: "/speckit.tasks", template: spec-kit.template.tasks }
      implement: { alias: implement, command: "/speckit.implement", template: spec-kit.template.implement }
      verify:    { alias: checklist, command: "/speckit.checklist", template: spec-kit.template.verify }
      integrate: { alias: pull-request, template: spec-kit.template.integrate }
      learn:     { alias: reconcile, template: spec-kit.template.learn }
    gates:
      - transition: specify->plan
        artifacts: [spec.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: spec.md, sections: [Observed Behaviors, Assumed Contracts, Characterization Tests] } }
      - transition: plan->tasks
        artifacts: [plan.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: plan.md, sections: [Technical Context, Project Structure] } }
      - transition: tasks->implement
        artifacts: [tasks.md]
        checks:
          - { name: placeholder_scan }
          - { name: task_ordering, params: { artifact: tasks.md, task_regex: "^- \\[ \\] (?<id>T\\d+)", dep_regex: "depends on (?<id>T\\d+)" } }
      - transition: verify->integrate
        artifacts: [plan.md]
        checks:
          - { name: verify_evidence, params: { max_existing_tests_modified: 0 } }
          - { name: scope_drift, params: { plan_artifact: plan.md, files_section: Project Structure } }
```

`packs/spec-kit/README.md`:

```markdown
# Spec Kit pack

Templates and phase mapping adapted from GitHub Spec Kit (MIT). The
constitution is not a phase here: it is the always-on `company.constitution`
standard. The `refactor` track is written for this project.
```

- [ ] **Step 4: Create the templates and guide**

`packs/spec-kit/templates/spec.md`:

```markdown
---
id: spec-kit.template.spec
phases: [specify]
title: Spec Kit feature specification template
---
## User Scenarios

### Primary user story

As a <role>, I want <capability> so that <outcome>.

### Acceptance scenarios

1. **Given** <state>, **When** <action>, **Then** <result>.

## Functional Requirements

- **FR-001**: The system MUST <behaviour>.
- **FR-002**: The system MUST <behaviour>.

## Success Criteria

- **SC-001**: <measurable outcome with a number and unit, for example "95% of exports complete within 2 s">.

## Clarifications

Questions resolved during /speckit.clarify, with the answer and date.
```

`packs/spec-kit/templates/refactor-spec.md`:

```markdown
---
id: spec-kit.template.refactor-spec
phases: [specify]
title: Spec Kit refactor specification template
---
## Observed Behaviors

What the code does today, with a test or log reference per item. Include behaviour that looks wrong; it is preserved until a separate feature changes it.

## Assumed Contracts

Callers, consumers and data formats that depend on the observed behaviours.

## Characterization Tests

Tests that pin the observed behaviours. List the files; they exist and pass before the plan phase.

## Success Criteria

- **SC-001**: Zero existing tests modified; characterization tests green before and after.
```

`packs/spec-kit/templates/plan.md`:

```markdown
---
id: spec-kit.template.plan
phases: [plan]
title: Spec Kit implementation plan template
---
## Technical Context

Language and version, primary dependencies, storage, testing tools, target platform, performance goals and constraints.

## Constitution Check

One line per always-on constraint stating how the plan satisfies it.

## Project Structure

Files and directories this feature creates or modifies, as a tree with backticked paths. This list is what scope_drift compares files_changed against.

## Research

Decisions taken during planning with the alternatives considered.
```

`packs/spec-kit/templates/tasks.md`:

```markdown
---
id: spec-kit.template.tasks
phases: [tasks]
title: Spec Kit tasks template
---
## Tasks

- [ ] T001 <setup task> in `path/to/file`
- [ ] T002 <test task>, depends on T001
- [ ] T003 <implementation task>, depends on T002

Tasks are ordered so every dependency appears earlier. Mark tasks that can run in parallel with [P].
```

`packs/spec-kit/templates/implement.md`:

```markdown
---
id: spec-kit.template.implement
phases: [implement]
title: Spec Kit implement guidance
---
## Implement

Execute tasks.md in order, tests before implementation, committing after each task. Update the checkbox in tasks.md when a task is done.
```

`packs/spec-kit/templates/verify.md`:

```markdown
---
id: spec-kit.template.verify
phases: [verify]
title: Spec Kit checklist guidance
---
## Checklist

Run the local harness: tests, lint, security scan. Walk every FR and SC in spec.md and note the test that covers it. Submit evidence with files_changed and implements on the move to integrate.
```

`packs/spec-kit/templates/integrate.md`:

```markdown
---
id: spec-kit.template.integrate
phases: [integrate]
title: Spec Kit pull request guidance
---
## Pull request

Title from the spec name. Body: user story, list of FR ids implemented, evidence summary, links to spec.md and plan.md. Merge after review and CI.
```

`packs/spec-kit/templates/learn.md`:

```markdown
---
id: spec-kit.template.learn
phases: [learn]
title: Spec Kit reconcile guidance
---
## Reconcile

Compare the merged code with spec.md and plan.md. Update the spec library where the implementation diverged deliberately. Propose memory for any decision that will outlive this feature, then advance to archived.
```

`packs/spec-kit/guides/workflow.md`:

```markdown
---
id: spec-kit.guide.workflow
title: Spec Kit workflow and commands
---
## Commands

`/speckit.specify` writes the feature spec. `/speckit.clarify` resolves open questions in it. `/speckit.plan` writes plan.md with the technical context and project structure. `/speckit.tasks` writes an ordered tasks.md. `/speckit.analyze` cross-checks spec, plan and tasks. `/speckit.implement` executes tasks. `/speckit.checklist` produces the verification checklist.

## Requirements and criteria

Functional requirements are numbered FR-nnn and use MUST. Success criteria are numbered SC-nnn and are measurable. The verify evidence `implements` field lists the FR ids covered.

## When to use which track

`default` for greenfield work and large changes. `refactor` for behaviour-preserving changes with characterization tests and no functional requirements.
```

- [ ] **Step 5: Run the pack tests**

Run: `npx vitest run test/unit/packs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packs/spec-kit test/unit/packs/spec-kit.test.ts
git commit -m "feat(packs): Spec Kit seed pack with default and refactor tracks"
```

### Task 46: BMAD pack (tracks quick, full)

**Files:**
- Create: `packs/bmad/pack.yaml`, `packs/bmad/README.md`, `packs/bmad/templates/quick-spec.md`, `packs/bmad/templates/quick-dev.md`, `packs/bmad/templates/prd.md`, `packs/bmad/templates/architecture.md`, `packs/bmad/templates/epics.md`, `packs/bmad/templates/stories.md`, `packs/bmad/templates/dev-story.md`, `packs/bmad/templates/code-review.md`, `packs/bmad/templates/integrate.md`, `packs/bmad/templates/retrospective.md`
- Test: `test/unit/packs/bmad.test.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/packs/bmad.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/bmad', import.meta.url));

describe('bmad pack', () => {
  it('declares quick and full tracks', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks).sort()).toEqual(['full', 'quick']);
    expect(phaseOrder(tracks.quick!)).toEqual(['specify', 'implement', 'verify', 'integrate']);
    expect(phaseOrder(tracks.full!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
    expect(tracks.quick!.phases.specify).toMatchObject({ alias: 'quick-spec', command: '/bmad-bmm-quick-spec' });
    const quickGate = tracks.quick!.gates.find((g) => g.transition === 'specify->implement')!;
    expect(quickGate.checks.map((c) => c.name)).toEqual(['placeholder_scan', 'required_sections', 'task_done_checks']);
    expect(tracks.full!.gates.find((g) => g.transition === 'specify->plan')!.artifacts).toEqual(['prd.md', 'architecture.md']);
    expect(tracks.full!.gates.find((g) => g.transition === 'learn->archived')!.artifacts).toEqual(['retrospective.md']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/packs/bmad.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create pack.yaml and README**

`packs/bmad/pack.yaml`:

```yaml
name: bmad
kind: framework_pack
framework: bmad
version: 1.0.0
source_url: https://github.com/bmad-code-org/BMAD-METHOD
license: MIT
tracks:
  quick:
    spec_review: required
    phases:
      specify:   { alias: quick-spec, command: "/bmad-bmm-quick-spec", template: bmad.template.quick-spec }
      plan:      skipped
      tasks:     skipped
      implement: { alias: quick-dev, command: "/bmad-bmm-quick-dev", template: bmad.template.quick-dev }
      verify:    { alias: code-review, command: "bmad-code-review", template: bmad.template.code-review }
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
    spec_review: required
    phases:
      specify:   { alias: prd-and-architecture, command: "/bmad-bmm-prd", template: bmad.template.prd }
      plan:      { alias: epics, command: "/bmad-bmm-epics", template: bmad.template.epics }
      tasks:     { alias: stories, command: "/bmad-bmm-stories", template: bmad.template.stories }
      implement: { alias: dev-story, command: "/bmad-bmm-dev-story", template: bmad.template.dev-story }
      verify:    { alias: code-review, command: "bmad-code-review", template: bmad.template.code-review }
      integrate: { alias: pull-request, template: bmad.template.integrate }
      learn:     { alias: retrospective, command: "/bmad-bmm-retrospective", template: bmad.template.retrospective }
    gates:
      - transition: specify->plan
        artifacts: [prd.md, architecture.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: prd.md, sections: [Goals, Requirements, Success Metrics] } }
          - { name: measurable_criteria, params: { artifact: prd.md, section: Success Metrics } }
          - { name: required_sections, params: { artifact: architecture.md, sections: [Decisions, Components] } }
      - transition: plan->tasks
        artifacts: [epics.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: epics.md, sections: [Epics] } }
      - transition: tasks->implement
        artifacts: [stories.md]
        checks:
          - { name: placeholder_scan }
          - { name: task_done_checks, params: { artifact: stories.md, task_regex: "^### Story ", done_regex: "Acceptance Criteria" } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence }
      - transition: learn->archived
        artifacts: [retrospective.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: retrospective.md, sections: [What Went Well, What To Change] } }
```

`packs/bmad/README.md`:

```markdown
# BMAD pack

Phase mapping and template shapes adapted from the BMAD Method (MIT). Two
tracks: `quick` (quick-spec, quick-dev, code review) for medium changes and
`full` (PRD and architecture, epics, stories, dev-story, code review,
retrospective) for large or compliance work.
```

- [ ] **Step 4: Create the templates**

`packs/bmad/templates/quick-spec.md`:

```markdown
---
id: bmad.template.quick-spec
phases: [specify]
title: BMAD quick spec template
---
## Goal

One paragraph: what changes and for whom.

## Acceptance Criteria

1. <AC 1, observable and testable>
2. <AC 2>

## Tasks

- [ ] <task> (AC: 1)
- [ ] <task> (AC: 2)

Every task names the acceptance criteria it satisfies with `(AC: n)`.
```

`packs/bmad/templates/quick-dev.md`:

```markdown
---
id: bmad.template.quick-dev
phases: [implement]
title: BMAD quick dev guidance
---
## Quick dev

Implement the tasks in quick-spec.md in order, writing the test for each acceptance criterion before the code. Stop and move back to specify if an acceptance criterion cannot be met as written.
```

`packs/bmad/templates/prd.md`:

```markdown
---
id: bmad.template.prd
phases: [specify]
title: BMAD product requirements document template
---
## Goals

Business and user goals, one line each, with the metric that shows the goal was met.

## Background

Context, constraints and what already exists.

## Requirements

### Functional

- **FR1**: <requirement>

### Non-functional

- **NFR1**: <requirement with a number and unit>

## Success Metrics

- <metric with a target number and unit, for example "checkout conversion up 2% within 30 days">

## Out of Scope

What this PRD deliberately excludes.
```

`packs/bmad/templates/architecture.md`:

```markdown
---
id: bmad.template.architecture
phases: [specify]
title: BMAD architecture document template
---
## Decisions

Numbered architecture decisions with the alternatives considered and why they were rejected. Reference existing ADRs by id.

## Components

Each component, its responsibility, its interfaces and its dependencies. A diagram is optional; the list is not.

## Data

Entities, ownership and migration plan.

## Cross-cutting

Security, observability, error handling and testing strategy.
```

`packs/bmad/templates/epics.md`:

```markdown
---
id: bmad.template.epics
phases: [plan]
title: BMAD epics template
---
## Epics

### Epic 1: <name>

Goal, the FRs it covers, and the order relative to other epics.

### Epic 2: <name>

Goal, the FRs it covers.
```

`packs/bmad/templates/stories.md`:

```markdown
---
id: bmad.template.stories
phases: [tasks]
title: BMAD stories template
---
## Stories

### Story 1.1: <name>

As a <role> I want <capability> so that <outcome>.

Acceptance Criteria:
1. <criterion>

### Story 1.2: <name>

As a <role> I want <capability> so that <outcome>.

Acceptance Criteria:
1. <criterion>

Every story block contains an Acceptance Criteria list.
```

`packs/bmad/templates/dev-story.md`:

```markdown
---
id: bmad.template.dev-story
phases: [implement]
title: BMAD dev story guidance
---
## Dev story

Take stories in order. For each: write the tests for its acceptance criteria, implement, run the suite, record the story as done in stories.md. Do not start a story whose dependencies are not done.
```

`packs/bmad/templates/code-review.md`:

```markdown
---
id: bmad.template.code-review
phases: [verify]
title: BMAD code review guidance
---
## Code review

Review the change against the acceptance criteria, the architecture decisions and the always-on standards. Run tests, lint and the security scan; submit the evidence object on the move to integrate. Findings that block are fixed before the pull request.
```

`packs/bmad/templates/integrate.md`:

```markdown
---
id: bmad.template.integrate
phases: [integrate]
title: BMAD pull request guidance
---
## Pull request

Summarise the goal, the stories or tasks completed, the evidence and any deviation from the architecture document. Merge after review and green CI.
```

`packs/bmad/templates/retrospective.md`:

```markdown
---
id: bmad.template.retrospective
phases: [learn]
title: BMAD retrospective template
---
## What Went Well

Concrete practices to keep.

## What To Change

Concrete changes to process, tooling or standards, each with an owner.

## Memory Proposals

Decisions worth keeping: call propose_memory for each and list the proposal ids.
```

- [ ] **Step 5: Run the pack tests**

Run: `npx vitest run test/unit/packs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packs/bmad test/unit/packs/bmad.test.ts
git commit -m "feat(packs): BMAD seed pack with quick and full tracks"
```

### Task 47: Kiro pack and the EARS standard

**Files:**
- Create: `packs/kiro/pack.yaml`, `packs/kiro/README.md`, `packs/kiro/templates/requirements.md`, `packs/kiro/templates/design.md`, `packs/kiro/templates/tasks.md`, `packs/kiro/templates/implement.md`, `packs/kiro/templates/verify.md`, `packs/kiro/templates/integrate.md`, `packs/kiro/standards/ears.md`
- Test: `test/unit/packs/kiro.test.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/packs/kiro.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack, effectiveKind, effectiveFramework } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/kiro', import.meta.url));

describe('kiro pack', () => {
  it('maps requirements, design and tasks and ships EARS as a framework-null standard', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks)).toEqual(['default']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate']);
    expect(tracks.default!.phases.specify).toMatchObject({ alias: 'requirements' });
    const ears = pack.items.find((i) => i.frontMatter.id === 'standard.ears')!;
    expect(effectiveKind(pack, ears)).toBe('standard');
    expect(effectiveFramework(pack, ears)).toBeNull();
    expect(ears.frontMatter.phases).toEqual(['specify']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/packs/kiro.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create pack.yaml and README**

`packs/kiro/pack.yaml`:

```yaml
name: kiro
kind: framework_pack
framework: kiro
version: 1.0.0
source_url: https://kiro.dev/docs/specs/
license: MIT
tracks:
  default:
    spec_review: required
    phases:
      specify:   { alias: requirements, template: kiro.template.requirements }
      plan:      { alias: design, template: kiro.template.design }
      tasks:     { alias: tasks, template: kiro.template.tasks }
      implement: { alias: implement, template: kiro.template.implement }
      verify:    { alias: verify, template: kiro.template.verify }
      integrate: { alias: pull-request, template: kiro.template.integrate }
      learn:     skipped
    gates:
      - transition: specify->plan
        artifacts: [requirements.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: requirements.md, sections: [Introduction, Requirements] } }
      - transition: plan->tasks
        artifacts: [design.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: design.md, sections: [Overview, Architecture] } }
      - transition: tasks->implement
        artifacts: [tasks.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: tasks.md, sections: [Implementation Plan] } }
      - transition: verify->integrate
        artifacts: []
        checks:
          - { name: verify_evidence }
```

`packs/kiro/README.md`:

```markdown
# Kiro pack

Templates written for this project in Kiro's three-document structure
(requirements, design, tasks) using EARS notation. No proprietary Kiro text is
copied. Kiro is routed only by policy or explicit preference (spec section
8.2) because its workflow assumes the Kiro IDE.
```

- [ ] **Step 4: Create the templates and the EARS standard**

`packs/kiro/templates/requirements.md`:

```markdown
---
id: kiro.template.requirements
phases: [specify]
title: Kiro requirements template
---
## Introduction

One paragraph on the feature and the user need it serves.

## Requirements

### Requirement 1

**User Story:** As a <role>, I want <capability>, so that <outcome>.

#### Acceptance Criteria

1. WHEN <event> THEN the system SHALL <response>
2. IF <condition> THEN the system SHALL <response>

### Requirement 2

**User Story:** As a <role>, I want <capability>, so that <outcome>.

#### Acceptance Criteria

1. WHILE <state> the system SHALL <response>
```

`packs/kiro/templates/design.md`:

```markdown
---
id: kiro.template.design
phases: [plan]
title: Kiro design template
---
## Overview

What is being built and the approach in two paragraphs.

## Architecture

Components, their interfaces and the data flow between them. Reference existing ADRs.

## Data Models

Entities and fields, with validation rules.

## Error Handling

Failure modes and the user-visible behaviour for each.

## Testing Strategy

Unit, integration and property tests planned, mapped to requirement numbers.
```

`packs/kiro/templates/tasks.md`:

```markdown
---
id: kiro.template.tasks
phases: [tasks]
title: Kiro tasks template
---
## Implementation Plan

- [ ] 1. <task>
  - <sub-step>
  - _Requirements: 1.1, 1.2_
- [ ] 2. <task>
  - _Requirements: 2.1_

Each task references the requirement numbers it implements.
```

`packs/kiro/templates/implement.md`:

```markdown
---
id: kiro.template.implement
phases: [implement]
title: Kiro implement guidance
---
## Implement

Execute the implementation plan one task at a time. Write the test for the referenced acceptance criteria first. Update tasks.md as tasks complete.
```

`packs/kiro/templates/verify.md`:

```markdown
---
id: kiro.template.verify
phases: [verify]
title: Kiro verify guidance
---
## Verify

Run tests, lint and the security scan. Walk every acceptance criterion in requirements.md and name the test that covers it. Submit evidence with `implements` listing the requirement numbers.
```

`packs/kiro/templates/integrate.md`:

```markdown
---
id: kiro.template.integrate
phases: [integrate]
title: Kiro pull request guidance
---
## Pull request

Reference requirements.md and design.md, summarise the evidence, and merge after review. Then advance to archived.
```

`packs/kiro/standards/ears.md`:

```markdown
---
id: standard.ears
kind: standard
framework: null
tier: retrieved
phases: [specify]
title: EARS requirement patterns
---
## Patterns

- Ubiquitous: The system SHALL <response>.
- Event-driven: WHEN <trigger> the system SHALL <response>.
- State-driven: WHILE <state> the system SHALL <response>.
- Unwanted behaviour: IF <condition> THEN the system SHALL <response>.
- Optional feature: WHERE <feature is included> the system SHALL <response>.
- Complex: combine WHILE, WHEN and IF in that order before SHALL.

## Rules

One SHALL per requirement. The response is observable and testable. Quantities carry units. Avoid "should", "may" and "quickly".
```

- [ ] **Step 5: Run the pack tests**

Run: `npx vitest run test/unit/packs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packs/kiro test/unit/packs/kiro.test.ts
git commit -m "feat(packs): Kiro seed pack and EARS standard"
```

### Task 48: sdlc house flow pack

**Files:**
- Create: `packs/sdlc/pack.yaml`, `packs/sdlc/README.md`, `packs/sdlc/templates/prd.md`, `packs/sdlc/templates/scoping.md`, `packs/sdlc/templates/jot-down.md`, `packs/sdlc/templates/tasks.md`, `packs/sdlc/templates/implement.md`, `packs/sdlc/templates/verify.md`, `packs/sdlc/templates/integrate.md`, `packs/sdlc/templates/retrospective.md`, `packs/sdlc/guides/workflow.md`
- Test: `test/unit/packs/sdlc.test.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/packs/sdlc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../../src/ingest/load.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { TrackDecl } from '../../../src/domain/types.js';

const dir = fileURLToPath(new URL('../../../packs/sdlc', import.meta.url));

describe('sdlc pack', () => {
  it('maps the house flow', async () => {
    const pack = await loadPack(dir);
    const tracks = pack.manifest.tracks as Record<string, TrackDecl>;
    expect(Object.keys(tracks)).toEqual(['default']);
    expect(phaseOrder(tracks.default!)).toEqual(['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn']);
    expect(tracks.default!.phases.plan).toMatchObject({ alias: 'jot-down' });
    expect(tracks.default!.phases.verify).toMatchObject({ alias: 'implement-task' });
    expect(tracks.default!.gates.find((g) => g.transition === 'specify->plan')!.artifacts).toEqual(['prd.md', 'scoping.md']);
    const tasksGate = tracks.default!.gates.find((g) => g.transition === 'tasks->implement')!;
    expect(tasksGate.checks.map((c) => c.name)).toEqual(['placeholder_scan', 'task_ordering', 'task_done_checks']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/packs/sdlc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create pack.yaml and README**

`packs/sdlc/pack.yaml`:

```yaml
name: sdlc
kind: framework_pack
framework: sdlc
version: 1.0.0
source_url: https://github.com/TextraAI/ai-sdlc
license: MIT
tracks:
  default:
    spec_review: required
    phases:
      specify:   { alias: prd-and-scoping, command: "/sdlc:prd", template: sdlc.template.prd }
      plan:      { alias: jot-down, command: "/sdlc:jot-down", template: sdlc.template.jot-down }
      tasks:     { alias: task-breakdown, command: "/sdlc:task-breakdown", template: sdlc.template.tasks }
      implement: { alias: implement-task, command: "/sdlc:implement-task", template: sdlc.template.implement }
      verify:    { alias: implement-task, command: "/sdlc:implement-task", template: sdlc.template.verify }
      integrate: { alias: pull-request, template: sdlc.template.integrate }
      learn:     { alias: retrospective, template: sdlc.template.retrospective }
    gates:
      - transition: specify->plan
        artifacts: [prd.md, scoping.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: prd.md, sections: [Problem, Users, Requirements, Success Metrics] } }
          - { name: measurable_criteria, params: { artifact: prd.md, section: Success Metrics } }
          - { name: required_sections, params: { artifact: scoping.md, sections: [In Scope, Out of Scope] } }
      - transition: plan->tasks
        artifacts: [jot-down.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: jot-down.md, sections: [Approach, Files] } }
      - transition: tasks->implement
        artifacts: [tasks.md]
        checks:
          - { name: placeholder_scan }
          - { name: task_ordering, params: { artifact: tasks.md, task_regex: "^- \\[ \\] (?<id>T\\d+)", dep_regex: "depends on (?<id>T\\d+)" } }
          - { name: task_done_checks, params: { artifact: tasks.md, task_regex: "^- \\[ \\] ", done_regex: "\\(AC: " } }
      - transition: verify->integrate
        artifacts: [jot-down.md]
        checks:
          - { name: verify_evidence }
          - { name: scope_drift, params: { plan_artifact: jot-down.md, files_section: Files } }
      - transition: learn->archived
        artifacts: [retrospective.md]
        checks:
          - { name: placeholder_scan }
          - { name: required_sections, params: { artifact: retrospective.md, sections: [Learnings, Memory Proposals] } }
```

`packs/sdlc/README.md`:

```markdown
# sdlc house flow pack

The TextraAI `sdlc` plugin workflow (PRD, scoping doc, jot down, task
breakdown, implement-task) as a routable framework, with templates so a host
without the plugin can follow it. Runtime behaviour of the plugin (agents,
Notion, Linear, branches) is out of scope for the pack (review decisions,
`docs/superpowers/reviews/2026-09-10-sdd-orchestrator-review.md`).
```

- [ ] **Step 4: Create the templates and guide**

`packs/sdlc/templates/prd.md`:

```markdown
---
id: sdlc.template.prd
phases: [specify]
title: sdlc PRD template
---
## Problem

The user problem in two sentences, with evidence (ticket, metric, interview).

## Users

Who is affected and how often.

## Requirements

- **R1**: <requirement>
- **R2**: <requirement>

## Success Metrics

- <metric with a target number and unit, for example "support tickets about exports down 50% within 60 days">

## Risks

Known risks and how they are mitigated.
```

`packs/sdlc/templates/scoping.md`:

```markdown
---
id: sdlc.template.scoping
phases: [specify]
title: sdlc scoping document template
---
## In Scope

Bullet list of what this feature delivers, mapped to PRD requirement ids.

## Out of Scope

Bullet list of what it deliberately does not deliver, with the reason.

## Dependencies

Other teams, systems or decisions this work waits on.
```

`packs/sdlc/templates/jot-down.md`:

```markdown
---
id: sdlc.template.jot-down
phases: [plan]
title: sdlc jot down template
---
## Approach

A short technical design note: the change in three to five paragraphs, the alternatives rejected and why.

## Files

Backticked paths of files created or modified. This list is what scope_drift compares files_changed against.

## Tests

Test files and what each proves.

## Rollout

Flags, migrations and monitoring.
```

`packs/sdlc/templates/tasks.md`:

```markdown
---
id: sdlc.template.tasks
phases: [tasks]
title: sdlc task breakdown template
---
## Tasks

- [ ] T1 <task> in `path/to/file` (AC: R1)
- [ ] T2 <task>, depends on T1 (AC: R2)

Each task names the requirement it satisfies with `(AC: Rn)` and its dependencies with "depends on Tn"; dependencies appear earlier in the list.
```

`packs/sdlc/templates/implement.md`:

```markdown
---
id: sdlc.template.implement
phases: [implement]
title: sdlc implement-task guidance
---
## Implement task

Take tasks in order. Write the test for the task's requirement, implement, run the suite, commit. Update the checkbox in tasks.md.
```

`packs/sdlc/templates/verify.md`:

```markdown
---
id: sdlc.template.verify
phases: [verify]
title: sdlc verification guidance
---
## Verify

Run the test agent equivalent: full suite, coverage, lint and security scan. Compare files changed against the jot down's Files section. Submit evidence with files_changed and implements on the move to integrate.
```

`packs/sdlc/templates/integrate.md`:

```markdown
---
id: sdlc.template.integrate
phases: [integrate]
title: sdlc pull request guidance
---
## Pull request

Body: problem, approach, requirements implemented, evidence summary, links to the PRD, scoping doc and jot down. Merge after review and green CI.
```

`packs/sdlc/templates/retrospective.md`:

```markdown
---
id: sdlc.template.retrospective
phases: [learn]
title: sdlc retrospective template
---
## Learnings

Two or three concrete learnings from this feature.

## Memory Proposals

Call propose_memory for each decision or constraint worth keeping; list the proposal ids here.
```

`packs/sdlc/guides/workflow.md`:

```markdown
---
id: sdlc.guide.workflow
title: sdlc house flow overview
---
## Artifacts

PRD and scoping doc in specify; jot down (a short technical design note) in plan; task breakdown in tasks; implement-task covers implement and verify; the pull request is integrate; the retrospective is learn.

## Traceability

Requirements are numbered Rn in the PRD. Tasks reference them with `(AC: Rn)`. Verify evidence lists them in `implements`.

## Stores

The plugin keeps artifacts in a local or remote artifact store (Notion or the repository). This server keeps only the text submitted at each gate; the artifact store stays the source for the documents themselves.
```

- [ ] **Step 5: Run the pack tests**

Run: `npx vitest run test/unit/packs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packs/sdlc test/unit/packs/sdlc.test.ts
git commit -m "feat(packs): sdlc house flow seed pack"
```

### Task 49: Full lifecycle integration test for every seed track

**Files:**
- Create: `test/helpers/seedPacks.ts`, `test/integration/packs/lifecycle.test.ts`

**Interfaces:**
- `seedPacks(pool)`: registers `checkout`, ingests every pack under `packs/` with the fake embedder.
- The test walks one feature per seed track from `start_feature` to `archived`, submitting artifacts that satisfy each gate, and asserts every transition, pack and artifact is recorded.

- [ ] **Step 1: Write the seed helper**

`test/helpers/seedPacks.ts`:

```ts
import type pg from 'pg';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../src/ingest/load.js';
import { ingestPack } from '../../src/ingest/ingest.js';
import { FakeEmbeddingProvider } from '../../src/embedding/fake.js';
import { createApp } from '../../src/store/apps.js';

const root = fileURLToPath(new URL('../../packs/', import.meta.url));
export const packsEmbedder = new FakeEmbeddingProvider();

async function packDirs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if (!(await stat(full)).isDirectory()) continue;
    try { await stat(join(full, 'pack.yaml')); out.push(full); } catch { out.push(...(await packDirs(full))); }
  }
  return out.sort();
}

export async function seedPacks(pool: pg.Pool): Promise<void> {
  await createApp(pool, { slug: 'checkout', name: 'Checkout', default_stack: ['typescript', 'react'] }, 'seed');
  for (const dir of await packDirs(root)) await ingestPack({ pool, embedder: packsEmbedder }, await loadPack(dir), 'seed');
}
```

- [ ] **Step 2: Write the failing lifecycle test**

`test/integration/packs/lifecycle.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestPool, truncateAll, closeTestPool } from '../../helpers/db.js';
import { seedPacks, packsEmbedder } from '../../helpers/seedPacks.js';
import { startFeature } from '../../../src/services/startFeature.js';
import { advancePhase } from '../../../src/services/advancePhase.js';
import { getFeatureStatus } from '../../../src/services/featureStatus.js';
import { getFrameworkVersion, trackOf } from '../../../src/store/frameworks.js';
import { phaseOrder } from '../../../src/lifecycle/track.js';
import type { ServiceDeps } from '../../../src/services/deps.js';
import type { Phase } from '../../../src/domain/types.js';

const url = process.env.SDD_TEST_DATABASE_URL;

const evidence = { tests: { command: 'npm test', passed: 12, failed: 0 }, lint: 'pass', security: { status: 'pass', new_high: 0 }, files_changed: ['src/orders/export.ts', 'src/orders/export.test.ts'], implements: ['REQ-1'], existing_tests_modified: 0, characterization_tests: ['src/orders/export.characterization.test.ts'] };

const proposal = '## Why\nExports are manual.\n\n## What Changes\n- Add a CSV export button.\n\n## Impact\nOrders page only.\n';
const deltaSpec = '## ADDED Requirements\n\n### Requirement: CSV export\n\nThe system SHALL export up to 10000 rows within 2 s.\n\n#### Scenario: export\n\n- **WHEN** the user clicks export\n- **THEN** a CSV downloads\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n';
const openspecTasks = '## Tasks\n\n- [ ] 1. Add endpoint\n- [ ] 2. Add button\n';
const hotfixProposal = '## Reproduction\nINC-204: export 500s for EU.\n\n## Expected Behaviour\nExport succeeds.\n\n## Regression Test\nsrc/orders/export.test.ts "eu export"\n';
const learn = '## Timeline\n10:00 detect, 10:20 fix.\n\n## Root Cause\nNull region.\n\n## Incident Memory Proposal\nproposal p_x submitted.\n';
const refactorProposal = '## Observed Behaviors\n- Exports buffer whole result (export.test.ts).\n\n## Assumed Contracts\n- Reporting reads the file after completion.\n\n## Characterization Tests\n- src/orders/export.characterization.test.ts\n\n## Approach\nStream instead of buffer.\n';
const emptyDelta = '## ADDED Requirements\n\n## MODIFIED Requirements\n\n## REMOVED Requirements\n';
const specKitSpec = '## User Scenarios\n\n### Primary user story\nAs an ops user I want CSV export.\n\n## Functional Requirements\n\n- **FR-001**: The system MUST export orders as CSV.\n\n## Success Criteria\n\n- **SC-001**: 95% of exports complete within 2 s.\n';
const specKitRefactorSpec = '## Observed Behaviors\n- buffers (test).\n\n## Assumed Contracts\n- file read after completion.\n\n## Characterization Tests\n- src/orders/export.characterization.test.ts\n\n## Success Criteria\n- 0 existing tests modified.\n';
const plan = '## Technical Context\nTypeScript 5, Node 22.\n\n## Project Structure\n- `src/orders/export.ts`\n- `src/orders/export.test.ts`\n';
const orderedTasks = '## Tasks\n\n- [ ] T001 Create endpoint in `src/orders/export.ts`\n- [ ] T002 Add test, depends on T001\n';
const quickSpec = '## Goal\nCSV export.\n\n## Acceptance Criteria\n1. Downloads CSV.\n\n## Tasks\n- [ ] Add endpoint (AC: 1)\n';
const prd = '## Goals\n- Faster reporting.\n\n## Requirements\n- **FR1**: export CSV.\n\n## Success Metrics\n- Reporting time down 50% within 30 days.\n';
const architecture = '## Decisions\n1. Stream exports.\n\n## Components\n- ExportService.\n';
const epics = '## Epics\n\n### Epic 1: Export\nCovers FR1.\n';
const stories = '## Stories\n\n### Story 1.1: Endpoint\nAs a user I want CSV.\n\nAcceptance Criteria:\n1. Downloads CSV.\n';
const retro = '## What Went Well\nTests first.\n\n## What To Change\nEarlier review.\n';
const requirements = '## Introduction\nCSV export.\n\n## Requirements\n\n### Requirement 1\n\n**User Story:** As a user I want CSV.\n\n#### Acceptance Criteria\n1. WHEN export clicked THEN the system SHALL download CSV\n';
const design = '## Overview\nStream CSV.\n\n## Architecture\nExportService streams rows.\n';
const kiroTasks = '## Implementation Plan\n\n- [ ] 1. Endpoint\n  - _Requirements: 1.1_\n';
const sdlcPrd = '## Problem\nManual exports.\n\n## Users\nOps.\n\n## Requirements\n- **R1**: CSV export.\n\n## Success Metrics\n- Tickets down 50% within 60 days.\n';
const scoping = '## In Scope\n- R1.\n\n## Out of Scope\n- Scheduling.\n';
const jotDown = '## Approach\nStream rows.\n\n## Files\n- `src/orders/export.ts`\n- `src/orders/export.test.ts`\n';
const sdlcTasks = '## Tasks\n\n- [ ] T1 Endpoint in `src/orders/export.ts` (AC: R1)\n- [ ] T2 Test, depends on T1 (AC: R1)\n';
const sdlcRetro = '## Learnings\nStreaming is simpler.\n\n## Memory Proposals\np_x\n';

// Artifacts per framework/track keyed by "from->to".
const ARTIFACTS: Record<string, Record<string, Record<string, string>>> = {
  'openspec/default': { 'specify->implement': { 'proposal.md': proposal, 'spec.md': deltaSpec, 'tasks.md': openspecTasks } },
  'openspec/hotfix': { 'specify->implement': { 'proposal.md': hotfixProposal }, 'learn->archived': { 'learn.md': learn } },
  'openspec/refactor': { 'specify->implement': { 'proposal.md': refactorProposal, 'spec.md': emptyDelta } },
  'spec-kit/default': { 'specify->plan': { 'spec.md': specKitSpec }, 'plan->tasks': { 'plan.md': plan }, 'tasks->implement': { 'tasks.md': orderedTasks }, 'verify->integrate': { 'plan.md': plan } },
  'spec-kit/refactor': { 'specify->plan': { 'spec.md': specKitRefactorSpec }, 'plan->tasks': { 'plan.md': plan }, 'tasks->implement': { 'tasks.md': orderedTasks }, 'verify->integrate': { 'plan.md': plan } },
  'bmad/quick': { 'specify->implement': { 'quick-spec.md': quickSpec } },
  'bmad/full': { 'specify->plan': { 'prd.md': prd, 'architecture.md': architecture }, 'plan->tasks': { 'epics.md': epics }, 'tasks->implement': { 'stories.md': stories }, 'learn->archived': { 'retrospective.md': retro } },
  'kiro/default': { 'specify->plan': { 'requirements.md': requirements }, 'plan->tasks': { 'design.md': design }, 'tasks->implement': { 'tasks.md': kiroTasks } },
  'sdlc/default': { 'specify->plan': { 'prd.md': sdlcPrd, 'scoping.md': scoping }, 'plan->tasks': { 'jot-down.md': jotDown }, 'tasks->implement': { 'tasks.md': sdlcTasks }, 'verify->integrate': { 'jot-down.md': jotDown }, 'learn->archived': { 'retrospective.md': sdlcRetro } },
};

describe.skipIf(!url)('seed track lifecycles', () => {
  let deps: ServiceDeps;
  beforeAll(async () => { const pool = await getTestPool(); await truncateAll(pool); await seedPacks(pool); deps = { pool, embedder: packsEmbedder, tokenBudget: 6000 }; });
  afterAll(closeTestPool);

  for (const key of Object.keys(ARTIFACTS)) {
    const [framework, track] = key.split('/') as [string, string];
    it(`${framework} ${track}: start to archived with every transition recorded`, async () => {
      const intent = track === 'hotfix' ? 'incident' : track === 'refactor' ? 'refactor' : 'feature';
      const decision = { intent, framework, track, confidence: 'high', rule: 'test', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' } as const;
      const start = await startFeature(deps, { app: 'checkout', actor: 'walker', task_description: `Walk ${key}`, decision, trigger_ref: track === 'hotfix' ? 'INC-204' : null });
      expect(start.context_pack).toContain('## 3. Phase template');
      const fw = (await getFrameworkVersion(deps.pool, framework, '1.0.0'))!;
      const phases = phaseOrder(trackOf(fw, track));
      let current: Phase = 'specify';
      for (let i = 0; i < phases.length; i++) {
        const target = i === phases.length - 1 ? 'archived' : phases[i + 1]!;
        const artifacts = ARTIFACTS[key]![`${current}->${target}`] ?? {};
        const r = await advancePhase(deps, {
          feature_id: start.feature_id, actor: 'walker', expected_phase: current, target_phase: target, artifacts,
          evidence: current === 'verify' ? evidence : undefined, human_approved: true,
        });
        expect(r.findings.filter((f) => f.severity === 'blocker'), `${key} ${current}->${target}`).toEqual([]);
        expect(r.result).toBe('pass');
        if (target !== 'archived') current = target as Phase;
      }
      const status = await getFeatureStatus(deps, start.feature_id);
      expect(status.status).toBe('archived');
      expect(status.transitions).toHaveLength(phases.length);
      expect(status.transitions.every((t) => t.result === 'pass')).toBe(true);
      const artifactRows = (await deps.pool.query('SELECT count(*)::int AS n FROM feature_artifacts a JOIN phase_transitions t ON t.id = a.transition_id WHERE t.feature_id = $1', [start.feature_id])).rows[0].n;
      const expected = Object.values(ARTIFACTS[key]!).reduce((s, a) => s + Object.keys(a).length, 0);
      expect(artifactRows).toBe(expected);
      expect(Object.keys(status.latest_pack_per_phase)).toEqual(['specify']);
    });
  }

  it('hotfix defers spec review to verify and requires it there', async () => {
    const decision = { intent: 'incident', framework: 'openspec', track: 'hotfix', confidence: 'high', rule: 'test', reasons: [], high_risk: true, policy_version: null, framework_pack_version: '1.0.0' } as const;
    const s = await startFeature(deps, { app: 'checkout', actor: 'w', task_description: 'outage', decision });
    const first = await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': hotfixProposal } });
    expect(first.result).toBe('pass');
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'implement', target_phase: 'verify' });
    const noApproval = await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'verify', target_phase: 'integrate', evidence });
    expect(noApproval.findings.map((f) => f.check)).toEqual(['human_approved']);
  });

  it('refactor tracks block when existing tests were modified', async () => {
    const decision = { intent: 'refactor', framework: 'openspec', track: 'refactor', confidence: 'high', rule: 'test', reasons: [], high_risk: false, policy_version: null, framework_pack_version: '1.0.0' } as const;
    const s = await startFeature(deps, { app: 'checkout', actor: 'w', task_description: 'refactor exports', decision });
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'specify', target_phase: 'implement', artifacts: { 'proposal.md': refactorProposal, 'spec.md': emptyDelta }, human_approved: true });
    await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'implement', target_phase: 'verify' });
    const r = await advancePhase(deps, { feature_id: s.feature_id, actor: 'w', expected_phase: 'verify', target_phase: 'integrate', evidence: { ...evidence, existing_tests_modified: 2 } });
    expect(r.result).toBe('fail');
    expect(r.findings[0]?.message).toMatch(/2 existing test file\(s\) modified, max 0/);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npx vitest run test/integration/packs`
Expected: PASS for all nine tracks plus the two track-specific tests. When a track fails, the assertion message names the transition; fix the pack template or the fixture artifact in this task, never the gate library.

- [ ] **Step 4: Run the whole suite**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/seedPacks.ts test/integration/packs
git commit -m "test: full lifecycle walkthrough for every seed track"
```

---

## Part L: Host verification and documentation

### Task 50: Host integration guide, feature matrix, workspace-facts script, walkthroughs, README

**Files:**
- Create: `docs/verification/host-integration.md`, `docs/verification/feature-matrix.md`, `docs/verification/workspace-facts.sh`, `docs/verification/walkthrough-openspec.md`, `docs/verification/walkthrough-spec-kit.md`
- Modify: `README.md` (Status, Development, Repository layout sections)
- Test: `test/unit/docs/workspaceFacts.test.ts`

- [ ] **Step 1: Write the failing test for the script**

`test/unit/docs/workspaceFacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../docs/verification/workspace-facts.sh', import.meta.url));

async function repo(commits: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wf-'));
  await run('git', ['init', '-q'], { cwd: dir });
  await run('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await run('git', ['config', 'user.name', 't'], { cwd: dir });
  for (let i = 0; i < commits; i++) {
    await writeFile(join(dir, `f${i}.txt`), String(i));
    await run('git', ['add', '.'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', `c${i}`], { cwd: dir });
  }
  return dir;
}

describe('workspace-facts.sh', () => {
  it('reports greenfield for a young repo without a spec library', async () => {
    const dir = await repo(3);
    const { stdout } = await run('bash', [script], { cwd: dir });
    expect(JSON.parse(stdout)).toEqual({ has_spec_library: false, is_greenfield: true, repositories: 1, host: expect.any(String) });
  });
  it('detects a spec library and honours the config greenfield flag', async () => {
    const dir = await repo(25);
    await mkdir(join(dir, 'openspec'));
    const { stdout } = await run('bash', [script], { cwd: dir });
    expect(JSON.parse(stdout)).toMatchObject({ has_spec_library: true, is_greenfield: false });
    await mkdir(join(dir, '.sdd'));
    await writeFile(join(dir, '.sdd', 'config.json'), JSON.stringify({ greenfield: true }));
    const { stdout: forced } = await run('bash', [script], { cwd: dir });
    expect(JSON.parse(forced).is_greenfield).toBe(true);
  });
  it('accepts a repositories count and a host name', async () => {
    const dir = await repo(1);
    const { stdout } = await run('bash', [script, '--repositories', '2', '--host', 'cursor'], { cwd: dir });
    expect(JSON.parse(stdout)).toMatchObject({ repositories: 2, host: 'cursor' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/docs`
Expected: FAIL, script not found.

- [ ] **Step 3: Create the workspace-facts script**

`docs/verification/workspace-facts.sh` (make it executable with `chmod +x`):

```bash
#!/usr/bin/env bash
# Derives the workspace facts that route_task expects (spec section 8.3).
# Usage: workspace-facts.sh [--repositories N] [--host NAME]
# Prints one JSON object. Facts the host must estimate itself (estimated_files,
# paths_touched, new_subsystem) are not derived here.
set -euo pipefail

repositories=1
host="${SDD_HOST:-claude-code}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repositories) repositories="$2"; shift 2 ;;
    --host) host="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

has_spec_library=false
for d in openspec specs .specify _bmad-output .kiro/specs .sdlc; do
  if [ -d "$d" ]; then has_spec_library=true; break; fi
done

is_greenfield=false
if [ -f .sdd/config.json ] && grep -Eq '"greenfield"[[:space:]]*:[[:space:]]*true' .sdd/config.json; then
  is_greenfield=true
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  commits=$(git rev-list --count HEAD 2>/dev/null || echo 0)
  if [ "$commits" -lt 20 ]; then is_greenfield=true; fi
else
  is_greenfield=true
fi

printf '{"has_spec_library":%s,"is_greenfield":%s,"repositories":%s,"host":"%s"}\n' \
  "$has_spec_library" "$is_greenfield" "$repositories" "$host"
```

- [ ] **Step 4: Run the script test**

Run: `chmod +x docs/verification/workspace-facts.sh && npx vitest run test/unit/docs`
Expected: PASS.

- [ ] **Step 5: Write the host integration guide**

`docs/verification/host-integration.md`:

```markdown
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
```

- [ ] **Step 6: Write the feature matrix**

`docs/verification/feature-matrix.md`:

```markdown
# Host feature matrix

Verified against the seed packs with the `fake` embedding provider. Fill the
"Verified" columns with the date and host version after running the
walkthroughs. A blank cell means not yet verified.

| Capability | Claude Code | Cursor | Notes |
|---|---|---|---|
| Streamable HTTP connection | | | `.mcp.json` / `.cursor/mcp.json` |
| stdio connection | | | local development only |
| Tool: route_task | | | structuredContent and text block |
| Tool: start_feature | | | pack returned inline |
| Tool: get_context | | | works on archived features |
| Tool: advance_phase | | | gate failure is a normal result |
| Tool: search_memory | | | scope "company" and slug lists |
| Tool: propose_memory | | | |
| Tool: get_feature_status | | | |
| Tool: list_features | | | |
| Error results (`isError`) rendered readably | | | code, message, details |
| Resource: sdd://apps/{slug} | | | Cursor resource browsing lags Tools |
| Resource: sdd://features/{id} | | | |
| Resource: sdd://frameworks/{name} | | | |
| Resource: sdd://knowledge/{stable_id} | | | |
| Resource: sdd://knowledge/{stable_id}/v/{version} | | | |
| Prompt: sdd.specify ... sdd.learn as slash commands | | | never the only path |
| Workspace facts script | | | `docs/verification/workspace-facts.sh` |

## How to verify a row

1. Connect the host to a server seeded with `packs/` and the `checkout` app.
2. Perform the action from the host's chat.
3. Record the date, host version and any deviation in the Notes column.
```

- [ ] **Step 7: Write the two walkthroughs**

`docs/verification/walkthrough-openspec.md`:

```markdown
# Walkthrough: one OpenSpec feature

Run in Claude Code and in Cursor. Record results in `feature-matrix.md`.

## Setup (once)

```bash
docker compose up -d
npm run admin -- app register checkout --name "Checkout" --actor admin
npm run admin -- app update checkout --stack typescript,react
for p in company quality-layer stack-guides/react openspec; do npm run admin -- ingest packs/$p --actor admin; done
```

## Steps

1. In a brownfield repository with an `openspec/` directory, ask the agent:
   "Add CSV export to the orders page. Use the sdd server."
2. Expect a `route_task` call with `is_greenfield: false`,
   `has_spec_library: true` and an `estimated_files` estimate. Expect the
   decision `openspec` / `default`, rule `10-brownfield-small-medium`.
3. Accept. Expect `start_feature` and a context pack whose position 3 is the
   OpenSpec proposal template and whose position 6 lists `proposal.md`,
   `spec.md`, `tasks.md` as the next gate's artifacts.
4. Let the agent write the three artifacts. Leave one `TBD` in
   `proposal.md`. Ask it to advance. Expect `result: "fail"` with a
   `placeholder_scan` finding naming the line, and no phase change.
5. Fix the placeholder. Say "I approve the proposal." Expect `advance_phase`
   with `human_approved: true`, `result: "pass"`, and next instructions for
   `implement (apply)`.
6. Move to verify, then ask the agent to move to integrate with test, lint
   and security results. Expect a `verify_evidence` pass and, if the scan was
   skipped, a warning finding.
7. Move to archived. Call `get_feature_status`: five transitions, status
   `archived`, one pack id under `specify`.
8. Ask "what did ADR-7 decide?" Expect `search_memory` with an exact-id hit
   if such an item exists, or an empty result without an error.

## Pass criteria

Every step produces the expected tool call and result shape. Every error the
host shows is readable as code and message.
```

`docs/verification/walkthrough-spec-kit.md`:

```markdown
# Walkthrough: one Spec Kit feature

Run in Claude Code and in Cursor. Record results in `feature-matrix.md`.

## Setup (once)

Same as the OpenSpec walkthrough, plus `npm run admin -- ingest packs/spec-kit --actor admin`.

## Steps

1. In a fresh repository (fewer than 20 commits, no spec library), ask:
   "Build a CLI that converts CSV to JSON. Use the sdd server."
2. Expect `route_task` with `is_greenfield: true` and the decision `spec-kit`
   / `default`, rule `11-greenfield-or-large`. If the agent omitted
   `estimated_files`, expect `confidence: "medium"` with clarifying
   questions; answer them and expect a second `route_task`.
3. Accept. Expect `start_feature` and a pack whose position 3 is the Spec Kit
   specification template.
4. Let the agent write `spec.md` with a vague success criterion ("fast").
   Expect a `measurable_criteria` blocker on advance. Fix it with a number and
   unit, approve, and expect `pass` with `plan` instructions.
5. Write `plan.md` and advance; write `tasks.md` with a dependency on a later
   task and expect a `task_ordering` blocker; fix and advance.
6. Move to verify. Move to integrate with evidence whose `files_changed`
   includes a file not listed in `plan.md`'s Project Structure. Expect
   `pass` with a `scope_drift` warning.
7. Move to learn, then archived. Ask the agent to propose an ADR; expect
   `propose_memory` and a pending proposal listed by
   `npm run admin -- proposals list`.
8. Run the `sdd.implement` prompt (slash command) on the archived feature;
   expect the implement pack and a new `context_packs` row with
   `created_by = prompt`.

## Pass criteria

As in the OpenSpec walkthrough.
```

- [ ] **Step 8: Update README.md**

Replace the `## Status` section with:

```markdown
## Status

v1 implemented per
[`docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`](docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md)
and the plan in
[`docs/superpowers/plans/2026-09-10-sdd-orchestrator-v1.md`](docs/superpowers/plans/2026-09-10-sdd-orchestrator-v1.md).
Host verification status is tracked in
[`docs/verification/feature-matrix.md`](docs/verification/feature-matrix.md).

## Development

```bash
npm install
npm run db:test:up                       # Postgres + pgvector on :55432
export SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test
npm test                                 # unit, integration and contract tests
npm run typecheck
npm run dev:stdio                        # server over stdio against SDD_DATABASE_URL
npm run admin -- app list                # sdd-admin without building
```
```

Replace the `## Repository layout (planned)` section with:

```markdown
## Repository layout

```
docs/superpowers/specs/   design specifications
docs/superpowers/plans/   implementation plans
docs/verification/        host integration guide, feature matrix, walkthroughs, workspace-facts script
migrations/               node-pg-migrate schema
packs/                    seed knowledge packs (frameworks, quality layer, stack guides, company)
src/                      server, services, assembler, ingestion and CLI
test/                     unit, integration and contract tests
```
```

Also change the line "The interface below is the one specified for v1. It is not implemented yet; examples show the intended shape so reviewers can judge the contract." to "The interface below is the v1 contract." and in example 4 update the sample decision's `track` to `"default"` and `rule` to `"10-brownfield-small-medium"`.

- [ ] **Step 9: Run the full suite one last time**

Run: `SDD_TEST_DATABASE_URL=postgres://sdd:sdd@localhost:55432/sdd_test npm test && npm run typecheck && npm run build`
Expected: PASS, clean.

- [ ] **Step 10: Commit**

```bash
git add docs/verification README.md test/unit/docs
git commit -m "docs: host integration guide, feature matrix, walkthroughs and workspace-facts script"
```

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| §5 Architecture, units | 2, 8, 15, 17, 23, 27, 36 |
| §5.2 Main call flow | 33, 34, 36, 37 |
| §6 Data model and rules | 19, 20, 21, 22, 23, 31 |
| §7.1 Tools | 36, 37, 38, 39 |
| §7.2 Result and error encoding | 36 |
| §7.3 Resources | 40 |
| §7.4 Prompts | 41 |
| §7.5 Error codes and precedence | 3, 34, 36 |
| §8 Router: signals, rules, track selection, trivial | 6, 7, 8, 33 |
| §8.3 Workspace facts | 36 (tool description), 50 (script) |
| §9.1 Pack order | 26, 27 |
| §9.2 Retrieval, scope, exact ids, dedup | 25, 27, 35 |
| §9.3 Budget and tokens | 4, 26, 27, 29 |
| §9.4 Degraded mode | 27, 35 |
| §10.1 Phases, aliases, mappings | 16, 44, 45, 46, 47, 48 |
| §10.2 Gate library | 9 to 15 |
| §10.3 Transitions, locking, approvals, cycles, archive | 17, 18, 34 |
| §10.4 Verify evidence | 14, 34 |
| §11.1 Deployment, env, migrations, stateless HTTP, healthz | 5, 19, 42 |
| §11.2 Client setup | 50 |
| §11.3 Security posture | 32 (writes CLI only), 42 (Host allowlist, private bind), 26 (provenance wrapper) |
| §11.4 Failure handling | 24, 27, 34 |
| §11.5 Observability | 36 (logs), 42 (metrics) |
| §12.1 Pack format | 28 |
| §12.2 Chunking | 30 |
| §12.3 Seed packs | 43 to 48 |
| §12.4 CLI and ingestion refusals | 29, 31, 32 |
| §13 Testing (router, gates, lifecycle, assembler, integration, contract, host) | tests in every task; 49; 50 |

Out of scope by spec §14 and not planned: RTM, impact report, adoption metrics beyond the five counters, system map, architecture boundaries, glossary, trust ladder, evals, audit bundle, authentication, LLM router, automatic ingestion, AIUP pack, Kiro IDE verification, plugin adaptation.
