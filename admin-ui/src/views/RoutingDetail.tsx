import { useEffect, useState } from 'react';
import { getRoutingDetail } from '../api';
import type { Commit, RoutingEvent } from '../types';
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
        <td>{c.committed_at ? c.committed_at.slice(0, 10) : '—'}</td>
        <td><button className="link" onClick={() => setOpen(!open)}>{c.files_changed.length} file(s)</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <ul>{c.files_changed.map((f) => <li key={f}>{f}</li>)}</ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function RoutingDetail({ routingId, onBack }: { routingId: string; onBack: () => void }) {
  const [data, setData] = useState<{ event: RoutingEvent; commits: Commit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFeature, setShowFeature] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    getRoutingDetail(routingId).then(setData).catch((e: Error) => setError(e.message));
  }, [routingId]);

  if (showFeature && data?.event.feature_id) {
    return <FeatureDetail featureId={data.event.feature_id} onBack={() => setShowFeature(false)} />;
  }

  return (
    <section>
      <button className="link" onClick={onBack}>&larr; Back</button>
      {error && <p className="error">Could not load routing {routingId}: {error}</p>}
      {!error && !data && <p>Loading…</p>}
      {data && (
        <>
          <h3>{data.event.task_description}</h3>
          <p>
            <span className="badge">{typeBadge(data.event)}</span>{' '}
            {data.event.app_slug} · {data.event.external_ref ?? 'no ticket'} · routed {data.event.route_count} time(s), first {data.event.first_routed_at.slice(0, 10)}, last {data.event.last_routed_at.slice(0, 10)}
          </p>
          {data.event.feature_id && (
            <p>
              Feature: <button className="link" onClick={() => setShowFeature(true)}>{data.event.feature_slug}</button> — {data.event.feature_status} · {data.event.feature_phase}
            </p>
          )}
          <h4>Decision</h4>
          <p>{data.event.framework === 'none' ? 'no framework' : `${data.event.framework}${data.event.decision.track ? `:${data.event.decision.track}` : ''}`} · rule {data.event.decision.rule}</p>
          <ul>{data.event.decision.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {data.event.workspace?.paths_touched && data.event.workspace.paths_touched.length > 0 && (
            <>
              <h4>Paths touched</h4>
              <ul>{data.event.workspace.paths_touched.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
          <h4>Commits</h4>
          {data.commits.length === 0 ? (
            <p>No commits reported yet.</p>
          ) : (
            <table>
              <thead><tr><th>Sha</th><th>Branch</th><th>Message</th><th>Date</th><th>Files</th></tr></thead>
              <tbody>{data.commits.map((c) => <CommitRow key={c.id} c={c} />)}</tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
