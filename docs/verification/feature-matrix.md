# Host feature matrix

Verified against the seed packs with the `fake` embedding provider. Fill the
"Verified" columns with the date and host version after running the
walkthroughs. A blank cell means not yet verified.

> With `SDD_EMBEDDING_PROVIDER=fake`, expect positions 4 and 5 of a context
> pack to be empty for an ordinary task query. The fake provider is a hashed
> bag of words, not a semantic model: measured against the real seed packs,
> "Add CSV export to the orders page" scores 0.32 against its best chunk,
> just under the 0.35 default similarity floor, so nothing is retrieved and no
> warning is emitted (an empty retrieval is not a degraded retrieval). This is
> a property of the stand-in embedder, not of retrieval. To see positions 4
> and 5 populated during a fake-provider walkthrough, either lower the floor
> for the app (`sdd-admin app update checkout --min-similarity 0.25`, which
> brings `quality.tdd` into the pack for that query) or pass a `focus` that
> uses the target document's own vocabulary. Verify the retrieval rows in this
> matrix against a real embedding provider.

| Capability | Claude Code | Cursor | Notes |
|---|---|---|---|
| Streamable HTTP connection | 2026-09-25, 2.1.282 headless | | `.mcp.json` / `.cursor/mcp.json`; Claude Code checked through the plugin's `.mcp.json` with `${SDD_URL}` expansion |
| stdio connection | 2026-09-25, 2.1.282 headless | | local development only |
| Tool: route_task | 2026-09-25, 2.1.282 headless | | structuredContent and text block; as `mcp__plugin_sdd_sdd__route_task` through the plugin |
| Tool: start_feature | 2026-09-25, 2.1.282 headless | | pack returned inline |
| Tool: get_context | | | works on archived features |
| Tool: advance_phase | | | gate failure is a normal result |
| Tool: search_memory | | | scope "company" and slug lists |
| Tool: propose_memory | | | |
| Tool: get_feature_status | | | |
| Tool: list_features | 2026-09-25, 2.1.282 headless | | |
| Tool: record_commit | | | after a route_task, call it with `external_ref` and a sha: expect `commit_id` and `deduplicated: false`; call again with the same sha for `deduplicated: true` |
| Error results (`isError`) rendered readably | | | code, message, details |
| Bearer token in MCP config (`SDD_AUTH_MODE=enforce`) | | | 401 without it; token actor recorded |
| `awaiting_approval` shown and followed by the agent | | | agent stops and polls `get_feature_status` |
| Approval decided in the admin UI Approvals tab | | | personal approver token login |
| CI evidence posted by `scripts/sdd-ci-evidence.mjs` | | | required for compliance and high-risk features |
| Resource: sdd://apps/{slug} | | | Cursor resource browsing lags Tools |
| Resource: sdd://features/{id} | | | |
| Resource: sdd://frameworks/{name} | | | |
| Resource: sdd://knowledge/{stable_id} | | | |
| Resource: sdd://knowledge/{stable_id}/v/{version} | | | |
| Prompt: sdd.specify ... sdd.learn as slash commands | | | never the only path |
| Workspace facts script | | | `docs/verification/workspace-facts.sh` |
| Plugin: edit refused before routing | 2026-09-25, 2.1.282 headless | n/a | reason shown to the agent: "No SDD work is routed on main. Call route_task…" |
| Plugin: `.sdd/state.json` written from `route_task` | 2026-09-25, 2.1.282 headless | n/a | trivial routing recorded, edit then allowed |
| Plugin: `enforcement: warn` passes the warning to the agent | 2026-09-25, 2.1.282 headless | n/a | write allowed, "SDD warning: …" quoted back by the agent |
| Plugin: interactive walkthrough (specify, approval, implement, commit prompt) | | n/a | needs a person: install from the marketplace and run `walkthrough-openspec.md` |

"headless" means `claude -p` with the plugin loaded by `--plugin-dir` (or the
server in a project `.mcp.json`) against a live server seeded with the test
fixtures. The PostToolUse payload those runs rely on is recorded under task 25
of `docs/superpowers/plans/2026-09-25-trust-traceability-enforcement.md`.

## How to verify a row

1. Connect the host to a server seeded with `packs/` and the `checkout` app.
2. Perform the action from the host's chat.
3. Record the date, host version and any deviation in the Notes column.
