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
