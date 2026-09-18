import { useEffect, useState } from 'react';
import { getApps, getRouting, type RoutingParams } from '../api';
import type { AppSummary, RoutingEvent, RoutingSummary } from '../types';
import { typeBadge } from './badge';

export function Work() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [draft, setDraft] = useState<RoutingParams>({});
  const [applied, setApplied] = useState<RoutingParams>({});
  const [events, setEvents] = useState<RoutingEvent[] | null>(null);
  const [summary, setSummary] = useState<RoutingSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getApps().then((r) => setApps(r.apps)).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setEvents(null);
    getRouting(applied).then((r) => { setEvents(r.events); setSummary(r.summary); }).catch((e: Error) => setError(e.message));
  }, [applied]);

  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);

  if (error) return <p className="error">Could not load routed work: {error}</p>;

  if (selectedId) {
    return (
      <section>
        <button className="link" onClick={() => setSelectedId(null)}>&larr; Back</button>
        <p>Routing detail coming soon.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Work</h2>
      <div className="filters">
        <div className="filter">
          <label htmlFor="work-app">App</label>
          <select id="work-app" value={draft.app ?? ''} onChange={(ev) => setDraft({ ...draft, app: ev.target.value || undefined })}>
            <option value="">All apps</option>
            {apps.map((a) => <option key={a.id} value={a.slug}>{a.slug}</option>)}
          </select>
        </div>
        <div className="filter">
          <label htmlFor="work-from">From</label>
          <input id="work-from" type="date" value={draft.from ?? ''} onChange={(ev) => setDraft({ ...draft, from: ev.target.value || undefined })} />
        </div>
        <div className="filter">
          <label htmlFor="work-to">To</label>
          <input id="work-to" type="date" value={draft.to ?? ''} onChange={(ev) => setDraft({ ...draft, to: ev.target.value || undefined })} />
        </div>
        <button onClick={() => setApplied(draft)} disabled={invalidRange}>Apply</button>
        {invalidRange && <span className="error">From must be on or before To.</span>}
      </div>
      {!events ? (
        <p>Loading…</p>
      ) : events.length === 0 ? (
        <p>No routed work in this range.</p>
      ) : (
        <>
          <div className="tiles">
            {summary.map((s) => (
              <div className="tile" key={s.intent}>
                <span className="tile-value">{s.count}</span>
                <span className="tile-label">{s.intent}</span>
              </div>
            ))}
          </div>
          <table>
            <thead>
              <tr><th>Last routed</th><th>App</th><th>Type</th><th>Ticket</th><th>Task</th><th>Framework</th><th>Feature</th><th>Commits</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="row-link" onClick={() => setSelectedId(e.id)}>
                  <td>{e.last_routed_at.slice(0, 10)}</td>
                  <td>{e.app_slug}</td>
                  <td><span className="badge">{typeBadge(e)}</span></td>
                  <td>{e.external_ref ?? '—'}</td>
                  <td>{e.task_description.length > 80 ? `${e.task_description.slice(0, 80)}…` : e.task_description}</td>
                  <td>{e.framework === 'none' ? '—' : `${e.framework}${e.decision.track ? `:${e.decision.track}` : ''}`}</td>
                  <td>{e.feature_id ? `${e.feature_status} · ${e.feature_phase}` : '—'}</td>
                  <td>{e.commit_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
