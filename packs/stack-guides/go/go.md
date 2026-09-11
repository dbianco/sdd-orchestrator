---
id: stack.go.guide
title: Go engineering guide
stack_tags: [go, golang]
---
## Errors

Return errors, do not panic. Wrap with `%w` and context about what was attempted. Check errors at every call site; never discard with `_` outside tests.

## Concurrency

Every goroutine has an owner that knows when it ends. Pass `context.Context` as the first argument and honour cancellation. Protect shared state with a mutex or a channel, never both.

## Packages

Small packages with one responsibility. No `util` packages. Exported identifiers have doc comments starting with the identifier name.

## Testing

Table-driven tests with `t.Run` sub-tests. Use `testing.TB` helpers for setup. Race detector runs in CI.

## Tooling

`gofmt`, `go vet` and `staticcheck` are clean before review. Dependencies are pinned in `go.mod` and tidied.
