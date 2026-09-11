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
