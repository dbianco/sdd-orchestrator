---
name: sdd-workflow
description: How to work on a task in a repository governed by the SDD Orchestrator (a .sdd/config.json exists). Use before writing code for any new task, bug fix, refactor, incident or spike, and whenever an sdd tool returns awaiting_approval, a failed gate, STALE_STATE or FEATURE_BLOCKED.
---

# Working under the SDD Orchestrator

The `sdd` MCP server holds the lifecycle state; this repository's hooks block
code edits that are not backed by it. Follow these steps in order.

1. **Resume before routing.** If the session context names an active feature,
   call `get_context` for it. For a ticket, call `list_features` with the
   ticket id as `external_ref` and resume a match instead of starting again.
2. **Route.** Call `route_task` with the task, the app from
   `.sdd/config.json`, the ticket as `external_ref`, and workspace facts
   (run `docs/verification/workspace-facts.sh` if the repository has it;
   estimate `estimated_files` and `paths_touched` yourself). Set
   `workspace.intent` when you know the work is a `spike`, `incident`,
   `refactor`, `product` or `trivial` change: the server never infers those
   from wording, and a matching phrase only comes back as a clarifying
   question. Show the decision to the developer and answer clarifying
   questions by routing again.
3. **Trivial and spike work** needs no feature: the lite pack or spike
   guidance is the whole context, and edits are allowed.
4. **Everything else:** call `start_feature` with the accepted decision and
   the `routing_id`. Work from the context pack: write the artifacts the next
   gate lists, in the spec library (openspec/, specs/, .specify/,
   _bmad-output/, .kiro/specs/, .sdlc/) or docs/.
5. **Advance.** Call `advance_phase` with `expected_phase` set to the current
   phase. A `fail` result lists findings: fix them and call again. Use
   `dry_run: true` to check evidence before a real attempt.
6. **Approval.** `awaiting_approval` means every check passed and a person
   must decide. Tell the developer the `approval_id`; do not edit code or
   start the next phase; poll `get_feature_status` until `pending_approval`
   is null. Never send `human_approved`.
7. **Implement and verify.** Code edits are allowed from `implement`. On the
   move out of `verify`, send evidence with `tests`, `lint`, `security`,
   `files_changed` and `implements` (every requirement id you implemented,
   spelled as in the spec). Compliance and high-risk features also need CI
   evidence for the latest commit; push and let the pipeline report.
8. **Commit.** Add a trailer `SDD-Ref: <feature_id>` (or the `routing_id` for
   trivial work) to every commit message, and call `record_commit` after each
   commit.

Never edit files under `.sdd/`; the hooks maintain them from server
responses. If `STALE_STATE` comes back, call `get_feature_status` and retry
once. `FEATURE_BLOCKED` needs a person.
