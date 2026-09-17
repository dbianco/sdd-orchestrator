import { useEffect, useState } from 'react';
import { getFlow } from '../api';
import type { FlowCount } from '../types';

const PHASES = ['specify', 'plan', 'tasks', 'implement', 'verify', 'integrate', 'learn', 'archived'] as const;

function cellColor(count: number, failCount: number): string {
  if (count === 0) return 'transparent';
  const failRate = failCount / count;
  const intensity = Math.round(failRate * 200);
  return `rgb(255, ${255 - intensity}, ${255 - intensity})`;
}

export function Flow() {
  const [rows, setRows] = useState<FlowCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFlow().then((r) => setRows(r.flow)).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">Could not load flow data: {error}</p>;
  if (!rows) return <p>Loading…</p>;
  if (rows.length === 0) return <p>No transitions recorded yet.</p>;

  const cell = new Map<string, { count: number; failCount: number }>();
  for (const r of rows) {
    const key = `${r.from_phase}->${r.to_phase}`;
    const entry = cell.get(key) ?? { count: 0, failCount: 0 };
    entry.count += r.count;
    if (r.result === 'fail') entry.failCount += r.count;
    cell.set(key, entry);
  }

  return (
    <section>
      <h2>Flow</h2>
      <table className="flow-matrix">
        <thead>
          <tr>
            <th />
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
                  <td key={to} style={{ backgroundColor: cellColor(count, failCount) }} title={count > 0 ? `${count} transition(s), ${failCount} failed` : ''}>
                    {count > 0 ? count : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
