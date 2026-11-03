import { useState } from 'react';
import { getRoutingDetail } from '../api';
import type { Commit } from '../types';
import { BackButton, Badge, ErrorState, Loading, Table, Time, useLoad } from '../ui';
import { typeBadge } from './badge';
import { FeatureDetail } from './FeatureDetail';

function CommitRow({ c }: { c: Commit }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td><code>{c.sha.slice(0, 7)}</code></td>
        <td>{c.branch ?? '—'}</td>
        <td>{c.message.split('\n')[0]}</td>
        <td>{c.committed_at ? <Time iso={c.committed_at} /> : '—'}</td>
        <td><button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{c.files_changed.length} file(s)</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <ul className="mono">{c.files_changed.map((f) => <li key={f}>{f}</li>)}</ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function RoutingDetail({ routingId, onBack }: { routingId: string; onBack: () => void }) {
  const { data, error, reload } = useLoad(() => getRoutingDetail(routingId), [routingId]);
  const [showFeature, setShowFeature] = useState(false);

  if (showFeature && data?.event.feature_id) {
    return <FeatureDetail featureId={data.event.feature_id} onBack={() => setShowFeature(false)} />;
  }

  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      {error && <ErrorState message={`Could not load routing ${routingId}: ${error}`} onRetry={reload} />}
      {!error && !data && <Loading />}
      {data && (
        <>
          <div className="card">
            <h3 style={{ fontSize: '1.15rem' }}>{data.event.task_description}</h3>
            <div className="row">
              <span className="badge badge-blue badge-plain">{typeBadge(data.event)}</span>
              <span>{data.event.app_slug}</span>
              <span className="muted">· {data.event.external_ref ?? 'no ticket'}</span>
            </div>
            <dl className="kv" style={{ marginTop: '0.75rem' }}>
              <dt>Routed</dt>
              <dd>{data.event.route_count} time(s) · first <Time iso={data.event.first_routed_at} />, last <Time iso={data.event.last_routed_at} /></dd>
              {data.event.feature_id && (
                <>
                  <dt>Feature</dt>
                  <dd><button className="link" onClick={() => setShowFeature(true)}>{data.event.feature_slug}</button>{' '}<Badge value={data.event.feature_status ?? ''} /> <span className="muted">{data.event.feature_phase}</span></dd>
                </>
              )}
            </dl>
          </div>
          <div className="card">
            <h3>Decision</h3>
            <p>{data.event.framework === 'none' ? 'no framework' : `${data.event.framework}${data.event.decision.track ? `:${data.event.decision.track}` : ''}`} · rule <code>{data.event.decision.rule}</code></p>
            <ul>{data.event.decision.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
          {data.event.workspace?.paths_touched && data.event.workspace.paths_touched.length > 0 && (
            <div className="card">
              <h3>Paths touched</h3>
              <ul className="mono">{data.event.workspace.paths_touched.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <h4 style={{ margin: 0 }}>Commits</h4>
          {data.commits.length === 0 ? (
            <p className="muted">No commits reported yet.</p>
          ) : (
            <Table>
              <thead><tr><th>Sha</th><th>Branch</th><th>Message</th><th>Date</th><th>Files</th></tr></thead>
              <tbody>{data.commits.map((c) => <CommitRow key={c.id} c={c} />)}</tbody>
            </Table>
          )}
        </>
      )}
    </section>
  );
}
