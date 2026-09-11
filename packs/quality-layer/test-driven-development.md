---
id: quality.tdd
title: Test-driven development
---
## The cycle

Write one failing test that names the behaviour, run it and read the failure, write the smallest change that makes it pass, run the suite, then refactor with the suite green. Commit after each green step.

## What to test

Test behaviour at the boundary the caller sees: inputs to outputs, errors to error codes. Do not assert on private state or on the order of internal calls.

## When the test will not fail

If a new test passes before the implementation exists, the test is wrong or the behaviour already exists. Fix the test before writing code.

## Legacy code

Before changing code without tests, write characterization tests that pin the current behaviour, including behaviour that looks wrong. Change behaviour only after the pins are green.
