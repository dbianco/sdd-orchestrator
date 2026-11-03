// Plain-language remediation for each gate check, shown next to findings in the admin UI.
export interface CheckHint { title: string; fix: string }

export const CHECK_HINTS: Record<string, CheckHint> = {
  missing_artifact: { title: 'Artifact not submitted', fix: 'Write the named file and pass its content in the artifacts argument of advance_phase.' },
  required_sections: { title: 'Required section missing or empty', fix: 'Add the section with the exact heading the template uses and put real content under it.' },
  placeholder_scan: { title: 'Placeholder text left in', fix: 'Replace TODO / TBD / lorem-style markers with the real decision or remove the line.' },
  requirement_ids: { title: 'Requirement ids missing or duplicated', fix: 'Give every requirement a unique id in the format your framework uses (FR-001, R1, ...), and list at least the minimum number.' },
  measurable_criteria: { title: 'Criterion has no threshold', fix: 'Rewrite the criterion with a measurable limit, for example "responds in under 200 ms" instead of "is fast".' },
  delta_markers: { title: 'Delta spec lacks ADDED / MODIFIED / REMOVED', fix: 'Group changes under ADDED, MODIFIED or REMOVED Requirements; removals must say why.' },
  task_ordering: { title: 'Task depends on a later task', fix: 'Reorder the tasks, or fix the dependency, so each task only depends on earlier ones.' },
  task_done_checks: { title: 'Task has no done check', fix: 'Add a concrete done check (a command to run or an observable result) to the task.' },
  scope_drift: { title: 'Changed file not in the plan', fix: 'Either add the file to the plan\'s files section or revert the change if it is out of scope.' },
  verify_evidence: { title: 'Verification evidence incomplete', fix: 'Run the tests and pass evidence with tests.passed, tests.failed, files_changed and implements; failing tests block the move.' },
  requirement_coverage: { title: 'Requirement not covered by evidence', fix: 'Add the requirement id to evidence.implements once code and tests cover it, or move the requirement out of scope with a spec change.' },
  human_approved: { title: 'Human approval required', fix: 'Ask a reviewer to approve the request in the admin UI (Approvals) or with sdd-admin approvals approve.' },
};

export function hintFor(check: string): CheckHint | null {
  return CHECK_HINTS[check] ?? null;
}
