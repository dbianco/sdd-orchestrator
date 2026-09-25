import type { RequirementStatus, RtmRow } from '../types';

export function coverageLabel(covered: boolean | null): string {
  return covered === null ? 'pending' : covered ? 'covered' : 'uncovered';
}

export function RequirementList({ requirements }: { requirements: RequirementStatus[] }) {
  if (requirements.length === 0) return <p>No requirements captured.</p>;
  return (
    <ul className="requirements">
      {requirements.map((r) => (
        <li key={r.id}>
          {r.id} <span className={`badge badge-${coverageLabel(r.covered)}`}>{coverageLabel(r.covered)}</span>
        </li>
      ))}
    </ul>
  );
}

export function RtmTable({ rows, onOpenFeature }: { rows: RtmRow[]; onOpenFeature: (featureId: string) => void }) {
  if (rows.length === 0) return <p>No requirements captured in this app yet.</p>;
  return (
    <table>
      <thead><tr><th>Feature</th><th>Ticket</th><th>Requirement</th><th>Coverage</th><th>Tests</th><th>Evidence</th><th>Spec approved by</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.feature_id}:${r.req_id}`}>
            <td><button className="link" onClick={() => onOpenFeature(r.feature_id)}>{r.slug}</button></td>
            <td>{r.external_ref ?? '—'}</td>
            <td>{r.req_id}</td>
            <td><span className={`badge badge-${coverageLabel(r.covered)}`}>{coverageLabel(r.covered)}</span></td>
            <td>{r.tests_passed === null ? '—' : `${r.tests_passed} passed, ${r.tests_failed ?? 0} failed`}</td>
            <td>{r.evidence_source ?? '—'}</td>
            <td>{r.spec_approved_by ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
