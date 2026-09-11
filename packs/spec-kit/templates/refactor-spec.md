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
