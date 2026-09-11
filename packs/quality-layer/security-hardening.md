---
id: quality.security-hardening
title: Security hardening
---
## Input at the boundary

Validate every input at the boundary with a schema, reject what does not match, and never build queries, shell commands or file paths from unvalidated strings.

## Secrets and tokens

Read secrets from the environment or the secret manager. Never log them, never return them in tool results, and rotate any secret that appears in a diff.

## Dependencies

Run the dependency scanner in CI. A new high severity finding blocks the merge unless the scan is explicitly skipped with a written reason.

## Least privilege

Service accounts get the minimum role for the task. Network services bind to a private interface unless they are meant to be public.
