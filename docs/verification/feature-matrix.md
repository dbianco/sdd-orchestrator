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

| Capability | Scripted | Claude Code | Cursor | Notes |
|---|---|---|---|---|
| Streamable HTTP connection | walkthrough.mjs | 2026-09-25, 2.1.282 headless | | `.mcp.json` / `.cursor/mcp.json`; Claude Code checked through the plugin's `.mcp.json` with `${SDD_URL}` expansion |
| stdio connection |  | 2026-09-25, 2.1.282 headless | | local development only |
| Tool: route_task | walkthrough.mjs | 2026-09-25, 2.1.282 headless | | structuredContent and text block; as `mcp__plugin_sdd_sdd__route_task` through the plugin |
| Tool: start_feature | walkthrough.mjs | 2026-09-25, 2.1.282 headless | | pack returned inline |
| Tool: get_context | walkthrough.mjs | | | works on archived features |
| Tool: advance_phase | walkthrough.mjs | | | gate failure is a normal result |
| Tool: search_memory | walkthrough.mjs | | | scope "company" and slug lists |
| Tool: propose_memory |  | | | |
| Tool: get_feature_status | walkthrough.mjs | | | |
| Tool: list_features | walkthrough.mjs | 2026-09-25, 2.1.282 headless | | |
| Tool: record_commit | walkthrough.mjs | | | after a route_task, call it with `external_ref` and a sha: expect `commit_id` and `deduplicated: false`; call again with the same sha for `deduplicated: true` |
| Error results (`isError`) rendered readably |  | | | code, message, details |
| Bearer token in MCP config (`SDD_AUTH_MODE=enforce`) | walkthrough.mjs | | | 401 without it; token actor recorded |
| `awaiting_approval` shown and followed by the agent | walkthrough.mjs | | | agent stops and polls `get_feature_status` |
| Approval decided in the admin UI Approvals tab | walkthrough.mjs | | | personal approver token login |
| CI evidence posted by `scripts/sdd-ci-evidence.mjs` | walkthrough.mjs | | | required for compliance and high-risk features |
| Resource: sdd://apps/{slug}/rtm | walkthrough.mjs | | | requirement coverage and evidence source per feature |
| Resource: sdd://apps/{slug} |  | | | Cursor resource browsing lags Tools |
| Resource: sdd://features/{id} |  | | | |
| Resource: sdd://frameworks/{name} |  | | | |
| Resource: sdd://knowledge/{stable_id} |  | | | |
| Resource: sdd://knowledge/{stable_id}/v/{version} |  | | | |
| Prompt: sdd.specify ... sdd.learn as slash commands |  | | | never the only path |
| Workspace facts script |  | | | `docs/verification/workspace-facts.sh` |
| Plugin: edit refused before routing |  | 2026-09-25, 2.1.282 headless | n/a | reason shown to the agent: "No SDD work is routed on main. Call route_task…" |
| Plugin: `.sdd/state.json` written from `route_task` |  | 2026-09-25, 2.1.282 headless | n/a | trivial routing recorded, edit then allowed |
| Plugin: `enforcement: warn` passes the warning to the agent |  | 2026-09-25, 2.1.282 headless | n/a | write allowed, "SDD warning: …" quoted back by the agent |
| Plugin: interactive walkthrough (specify, approval, implement, commit prompt) |  | | n/a | needs a person: install from the marketplace and run `walkthrough-openspec.md` |

"Scripted" rows are exercised by `docs/verification/walkthrough.mjs`, which
drives a running server over Streamable HTTP with host, approver and ci
tokens and prints pass or fail per row; `test/contract/walkthrough.test.ts`
runs it in CI. It checks the server contract as any host sees it, not a
host's behaviour, so the Claude Code and Cursor columns stay separate.

"headless" means `claude -p` with the plugin loaded by `--plugin-dir` (or the
server in a project `.mcp.json`) against a live server seeded with the test
fixtures. The PostToolUse payload those runs rely on is recorded under task 25
of `docs/superpowers/plans/2026-09-25-trust-traceability-enforcement.md`.

## How to verify a row

1. Connect the host to a server seeded with `packs/` and the `checkout` app.
2. Perform the action from the host's chat.
3. Record the date, host version and any deviation in the Notes column.
