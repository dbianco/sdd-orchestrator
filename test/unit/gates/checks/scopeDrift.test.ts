import { describe, it, expect } from 'vitest';
import { scopeDrift } from '../../../../src/gates/checks/scopeDrift.js';
import type { CheckInput } from '../../../../src/gates/types.js';

const plan = '## Files\n- `src/api/export.ts`\n- src/api/export.test.ts\n- docs/notes.md';
function run(files: string[], artifacts: Record<string, string> = { 'plan.md': plan }) {
  const input: CheckInput = { artifacts, declaredArtifacts: [], evidence: { files_changed: files }, human_approved: false, params: { plan_artifact: 'plan.md', files_section: 'Files' }, severity: 'warning' };
  return scopeDrift.run(input);
}

describe('scope_drift', () => {
  it('extracts backticked and bare paths and warns on unknown files', () => {
    const f = run(['src/api/export.ts', 'src/api/export.test.ts', 'src/other.ts']);
    expect(f).toEqual([{ check: 'scope_drift', severity: 'warning', location: 'src/other.ts', message: 'src/other.ts is not listed in plan.md section "Files"' }]);
  });
  it('defaults to warning severity', () => {
    expect(scopeDrift.defaultSeverity).toBe('warning');
  });
  it('is silent without files_changed or without the plan artifact', () => {
    expect(run([])).toEqual([]);
    expect(run(['x.ts'], {})).toEqual([]);
  });
});
