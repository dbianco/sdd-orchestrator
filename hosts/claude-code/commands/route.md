---
description: Route the task described in the arguments through the SDD Orchestrator
argument-hint: <task description> [ticket id]
---

Route this task with the `sdd` server: $ARGUMENTS

Read the app slug from `.sdd/config.json`. If the repository has
`docs/verification/workspace-facts.sh`, run it for `has_spec_library`,
`is_greenfield`, `repositories` and `host`; add your own estimates for
`estimated_files`, `paths_touched` and `new_subsystem`, and `stack` from the
project manifest. Set `workspace.intent` only when the work is clearly a
spike, incident, refactor, product or trivial change. Call `route_task`, show
the decision with its reasons and clarifying questions, and wait for the
developer to accept before calling `start_feature`.
