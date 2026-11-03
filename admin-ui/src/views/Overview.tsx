import { getCycle, getMetrics, getOverview, getRightSizing } from '../api';
import type { CycleMetrics, RightSizing } from '../types';
import { Badge, Empty, ErrorState, formatHours, Loading, PageHead, SplitBar, Table, toneOf, useLoad } from '../ui';

const PHASE_ORDER = ['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn'];
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

/** Time per phase and track, spec vs build: shows what the process costs, with rework as the price of failed gates. */
function CycleCard({ cycle }: { cycle: CycleMetrics }) {
  const phases = PHASE_ORDER.filter((p) => cycle.phase_median_hours[p] !== undefined);
  const max = Math.max(1, ...phases.map((p) => cycle.phase_median_hours[p]!));
  const specShare = cycle.spec_share;
  return (
    <div className="card">
      <h3>Where does the time go?</h3>
      <div className="metric-row">
        <div className="metric"><strong>{formatHours(cycle.median_cycle_hours)}</strong><span>median time from start to archived ({cycle.archived} finished)</span></div>
        <div className="metric"><strong>{formatHours(cycle.median_spec_hours)}</strong><span>median in specify, plan and tasks</span></div>
        <div className="metric"><strong>{formatHours(cycle.median_build_hours)}</strong><span>median building and verifying</span></div>
        <div className="metric"><strong>{pct(specShare)}</strong><span>of active time goes to the spec</span></div>
      </div>
      {specShare !== null && (
        <div style={{ marginTop: '0.75rem' }}>
          <SplitBar parts={[{ label: 'Spec phases', value: Math.round(specShare * 100), tone: 'blue' }, { label: 'Build phases', value: Math.round((1 - specShare) * 100), tone: 'green' }]} />
        </div>
      )}
      <h4>Median time per phase</h4>
      {phases.map((p) => (
        <div className="hbar" key={p}>
          <span className="name">{p}</span>
          <span className="track"><span className="fill" style={{ display: 'block', width: `${(cycle.phase_median_hours[p]! / max) * 100}%` }} /></span>
          <span className="num">{formatHours(cycle.phase_median_hours[p])}</span>
        </div>
      ))}
      <h4>By track</h4>
      <Table>
        <thead><tr><th>Track</th><th className="num">Features</th><th className="num">Median cycle</th><th className="num">Spec share</th><th className="num">Failed gate attempts / feature</th></tr></thead>
        <tbody>
          {cycle.by_track.map((t) => (
            <tr key={`${t.framework}:${t.track}`}>
              <td>{t.framework}{t.track ? <span className="muted">:{t.track}</span> : null}</td>
              <td className="num">{t.features}</td><td className="num">{formatHours(t.median_cycle_hours)}</td><td className="num">{pct(t.spec_share)}</td><td className="num">{t.avg_failed_attempts}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="sub">
        {cycle.rework.features_with_rework === 0
          ? 'No feature needed rework after a failed gate.'
          : `${cycle.rework.features_with_rework} feature(s) went through rework: a median of ${formatHours(cycle.rework.median_rework_hours)} passed between the first failed gate and the pass.`}
        {cycle.rework.backward_moves > 0 ? ` ${cycle.rework.backward_moves} backward move(s) sent a feature back to an earlier phase, usually a spec amendment after learning something while building.` : ''}
        {' '}A high spec share on small changes is a hint to use the light path for that kind of work.
      </p>
    </div>
  );
}

/** Small changes that went through a full spec track: a hint to use the light path for that kind of work. */
function RightSizingCard({ sizing }: { sizing: RightSizing }) {
  return (
    <div className="card">
      <h3>Right-sizing the process</h3>
      <p>
        <strong>{sizing.tiny} of {sizing.archived_full_track}</strong> finished full-track features ({pct(sizing.share)}) were tiny changes:
        {` ${sizing.thresholds.max_files} files or fewer and ${sizing.thresholds.max_requirements} requirements or fewer. `}
        Similar work can be routed with <code>workspace.intent: "trivial"</code> to get the light pack without spec phases.
      </p>
      <Table>
        <thead><tr><th>Feature</th><th>Track</th><th className="num">Files</th><th className="num">Requirements</th><th className="num">Time to archive</th></tr></thead>
        <tbody>
          {sizing.entries.map((e) => (
            <tr key={e.feature_id}>
              <td>{e.slug}</td><td>{e.framework}{e.track ? <span className="muted">:{e.track}</span> : null}</td>
              <td className="num">{e.files}</td><td className="num">{e.requirements}</td><td className="num">{formatHours(e.cycle_hours)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="sub">Compliance apps and high-risk features are excluded: they need the full process whatever the size.</p>
    </div>
  );
}

const STATUS_ORDER = ['active', 'blocked', 'archived'];

export function Overview({ app, onNavigate }: { app?: string | null; onNavigate?: (tab: 'proposals' | 'approvals') => void }) {
  const { data, error, reload } = useLoad(() => getOverview(app ?? undefined), [app]);
  const sizing = useLoad(() => getRightSizing(app).catch(() => null), [app]).data;
  const cycle = useLoad(() => getCycle(app).catch(() => null), [app]).data;
  const metrics = useLoad(() => getMetrics(app).catch(() => null), [app]).data;

  if (error) return <ErrorState message={`Could not load the overview: ${error}`} onRetry={reload} />;
  if (!data) return <Loading />;

  const byStatus = new Map<string, number>();
  for (const row of data.features) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);
  const statuses = [...byStatus].sort((a, b) => (STATUS_ORDER.indexOf(a[0]) + 1 || 99) - (STATUS_ORDER.indexOf(b[0]) + 1 || 99));
  const proposalsByStatus = new Map(data.proposals.map((p) => [p.status, p.count]));
  const pending = proposalsByStatus.get('pending') ?? 0;
  const approved = proposalsByStatus.get('approved') ?? 0;
  const rejected = proposalsByStatus.get('rejected') ?? 0;
  const worstChecks = [...data.checks].filter((c) => c.blocker_count > 0).sort((a, b) => b.blocker_count - a.blocker_count).slice(0, 5);
  const maxBlockers = worstChecks[0]?.blocker_count ?? 1;
  const knowledgeByKind = new Map<string, number>();
  for (const row of data.knowledge) knowledgeByKind.set(row.kind, (knowledgeByKind.get(row.kind) ?? 0) + row.count);
  const maxKnowledge = Math.max(1, ...knowledgeByKind.values());

  return (
    <section className="stack">
      <PageHead title="Overview" subtitle="Where every feature stands, and what needs a human." />
      {statuses.length === 0 ? (
        <Empty title="No features yet." hint="Features appear here once an agent starts one with start_feature." />
      ) : (
        <div className="tiles">
          {statuses.map(([status, count]) => (
            <div className={`tile tone-${toneOf(status)}`} key={status}>
              <span className="tile-value">{count}</span>
              <span className="tile-label">{status}</span>
            </div>
          ))}
        </div>
      )}
      {pending > 0 && onNavigate && (
        <div className="alert" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', borderColor: 'var(--amber)' }}>
          <span>{pending} memory {pending === 1 ? 'proposal is' : 'proposals are'} waiting for review.</span>
          <button onClick={() => onNavigate('proposals')}>Review proposals</button>
        </div>
      )}
      {sizing && Array.isArray(sizing.entries) && sizing.tiny > 0 && <RightSizingCard sizing={sizing} />}
      {cycle && Array.isArray(cycle.by_track) && cycle.features > 0 && <CycleCard cycle={cycle} />}
      {metrics && Array.isArray(metrics.weeks) && metrics.weeks.length > 0 && (
        <div className="card">
          <h3>Is the process paying off?</h3>
          <div className="metric-row">
            <div className="metric"><strong>{metrics.first_pass_rate === null ? '—' : `${Math.round(metrics.first_pass_rate * 100)}%`}</strong><span>phase moves pass the gate on the first try</span></div>
            <div className="metric"><strong>{metrics.caught.failed_transitions}</strong><span>problems caught before review (last 8 weeks)</span></div>
            <div className="metric"><strong>{formatHours(metrics.approvals.median_hours)}</strong><span>median wait for an approval</span></div>
            <div className="metric"><strong>{metrics.approvals.pending}</strong><span>approvals waiting{metrics.approvals.oldest_pending_hours ? ` (oldest ${formatHours(metrics.approvals.oldest_pending_hours)})` : ''}</span></div>
          </div>
          <div className="spark" role="img" aria-label="First-pass rate by week">
            {metrics.weeks.map((w) => {
              const rate = w.total === 0 ? 0 : w.passed / w.total;
              return <span key={w.week} className={rate < 0.5 ? 'low' : ''} style={{ height: `${Math.max(8, rate * 100)}%` }} title={`Week of ${w.week}: ${Math.round(rate * 100)}% first-pass (${w.passed}/${w.total})`} />;
            })}
          </div>
          <p className="sub">First-pass rate per week. A rising line means specs and evidence are getting right the first time.</p>
        </div>
      )}
      <div className="grid">
        <div className="card">
          <h3>Proposals</h3>
          <p className="muted">{`${pending} pending, ${approved} approved, ${rejected} rejected`}</p>
          {pending + approved + rejected > 0 && (
            <SplitBar parts={[{ label: 'Pending', value: pending, tone: 'amber' }, { label: 'Approved', value: approved, tone: 'green' }, { label: 'Rejected', value: rejected, tone: 'red' }]} />
          )}
        </div>
        <div className="card">
          <h3>Checks with the most blockers</h3>
          {worstChecks.length === 0 ? (
            <p className="muted">No gate failures recorded.</p>
          ) : (
            worstChecks.map((c) => (
              <div className="hbar" key={c.check} title={`${c.blocker_count} blockers, ${c.warning_count} warnings`}>
                <span className="name mono">{c.check}</span>
                <span className="track"><span className="fill" style={{ display: 'block', width: `${(c.blocker_count / maxBlockers) * 100}%`, background: 'var(--red)' }} /></span>
                <span className="num">{c.blocker_count}</span>
              </div>
            ))
          )}
        </div>
        <div className="card">
          <h3>Knowledge base</h3>
          {knowledgeByKind.size === 0 ? (
            <p className="muted">No knowledge items yet.</p>
          ) : (
            [...knowledgeByKind].map(([kind, count]) => (
              <div className="hbar" key={kind}>
                <span className="name">{kind}</span>
                <span className="track"><span className="fill" style={{ display: 'block', width: `${(count / maxKnowledge) * 100}%` }} /></span>
                <span className="num">{count}</span>
              </div>
            ))
          )}
        </div>
      </div>
      {data.features.length > 0 && (
        <div className="card">
          <h3>Features by phase</h3>
          <div className="row">
            {Object.entries(data.features.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.current_phase]: (acc[f.current_phase] ?? 0) + f.count }), {})).map(([phase, n]) => (
              <span key={phase} className="row" style={{ gap: '0.35rem' }}><Badge value={phase} tone="gray" plain /><span className="muted">×{n}</span></span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
