# `sdd` plugin for Claude Code

Connects Claude Code to an SDD Orchestrator server and enforces its lifecycle
in the editor:

- the `sdd` MCP server, reached at `$SDD_URL/mcp` with `Authorization: Bearer $SDD_TOKEN`;
- hooks that block code edits until the task is routed and its feature is in
  `implement`, keep `.sdd/state.json` in step with server responses, and ask
  for `record_commit` after each commit;
- the `sdd-workflow` skill with the session flow, and the `/sdd:status` and
  `/sdd:route` commands.

## Install

```bash
export SDD_URL=http://sdd.internal:8080
export SDD_TOKEN=sdd_...            # sdd-admin token create --for <you> --scope host,approver --name <where>
claude plugin marketplace add dbianco/sdd-orchestrator
claude plugin install sdd@sdd-orchestrator
```

The hooks are Node scripts: Node 18 or later must be on `PATH`.

In each repository, commit `.sdd/config.json` and ignore the state file:

```json
{ "app": "checkout", "enforcement": "block" }
```

```gitignore
.sdd/state.json
```

`enforcement` is `block` (default), `warn` (explain instead of refusing) or
`off`. A repository without `.sdd/config.json` is not affected.

## What the hooks allow

| Branch state | Edits allowed |
|---|---|
| Nothing routed | Spec libraries (`openspec/`, `specs/`, `.specify/`, `_bmad-output/`, `.kiro/specs/`, `.sdlc/`) and Markdown under `docs/` |
| Trivial or spike routing | Everything |
| Feature in specify, plan or tasks | Spec libraries and `docs/` Markdown |
| Feature in implement, verify, integrate or learn | Everything |
| Feature blocked or waiting for approval | Spec libraries and `docs/` Markdown |
| Always | Nothing under `.sdd/` |

Shell commands are checked for writes into `.sdd/` and for plain `>`, `>>`
and `tee` redirections; other ways of writing files from the shell are not
detected. The hooks bind the agent, not people; the server's tokens,
approvals and CI evidence apply to every client.
