import type { RequirementStatus, RtmRow } from '../types';
import { Badge, Empty, ExportCsv, SortTh, Table, useSort } from '../ui';

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
  const { sorted, sort, toggle } = useSort(rows, {
    feature: (r) => r.slug, ticket: (r) => r.external_ref, req: (r) => r.req_id, coverage: (r) => coverageLabel(r.covered), tests: (r) => r.tests_passed, evidence: (r) => r.evidence_source, approver: (r) => r.spec_approved_by,
  });
  if (rows.length === 0) return <Empty title="No requirements captured in this app yet" />;
  const covered = rows.filter((r) => r.covered).length;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted">{covered} of {rows.length} requirements covered by evidence.</p>
        <ExportCsv filename="traceability.csv" headers={['feature', 'ticket', 'requirement', 'coverage', 'tests_passed', 'tests_failed', 'evidence', 'spec_approved_by', 'verify_approved_by']}
          rows={sorted.map((r) => [r.slug, r.external_ref, r.req_id, coverageLabel(r.covered), r.tests_passed, r.tests_failed, r.evidence_source, r.spec_approved_by, r.verify_approved_by])} />
      </div>
      <Table>
        <thead><tr>
          <SortTh id="feature" label="Feature" sort={sort} onSort={toggle} /><SortTh id="ticket" label="Ticket" sort={sort} onSort={toggle} /><SortTh id="req" label="Requirement" sort={sort} onSort={toggle} />
          <SortTh id="coverage" label="Coverage" sort={sort} onSort={toggle} /><SortTh id="tests" label="Tests" sort={sort} onSort={toggle} /><SortTh id="evidence" label="Evidence" sort={sort} onSort={toggle} /><SortTh id="approver" label="Spec approved by" sort={sort} onSort={toggle} />
        </tr></thead>
        <tbody>
          {sorted.map((r) => (
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
