---
description: Show the SDD state of the current branch - routed work, feature phase, pending approval and uncovered requirements
allowed-tools: Read, mcp__plugin_sdd_sdd__get_feature_status, mcp__sdd__get_feature_status
---

Read `.sdd/state.json` and find the entry for the current git branch. If it
names a `feature_id`, call `get_feature_status` for it and report: phase and
alias, status and blocked reason, pending approval (id, requested by, since
when), and requirements that are not covered. If it only names a
`routing_id`, report the routed intent and that no feature is open. If there
is no entry, say that nothing is routed on this branch and that `/sdd:route`
routes the current task.
