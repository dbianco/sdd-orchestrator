import { useEffect, useState } from 'react';
import { getGateHints, getWeek } from '../api';
import type { CheckHint } from '../types';
import { Badge, Empty, ErrorState, formatHours, Loading, PageHead, Time, useLoad } from '../ui';

export function MyWeek({ app }: { app?: string | null }) {
  const [actor, setActor] = useState<string | undefined>(undefined);
  const [days, setDays] = useState(7);
  const { data, error, reload } = useLoad(() => getWeek({ app, actor, days }), [app, actor, days]);
  const [hints, setHints] = useState<Record<string, CheckHint>>({});
  useEffect(() => { let live = true; getGateHints().then((h) => { if (live) setHints(h); }); return () => { live = false; }; }, []);

  if (error) return <ErrorState message={`Could not load your activity: ${error}`} onRetry={reload} />;
  if (!data) return <Loading />;

  const caughtTotal = data.caught.reduce((s, c) => s + c.count, 0);
  const idle = data.transitions.passed + data.transitions.failed + data.shipped.length + data.approvals.decided + data.approvals.requested === 0;
  const people = [...new Set([data.actor, ...data.actors])];

  return (
    <section className="stack">
      <PageHead
        title="My week"
        subtitle="What you moved through the flow, and the problems the gates caught before they reached review."
        actions={
          <>
            <label className="filter">Person
              <select value={data.actor} onChange={(e) => setActor(e.target.value)}>
                {people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div className="chips" role="group" aria-label="Period">
              {[7, 30].map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{`Last ${d} days`}</button>)}
            </div>
          </>
        }
      />
      {idle ? (
        <Empty title={`Nothing recorded for ${data.actor} in the last ${data.days} days.`} hint="Route a task and move a feature through a phase, or pick someone else above." />
      ) : (
        <>
          <div className="tiles tiles-sentence">
            <div className="tile tone-green"><span className="tile-value">{data.transitions.passed}</span><span className="tile-label">phase moves passed</span></div>
            <div className="tile tone-amber"><span className="tile-value">{caughtTotal}</span><span className="tile-label">problems caught early</span></div>
            <div className="tile tone-blue"><span className="tile-value">{data.shipped.length}</span><span className="tile-label">features shipped</span></div>
            <div className="tile"><span className="tile-value">{data.approvals.decided}</span><span className="tile-label">approvals decided</span></div>
          </div>
          <div className="grid">
            <div className="card">
              <h3>Caught before review</h3>
              {data.caught.length === 0 ? <p className="muted">No gate blockers. Clean run.</p> : (
                <ul className="findings" style={{ listStyle: 'none', paddingLeft: 0 }}>
                  {data.caught.map((c) => (
                    <li key={c.check}>
                      <strong>{hints[c.check]?.title ?? c.check}</strong> <span className="muted">×{c.count}</span>
                      {c.example && <div className="sub">e.g. {c.example}</div>}
                      {hints[c.check] && <div className="hint">{hints[c.check]!.fix}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="sub">Each of these was fixed in the editor instead of coming back as review feedback.</p>
            </div>
            <div className="card">
              <h3>Shipped</h3>
              {data.shipped.length === 0 ? <p className="muted">Nothing archived in this period.</p> : (
                <ul className="apps-list">{data.shipped.map((s) => <li key={s.feature_id}><strong>{s.slug}</strong> <span className="muted"><Time iso={s.at} /></span></li>)}</ul>
              )}
              <h4>In progress</h4>
              {data.worked_on.filter((w) => w.status !== 'archived').length === 0 ? <p className="muted">Nothing open.</p> : (
                <ul className="apps-list">
                  {data.worked_on.filter((w) => w.status !== 'archived').map((w) => (
                    <li key={w.feature_id} className="row" style={{ justifyContent: 'space-between' }}><span>{w.slug}</span><span><Badge value={w.status} /> <span className="muted">{w.current_phase}</span></span></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h3>Approvals</h3>
              <p>You decided <strong>{data.approvals.decided}</strong> ({data.approvals.approved} approved, {data.approvals.rejected} rejected).</p>
              <p>You requested <strong>{data.approvals.requested}</strong>{data.approvals.avg_wait_hours !== null && <>; they waited {formatHours(data.approvals.avg_wait_hours)} on average</>}.</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
