---
id: quality.systematic-debugging
title: Systematic debugging
---
## Reproduce first

Turn the report into a failing test or a deterministic script before changing code. If it cannot be reproduced, gather logs and metrics until it can.

## One hypothesis at a time

State what you think is wrong, make the smallest change that would confirm or refute it, and record the result. Do not stack speculative fixes.

## Three failed attempts

After three fix attempts that did not resolve the failure, stop and hand the problem to a human with the reproduction, the hypotheses tried and their results.

## Regression test

Every fix ships with the test that would have caught it.
