import { useState } from 'react';
import { getApps, getRouting, type RoutingParams } from '../api';
import { Badge, Empty, ErrorState, Loading, PageHead, Table, Time, useLoad } from '../ui';
import { typeBadge } from './badge';
import { RoutingDetail } from './RoutingDetail';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

export function Work({ app }: { app?: string | null }) {
  const apps = useLoad(getApps, []);
  const [draft, setDraft] = useState<RoutingParams>({ app: app ?? undefined });
  const [applied, setApplied] = useState<RoutingParams>({ app: app ?? undefined });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const routing = useLoad(() => getRouting(applied), [applied]);

  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to);
  const apply = (p: RoutingParams) => { setDraft(p); setApplied(p); };
  const globalApp = app !== undefined; // project chosen in the sidebar: hide the local picker

  if (routing.error) return <ErrorState message={`Could not load routed work: ${routing.error}`} onRetry={routing.reload} />;
  if (selectedId) return <RoutingDetail routingId={selectedId} onBack={() => setSelectedId(null)} />;

  const q = search.trim().toLowerCase();
  const events = routing.data?.events.filter((e) => !q || [e.task_description, e.external_ref ?? '', e.app_slug, e.framework, e.feature_slug ?? ''].some((v) => v.toLowerCase().includes(q)));

  return (
    <section>
      <PageHead title="Work" subtitle="Every task the orchestrator routed, and what became of it." />
      <div className="filters">
        {!globalApp && <div className="filter">
          <label htmlFor="work-app">App</label>
          <select id="work-app" value={draft.app ?? ''} onChange={(ev) => setDraft({ ...draft, app: ev.target.value || undefined })}>
            <option value="">All apps</option>
            {apps.data?.apps.map((a) => <option key={a.id} value={a.slug}>{a.slug}</option>)}
          </select>
        </div>}
        <div className="filter">
          <label htmlFor="work-from">From</label>
          <input id="work-from" type="date" value={draft.from ?? ''} onChange={(ev) => setDraft({ ...draft, from: ev.target.value || undefined })} />
        </div>
        <div className="filter">
          <label htmlFor="work-to">To</label>
          <input id="work-to" type="date" value={draft.to ?? ''} onChange={(ev) => setDraft({ ...draft, to: ev.target.value || undefined })} />
        </div>
        <button className="primary" onClick={() => setApplied(draft)} disabled={invalidRange}>Apply</button>
        <div className="chips" aria-label="Quick ranges">
          <button className="chip" onClick={() => apply({ ...draft, from: daysAgo(7), to: undefined })}>Last 7 days</button>
          <button className="chip" onClick={() => apply({ ...draft, from: daysAgo(30), to: undefined })}>Last 30 days</button>
          <button className="chip" onClick={() => apply({ app: draft.app })}>Any time</button>
        </div>
        {invalidRange && <span className="error">From must be on or before To.</span>}
      </div>
      {!events || !routing.data ? (
        <Loading />
      ) : routing.data.events.length === 0 ? (
        <Empty title="No routed work in this range." hint="Widen the dates or pick another app." />
      ) : (
        <div className="stack">
          <div className="tiles">
            {routing.data.summary.map((s) => (
              <div className="tile" key={s.intent}>
                <span className="tile-value">{s.count}</span>
                <span className="tile-label">{s.intent}</span>
              </div>
            ))}
          </div>
          <input className="search" type="search" placeholder="Search task, ticket, app…" aria-label="Search work" value={search} onChange={(e) => setSearch(e.target.value)} />
          {events.length === 0 ? <Empty title="Nothing matches your search." /> : (
            <Table>
              <thead>
                <tr><th>Last routed</th><th>App</th><th>Type</th><th>Ticket</th><th>Task</th><th>Framework</th><th>Feature</th><th className="num">Commits</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="row-link" tabIndex={0} onClick={() => setSelectedId(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setSelectedId(e.id); }}>
                    <td><Time iso={e.last_routed_at} /></td>
                    <td>{e.app_slug}</td>
                    <td><span className="badge badge-gray badge-plain">{typeBadge(e)}</span></td>
                    <td>{e.external_ref ?? '—'}</td>
                    <td className="cell-clip" title={e.task_description}>{e.task_description}</td>
                    <td>{e.framework === 'none' ? '—' : `${e.framework}${e.decision.track ? `:${e.decision.track}` : ''}`}</td>
                    <td>{e.feature_id ? <><Badge value={e.feature_status ?? ''} /> <span className="muted">{e.feature_phase}</span></> : '—'}</td>
                    <td className="num">{e.commit_count}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </section>
  );
}
