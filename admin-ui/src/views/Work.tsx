import { useState } from 'react';
import { getApps, getRouting, type RoutingParams } from '../api';
import { Badge, Empty, ErrorState, ExportCsv, Loading, PageHead, SortTh, Table, Time, useLoad, useSort } from '../ui';
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

  const q = search.trim().toLowerCase();
  const filtered = routing.data?.events.filter((e) => !q || [e.task_description, e.external_ref ?? '', e.app_slug, e.framework, e.feature_slug ?? ''].some((v) => v.toLowerCase().includes(q)));

  const fw = (e: { framework: string; decision: { track: string | null } }) => (e.framework === 'none' ? '' : `${e.framework}${e.decision.track ? `:${e.decision.track}` : ''}`);
  const { sorted: events, sort, toggle } = useSort(filtered ?? [], {
    routed: (e) => e.last_routed_at, app: (e) => e.app_slug, type: (e) => typeBadge(e), ticket: (e) => e.external_ref, task: (e) => e.task_description, framework: (e) => fw(e), feature: (e) => e.feature_status, commits: (e) => e.commit_count,
  }, { key: 'routed', dir: 'desc' });

  if (routing.error) return <ErrorState message={`Could not load routed work: ${routing.error}`} onRetry={routing.reload} />;
  if (selectedId) return <RoutingDetail routingId={selectedId} onBack={() => setSelectedId(null)} />;

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
      {!filtered || !routing.data ? (
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
          <div className="row">
            <input className="search" type="search" placeholder="Search task, ticket, app…" aria-label="Search work" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ExportCsv filename="work.csv" headers={['last_routed', 'app', 'type', 'ticket', 'task', 'framework', 'feature_status', 'feature_phase', 'commits']}
              rows={events.map((e) => [e.last_routed_at, e.app_slug, typeBadge(e), e.external_ref, e.task_description, fw(e), e.feature_status, e.feature_phase, e.commit_count])} />
          </div>
          {events.length === 0 ? <Empty title="Nothing matches your search." /> : (
            <Table>
              <thead>
                <tr>
                  <SortTh id="routed" label="Last routed" sort={sort} onSort={toggle} /><SortTh id="app" label="App" sort={sort} onSort={toggle} /><SortTh id="type" label="Type" sort={sort} onSort={toggle} />
                  <SortTh id="ticket" label="Ticket" sort={sort} onSort={toggle} /><SortTh id="task" label="Task" sort={sort} onSort={toggle} /><SortTh id="framework" label="Framework" sort={sort} onSort={toggle} />
                  <SortTh id="feature" label="Feature" sort={sort} onSort={toggle} /><SortTh id="commits" label="Commits" className="num" sort={sort} onSort={toggle} />
                </tr>
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
