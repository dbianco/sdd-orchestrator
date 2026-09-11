---
id: quality.code-review
title: Code review
---
## Read the spec first

A review checks the change against the accepted spec and plan. Scope that is not in the plan is a finding, even when the code is good.

## Order of concerns

Correctness, then security, then data integrity, then operability (logs, metrics, timeouts), then readability. Style comes last and is usually automated.

## Evidence over assertion

Ask for the test that proves the fix. A description of manual testing is not evidence; a test command and its output are.

## Findings

Each finding names the file and line, states what is wrong, and says whether it blocks the merge. Suggestions that do not block are marked as such.
