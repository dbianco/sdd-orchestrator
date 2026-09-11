---
id: stack.node.guide
title: Node.js engineering guide
stack_tags: [node, typescript, javascript]
---
## Runtime and modules

Target the active LTS. ESM only, with explicit `.js` extensions in relative imports. Strict TypeScript with `noUncheckedIndexedAccess`.

## Async and errors

Every promise is awaited or explicitly handled. Errors are typed objects with a stable code, not strings. Unhandled rejections crash the process so the supervisor restarts it.

## I/O and streams

Stream anything that can exceed 10 MB. Set timeouts on every outbound request and every database query. Close pools and servers on SIGTERM.

## Configuration

Read configuration from the environment once at startup, validate it with a schema, and fail fast with a message naming the variable.

## Testing

Unit tests need no network or database. Integration tests run against a real database in Docker and truncate between tests.
