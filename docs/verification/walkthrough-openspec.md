# Walkthrough: one OpenSpec feature

Run in Claude Code and in Cursor. Record results in `feature-matrix.md`.

## Setup (once)

```bash
docker compose up -d
npm run admin -- app register checkout --name "Checkout" --actor admin
npm run admin -- app update checkout --stack typescript,react
for p in company quality-layer stack-guides/react openspec; do npm run admin -- ingest packs/$p --actor admin; done
```

## Steps

1. In a brownfield repository with an `openspec/` directory, ask the agent:
   "Add CSV export to the orders page. Use the sdd server."
2. Expect a `route_task` call with `is_greenfield: false`,
   `has_spec_library: true` and an `estimated_files` estimate. Expect the
   decision `openspec` / `default`, rule `10-brownfield-small-medium`.
3. Accept. Expect `start_feature` and a context pack whose position 3 is the
   OpenSpec proposal template and whose position 6 lists `proposal.md`,
   `spec.md`, `tasks.md` as the next gate's artifacts.
4. Let the agent write the three artifacts. Leave one `TBD` in
   `proposal.md`. Ask it to advance. Expect `result: "fail"` with a
   `placeholder_scan` finding naming the line, and no phase change.
5. Fix the placeholder. Say "I approve the proposal." Expect `advance_phase`
   with `human_approved: true`, `result: "pass"`, and next instructions for
   `implement (apply)`.
6. Move to verify, then ask the agent to move to integrate with test, lint
   and security results. Expect a `verify_evidence` pass and, if the scan was
   skipped, a warning finding.
7. Move to archived. Call `get_feature_status`: five transitions, status
   `archived`, one pack id under `specify`.
8. Ask "what did ADR-7 decide?" Expect `search_memory` with an exact-id hit
   if such an item exists, or an empty result without an error.

## Pass criteria

Every step produces the expected tool call and result shape. Every error the
host shows is readable as code and message.
