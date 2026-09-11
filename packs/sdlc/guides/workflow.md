---
id: sdlc.guide.workflow
title: sdlc house flow overview
---
## Artifacts

PRD and scoping doc in specify; jot down (a short technical design note) in plan; task breakdown in tasks; implement-task covers implement and verify; the pull request is integrate; the retrospective is learn.

## Traceability

Requirements are numbered Rn in the PRD. Tasks reference them with `(AC: Rn)`. Verify evidence lists them in `implements`.

## Stores

The plugin keeps artifacts in a local or remote artifact store (Notion or the repository). This server keeps only the text submitted at each gate; the artifact store stays the source for the documents themselves.
