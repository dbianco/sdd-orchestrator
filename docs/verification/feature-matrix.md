# Host feature matrix

Verified against the seed packs with the `fake` embedding provider. Fill the
"Verified" columns with the date and host version after running the
walkthroughs. A blank cell means not yet verified.

| Capability | Claude Code | Cursor | Notes |
|---|---|---|---|
| Streamable HTTP connection | | | `.mcp.json` / `.cursor/mcp.json` |
| stdio connection | | | local development only |
| Tool: route_task | | | structuredContent and text block |
| Tool: start_feature | | | pack returned inline |
| Tool: get_context | | | works on archived features |
| Tool: advance_phase | | | gate failure is a normal result |
| Tool: search_memory | | | scope "company" and slug lists |
| Tool: propose_memory | | | |
| Tool: get_feature_status | | | |
| Tool: list_features | | | |
| Error results (`isError`) rendered readably | | | code, message, details |
| Resource: sdd://apps/{slug} | | | Cursor resource browsing lags Tools |
| Resource: sdd://features/{id} | | | |
| Resource: sdd://frameworks/{name} | | | |
| Resource: sdd://knowledge/{stable_id} | | | |
| Resource: sdd://knowledge/{stable_id}/v/{version} | | | |
| Prompt: sdd.specify ... sdd.learn as slash commands | | | never the only path |
| Workspace facts script | | | `docs/verification/workspace-facts.sh` |

## How to verify a row

1. Connect the host to a server seeded with `packs/` and the `checkout` app.
2. Perform the action from the host's chat.
3. Record the date, host version and any deviation in the Notes column.
