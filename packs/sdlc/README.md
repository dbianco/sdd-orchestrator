# sdlc house flow pack

The TextraAI `sdlc` plugin workflow (PRD, scoping doc, jot down, task
breakdown, implement-task) as a routable framework, with templates so a host
without the plugin can follow it. Runtime behaviour of the plugin (agents,
Notion, Linear, branches) is out of scope for the pack (review decisions,
`docs/superpowers/reviews/2026-09-10-sdd-orchestrator-review.md`).

`source_url` in `pack.yaml` points at `github.com/TextraAI/ai-sdlc`, a private
repository: the link identifies the workflow's origin but does not resolve
without access. No text is copied from it — every template here is an original
written for this project, which is what `license: MIT` on the pack refers to.
