import type { RequirementStatus, RtmRow } from '../types';
import { Badge, Empty, Table } from '../ui';

export function coverageLabel(covered: boolean | null): string {
  return covered === null ? 'pending' : covered ? 'covered' : 'uncovered';
}

export function RequirementList({ requirements }: { requirements: RequirementStatus[] }) {
  if (requirements.length === 0) return <p className="muted">No requirements captured.</p>;
  return (
    <ul className="requirements">
      {requirements.map((r) => (
        <li key={r.id}>
          <span className="mono">{r.id}</span> <Badge value={coverageLabel(r.covered)} />
        </li>
      ))}
    </ul>
  );
}

export function RtmTable({ rows, onOpenFeature }: { rows: RtmRow[]; onOpenFeature: (featureId: string) => void }) {
  if (rows.length === 0) return <Empty title="No requirements captured in this app yet" />;
  const covered = rows.filter((r) => r.covered).length;
  return (
    <>
      <p className="muted">{covered} of {rows.length} requirements covered by evidence.</p>
      <Table>
        <thead><tr><th>Feature</th><th>Ticket</th><th>Requirement</th><th>Coverage</th><th>Tests</th><th>Evidence</th><th>Spec approved by</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.feature_id}:${r.req_id}`}>
              <td><button className="link" onClick={() => onOpenFeature(r.feature_id)}>{r.slug}</button></td>
              <td>{r.external_ref ?? '—'}</td>
              <td className="mono">{r.req_id}</td>
              <td><Badge value={coverageLabel(r.covered)} /></td>
              <td>{r.tests_passed === null ? '—' : `${r.tests_passed} passed, ${r.tests_failed ?? 0} failed`}</td>
              <td>{r.evidence_source ?? '—'}</td>
              <td>{r.spec_approved_by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
