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
