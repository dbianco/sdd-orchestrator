---
id: spec-kit.template.tasks
phases: [tasks]
title: Spec Kit tasks template
---
## Tasks

- [ ] T001 <setup task> in `path/to/file`
- [ ] T002 <test task>, depends on T001
- [ ] T003 <implementation task>, depends on T002

Tasks are ordered so every dependency appears earlier. Mark tasks that can run in parallel with [P].

Write dependencies as "depends on T001"; several can be listed as "depends on T001, T002". Every id must appear earlier in the list. Ticked tasks (`- [x]`) count the same as open ones.

Mention the requirement a task implements by its id (for example `FR-001`). Every requirement from the spec should be mentioned by at least one task, and ids that are not in the spec are flagged.

