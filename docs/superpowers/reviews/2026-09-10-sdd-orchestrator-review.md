# SDD Orchestrator Design Review

**Date:** 2026-09-10  
**Reviewed spec:** `docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`  
**Status:** Review notes; original spec unchanged

## Recommended architecture

Use a **control-plane MCP server** for v1.

The server owns:

- deterministic framework routing;
- feature lifecycle state;
- declarative gate evaluation;
- context-pack assembly;
- curated knowledge ingestion and retirement;
- MCP Tools, Resources, and Prompts.

The host agent owns repository access, file changes, tests, sub-agents,
commits, and external systems such as Notion, Linear, and CI.

The existing `ai-sldc` plugin contributes reusable knowledge, but is not a
runtime dependency and is not invoked by the server.

This is the smallest architecture that provides shared context engineering and
lifecycle enforcement while remaining host- and tool-agnostic.

## Decisions made

### Deployment and storage

- v1 is single-user/local-first.
- Use Postgres with `pgvector` as the canonical store.
- Use Docker for the local Postgres dependency.
- Support MCP over stdio for local use and Streamable HTTP for later shared use.
- Authentication and authorization are deferred for v1, but the HTTP boundary
  should remain easy to secure later.

### Embeddings

- Voyage is the default embedding provider.
- Ollama is supported through the same provider interface, especially for local
  development and privacy-sensitive deployments.
- Store provider, model, and embedding dimensions with index metadata so a
  provider/model change can be reindexed safely.

### Routing and composition

- Route to one lifecycle framework: OpenSpec, Spec Kit, BMAD, Kiro, or the
  `ai-sdlc` house workflow.
- Compose independent layers around that framework:
  - company standards;
  - app memory;
  - compliance rules;
  - stack guides;
  - quality practices;
  - domain skills.
- Agent Skills and `ai-sdlc` domain skills are layers, not competing lifecycle
  frameworks.
- Routing is rule-based and explainable. Retrieval happens after routing and
  does not decide the lifecycle framework.

### Feature state

- Postgres is the sole source of truth for feature state.
- Remove `.sdd/feature.json` from the v1 design.
- Hosts pass `feature_id` explicitly when resuming a feature.
- A future host integration may maintain a local convenience cache, but the
  server must never trust it as authoritative state.

### MCP contract

- `route_task` is read-only and returns a routing decision without creating a
  feature.
- Add an explicit `start_feature` operation to create lifecycle state after the
  route is accepted.
- Resume operations use an explicit `feature_id`.
- Every instruction-bearing tool returns a structured JSON envelope containing:
  - machine-readable metadata;
  - provenance and versions;
  - the rendered context pack as inline plain text.
- Resources and Prompts reuse the same assembler but are convenience layers,
  never the only access path.

### Lifecycle

- Retain a shared vocabulary such as `specify`, `plan`, `tasks`, `implement`,
  `verify`, `integrate`, and `learn`.
- Each framework pack declares its own valid phase graph, including:
  - optional phases;
  - aliases;
  - combined phases;
  - backward transitions;
  - retry loops;
  - terminal states.
- Do not force every framework into one universal linear lifecycle.

### Gates

- Gate definitions in knowledge packs are declarative.
- Packs may select and parameterize checks from a versioned allowlist of
  deterministic server checks.
- Packs may not contain executable policy code.
- New check implementations require a server release.
- Human approval remains an explicit host assertion and is recorded with the
  supplied actor identity; v1 does not authenticate that assertion.
- Host-reported test, lint, security, and file-change evidence is recorded but
  not executed or independently verified by the server.

### Retrieval scope

Default retrieval includes:

- the current app's active memory;
- globally approved company standards;
- relevant framework and stack guidance.

Cross-app memory requires an explicit scope request. Unrelated application
decisions must not enter a context pack by default.

### Knowledge ingestion

- Use curated, authored packs for v1.
- Every item must carry source, version, license, provenance, and status
  metadata.
- Ingestion is reviewed and versioned; active items are immutable.
- Deprecation removes items from default retrieval but preserves historical
  resolution by id and version.
- Do not mirror external documentation wholesale or automatically track
  upstream repositories in v1.

### `ai-sldc` seed pack

Include reusable guidance for:

- PRD, scoping, Jot Down, task breakdown, and verification workflow;
- local/remote artifact-store semantics;
- traceability and evidence rules;
- domain skills for Go, React, Node, frontend design, and web-design audit;
- failure-handling and safety-boundary patterns.

Exclude runtime execution behavior such as:

- invoking Claude Code agents;
- calling Notion or Linear;
- creating branches or commits;
- host-specific slash-command mechanics.

### AIUP and proprietary material

- Keep AIUP out of the seeded v1 packs until source material is available and
  suitable for curation.
- Kiro guidance should be authored or paraphrased for this project; do not copy
  proprietary text.
- External framework packs should contain reviewed templates, summaries, and
  extracted practices with attribution rather than mirrored documentation.

## Main review findings against the current spec

1. **Repository-state contradiction:** the spec says the server never reads or
   writes repositories but also proposes `.sdd/feature.json` as workspace state.
   Remove the file from the authoritative design.

2. **Routing side effect:** `route_task` both decides and creates a feature.
   Split preview/decision from explicit feature creation.

3. **Lifecycle over-normalization:** the seven phases currently imply a fixed
   sequence even though framework mappings differ materially. Use per-framework
   phase graphs over shared names.

4. **Gate extensibility ambiguity:** packs declare gates, but the execution
   model is not defined. Use a versioned allowlist of deterministic checks.

5. **Layer/framework ambiguity:** Agent Skills and `ai-sdlc` domain skills are
   described alongside lifecycle frameworks. Model them as attachable layers.

6. **Provenance and licensing:** external frameworks, authored Kiro guidance,
   local plugin material, and future AIUP content need distinct source and
   licensing metadata.

7. **Embedding reindex safety:** the data model needs provider/model/dimension
   metadata so changing Voyage or Ollama configuration cannot silently mix
   incompatible vectors.

8. **Unverified host facts:** `workspace` facts and `human_approved` are claims
   supplied by the host. The spec should state that they are recorded as
   assertions, not independently verified by the server.

9. **Shared HTTP security:** no-auth is acceptable only for the local/trusted
   v1 deployment. The design should reserve an authentication and authorization
   boundary before shared deployment.

## Options considered

### A. Control-plane MCP server — recommended

The server routes, tracks, gates, retrieves, and ingests. Hosts execute. This
keeps permissions and provider-specific behavior at the edge.

### B. MCP orchestration gateway

The server also dispatches host skills, agents, repositories, Notion, Linear,
or CI. This offers more automation but introduces host-specific adapters,
permission complexity, and unclear ownership. It is out of scope for v1.

### C. Retrieval-only context service

The server only indexes knowledge and returns context. Lifecycle and gates stay
in each host/plugin. This is simpler but loses shared enforcement and invites
behavioral drift between hosts.

## Source note

The framework distinction used in this review follows the comparison at
<https://ainativesoftware.engineering/compare>: Spec Kit, OpenSpec, and BMAD
are lifecycle frameworks; Agent Skills is a composable practice layer. The
comparison was checked on 2026-09-10.

## Suggested next revision

Revise the design spec around the decisions above, then perform a self-review
for contradictions, especially around:

- the exact MCP tool list after adding `start_feature`;
- framework-specific phase graph representation;
- gate registry schemas and versioning;
- embedding metadata and reindex behavior;
- host-asserted evidence;
- local deployment and future authentication boundaries.
