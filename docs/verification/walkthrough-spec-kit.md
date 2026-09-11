# Walkthrough: one Spec Kit feature

Run in Claude Code and in Cursor. Record results in `feature-matrix.md`.

## Setup (once)

Same as the OpenSpec walkthrough, plus `npm run admin -- ingest packs/spec-kit --actor admin`.

## Steps

1. In a fresh repository (fewer than 20 commits, no spec library), ask:
   "Build a CLI that converts CSV to JSON. Use the sdd server."
2. Expect `route_task` with `is_greenfield: true` and the decision `spec-kit`
   / `default`, rule `11-greenfield-or-large`. If the agent omitted
   `estimated_files`, expect `confidence: "medium"` with clarifying
   questions; answer them and expect a second `route_task`.
3. Accept. Expect `start_feature` and a pack whose position 3 is the Spec Kit
   specification template.
4. Let the agent write `spec.md` with a vague success criterion ("fast").
   Expect a `measurable_criteria` blocker on advance. Fix it with a number and
   unit, approve, and expect `pass` with `plan` instructions.
5. Write `plan.md` and advance; write `tasks.md` with a dependency on a later
   task and expect a `task_ordering` blocker; fix and advance.
6. Move to verify. Move to integrate with evidence whose `files_changed`
   includes a file not listed in `plan.md`'s Project Structure. Expect
   `pass` with a `scope_drift` warning.
7. Move to learn, then archived. Ask the agent to propose an ADR; expect
   `propose_memory` and a pending proposal listed by
   `npm run admin -- proposals list`.
8. Run the `sdd.implement` prompt (slash command) on the archived feature;
   expect the implement pack and a new `context_packs` row with
   `created_by = prompt`.

## Pass criteria

As in the OpenSpec walkthrough.
