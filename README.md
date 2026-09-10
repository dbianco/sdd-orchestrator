# SDD Orchestrator

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server
that gives coding agents the right spec-driven-development (SDD) context at the
right moment.

For each task it:

- **routes** the task to the best-fitting SDD framework (OpenSpec, GitHub Spec
  Kit, BMAD, Kiro, or a house workflow) using explainable rules;
- **keeps lifecycle state** per feature and runs deterministic gate checks
  between phases, so gates are enforced rather than advisory;
- **assembles a context pack** per phase from a company-wide knowledge base,
  with app-scoped memory (ADRs, accepted specs, decisions) and explicit
  cross-app lookup.

The host agent (Claude Code, Cursor, or any MCP client) remains the only thing
that edits files, runs tests or spawns sub-agents. The server reads and writes
only its own database.

## Status

Design phase. The full design is in
[`docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md`](docs/superpowers/specs/2026-09-10-sdd-orchestrator-design.md).
No code yet.

## Planned stack

| Component | Choice |
|---|---|
| Runtime | TypeScript on Node 22 |
| Transport | MCP over Streamable HTTP (shared) and stdio (local dev) |
| Storage | Postgres with pgvector, shipped via Docker Compose |
| Embeddings | Voyage AI by default, Ollama for development |
| Admin | `sdd-admin` CLI for ingesting packs, approving proposals, deprecating items |

## Repository layout (planned)

```
docs/superpowers/specs/   design specifications
docs/verification/        host walkthrough checklists
packs/                    seed knowledge packs (frameworks, quality layer, stack guides)
src/                      server and CLI source
```

## License

MIT
