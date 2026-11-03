---
id: sdlc.template.tasks
phases: [tasks]
title: sdlc task breakdown template
---
## Tasks

- [ ] T1 <task> in `path/to/file` (AC: R1)
- [ ] T2 <task>, depends on T1 (AC: R2)

Each task names the requirement it satisfies with `(AC: Rn)` and its dependencies with "depends on Tn". List several as "depends on T1, T2" or "depends on T1 and T3"; every id must appear earlier in the list. Ticked tasks (`- [x]`) count the same as open ones, so you can keep the file up to date as work progresses.
