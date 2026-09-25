# SDD Orchestrator: Analysis and Company Adoption Review

**Date:** 2026-09-25
**Reviewed:** `main` at `fea16a6`: the design spec, the 2026-09-10 review,
the host integration guide, the operations notes, and the router, gate,
assembler and metrics code. Router and gate behaviour was checked by running
the code on sample inputs.
**Perspective:** a spec-driven development practitioner asking two questions:
does the tool do what it promises, and how does the company get more value
from it?
**Follow-ups:** bugs fixed in PR #4 (`claude/fix-router-and-gate-bugs`);
structural gaps addressed by the design spec
`docs/superpowers/specs/2026-09-25-trust-traceability-enforcement-design.md`.

## 1. Verdict

The design is strong: routing is rule-based and explains itself, the audit
trail is immutable, memory is scoped per app, and every context pack is
stored exactly as the agent saw it. The company is not yet getting that
value, for three reasons:

- the process runs only if the agent chooses to follow it;
- the evidence behind the gates is whatever the agent says it is;
- nobody has run the tool with a real host or a real embedding model yet.

## 2. Confirmed bugs

All three were reproduced by running the code. All three are fixed in PR #4.

### 2.1 Task wording switches the process

`src/router/intent.ts:9-15` infers the intent from keyword lists in the task
text, and the router applies it:

| Task text | Inferred intent | Consequence |
|---|---|---|
| "**Can we** add CSV export to the orders page?" | `spike` | No feature, no gates: a real feature skips the process |
| "**Extract** invoice totals into the monthly report" | `refactor` | Requires characterization tests and no functional requirements |
| "Add **P1** priority badge to support tickets" | `incident` | Forces the high-risk flag and the hotfix track, deferring spec review |
| "Refresh the **PRD** link in the footer" | `product` | Starts the full product-requirements flow |

**Fix in PR #4:** a text match for `spike`, `incident`, `refactor` or
`product` no longer decides the intent. The task routes as a `feature`,
confidence drops to medium, and the first clarifying question names the
matched phrase and asks the host to set `workspace.intent`. `remediation` is
still inferred from text because it routes exactly like a feature.

### 2.2 The measurability check accepts any number

`src/gates/checks/measurableCriteria.ts:11` accepts a bare integer as a
threshold, so "Export must be fast for 2 users" passes because of the 2.

**Fix in PR #4:** a threshold needs a number with a unit (`200 ms`, `99.9%`,
`500 req/s`) or with a bound (`at least 100`, `≤ 50`, `within 2 s`).

### 2.3 Adding a framework still needs a code change

The design says a new framework only needs a pack, but track selection
hard-codes `openspec`, `spec-kit` and `bmad` in `src/router/router.ts:70-76`.

**Fix in PR #4:** each track in `pack.yaml` declares the `intents` it handles
and can be marked `is_default`; ingestion rejects conflicting declarations.
Rules 5 to 11 still name frameworks by design (they are the routing table);
making that table configurable is a larger redesign left for later.

**Upgrade note:** re-run `sdd-admin ingest` for the OpenSpec, Spec Kit and
BMAD packs after deploying PR #4, otherwise routing an incident or refactor
fails with `UNKNOWN_FRAMEWORK`.

## 3. Structural gaps

Each is addressed by the 2026-09-25 design spec; the section numbers point
into it.

| Gap | Evidence | Proposed direction |
|---|---|---|
| Nothing enforces the process in the editor | No Claude Code plugin, hooks or skill ship with the server; the session flow in `host-integration.md` relies on the agent reading and following it, which the design itself says agents do not do reliably | Claude Code plugin with hooks that block code edits outside an active lifecycle and write local state from server responses (§9) |
| The agent's word is the only proof | Test, lint and security evidence and `human_approved` are host assertions (v1 spec §8.3); `actor` is free text; no authentication | Tokens per person and pipeline (§4), approvals by an authenticated person on the server (§5), CI-sourced evidence for compliance apps and high-risk features (§6) |
| Requirement tracing stops halfway | `evidence.implements` is validated and stored, but nothing reads it (only `src/domain/types.ts:83` references it) | Capture requirement ids at the spec gate, check coverage out of verify, export a traceability matrix per app (§7) |
| Nothing verified with a real host or embedder | Every row of `docs/verification/feature-matrix.md` is blank; retrieval was only exercised with the fake embedder, which scores the README's own example task (0.32) under the 0.35 similarity floor | Retrieval evaluation with golden cases (§10.1) and a scripted walkthrough (§10.2); the Claude Code and Cursor rows still need a person |
| Context packs can miss documents a gate needs | A phase pins one template, but OpenSpec's specify gate needs three documents and BMAD and `sdlc` need two; the agent must know the `focus` workaround | Several pinned templates per phase (§8) |
| No CI | No `.github/` directory, although the seed constitution requires tests in CI before merge | GitHub Actions workflow: typecheck, unit, integration and contract tests against pgvector, admin UI, plugin, evaluation, Docker build (§11) |

## 4. How the company gets more out of it

In priority order.

1. **Pilot first, for 2 to 4 weeks.** Pick one brownfield app and one
   compliance app, and fill the feature matrix with real Voyage embeddings.
   Record a baseline now: lead time per ticket, rework rate, and escaped
   defects on spec'd versus unspec'd work. Without a baseline there is no
   way to show return on investment.
2. **Ship the Claude Code plugin.** It turns "please follow the process"
   into a guarantee inside the editor.
3. **Take evidence and approvals from systems, not the agent.** CI posts
   results with its own token, a person approves on the server, and compliance apps
   accept only CI evidence.
4. **Finish the traceability matrix.** Requirement to code to test to
   approval is the artifact auditors and product managers will actually use.
5. **Measure outcomes, not counts.** The admin UI and `/metrics` show
   volumes. Add time in each phase and lead time, first-pass gate rate by
   check, rework after archive (commits touching an archived feature's
   files), the share of work handled as `trivial`, and how often retrieved
   ADRs are reused. These numbers show which gates earn their friction.
6. **Keep the memory healthy.** Knowledge only compounds if it stays current:
   proposal approval in the admin UI (the CLI is a bottleneck), a `review_by`
   date with a stale-item report (v1 roadmap §14.2), and golden retrieval
   cases run before any reindex.
7. **Cut down the framework list.** Five frameworks mean five vocabularies to
   train people on. Use the routing-event data from the pilot to standardize
   on OpenSpec for brownfield work and Spec Kit for greenfield, plus the
   house flow, and keep BMAD only where policy pins it.

## 5. Decisions already taken

Made with the requester on 2026-09-25, and reflected in the design spec:

- Identity through tokens issued by `sdd-admin`; evidence tagged `ci` or
  `host`, with CI evidence required for compliance apps and high-risk
  features.
- Mandatory approvals given by a person on the server, through `sdd-admin`
  or the admin UI.
- Spec first: the design spec is reviewed before a plan and code.

Open questions for the spec review are listed in its section 18.
