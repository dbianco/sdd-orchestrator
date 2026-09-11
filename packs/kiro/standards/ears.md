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
