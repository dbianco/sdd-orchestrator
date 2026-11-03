import { getFlow } from '../api';
import { Empty, ErrorState, Loading, PageHead, useLoad } from '../ui';

const PHASES = ['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn', 'archived'] as const;

function cellColor(count: number, failCount: number): string {
  if (count === 0) return 'transparent';
  if (failCount === 0) return 'var(--green-bg)';
  const pct = 20 + Math.round((failCount / count) * 60);
  return `color-mix(in srgb, var(--red) ${pct}%, var(--surface))`;
}

export function Flow({ app }: { app?: string | null }) {
  const { data, error, reload } = useLoad(() => getFlow(app ?? undefined), [app]);

  if (error) return <ErrorState message={`Could not load flow data: ${error}`} onRetry={reload} />;
  if (!data) return <Loading />;
  const rows = data.flow;
  if (rows.length === 0) return <Empty title="No transitions recorded yet." hint="Phase moves show up here as agents advance features." />;

  const cell = new Map<string, { count: number; failCount: number }>();
  let total = 0;
  let failed = 0;
  for (const r of rows) {
    const key = `${r.from_phase}->${r.to_phase}`;
    const entry = cell.get(key) ?? { count: 0, failCount: 0 };
    entry.count += r.count;
    total += r.count;
    if (r.result === 'fail') { entry.failCount += r.count; failed += r.count; }
    cell.set(key, entry);
  }
  const worst = [...cell].filter(([, v]) => v.failCount > 0).sort((a, b) => b[1].failCount - a[1].failCount)[0];

  return (
    <section className="stack">
      <PageHead
        title="Flow"
        subtitle={`${total} transitions, ${Math.round((failed / total) * 100)}% blocked by a gate.${worst ? ` Most failures: ${worst[0].replace('->', ' → ')} (${worst[1].failCount}).` : ''}`}
      />
      <div className="card">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="flow-matrix">
            <thead>
              <tr>
                <th>from ↓ / to →</th>
                {PHASES.map((p) => <th key={p}>{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {PHASES.map((from) => (
                <tr key={from}>
                  <th>{from}</th>
                  {PHASES.map((to) => {
                    const entry = cell.get(`${from}->${to}`);
                    const count = entry?.count ?? 0;
                    const failCount = entry?.failCount ?? 0;
                    return (
                      <td key={to} style={{ backgroundColor: cellColor(count, failCount) }} title={count > 0 ? `${from} → ${to}: ${count} transition(s), ${failCount} failed` : ''}>
                        {count > 0 ? count : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flow-legend">All passed <i /> Mostly failed. Hover a cell for details.</div>
      </div>
    </section>
  );
}
