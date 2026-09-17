import { useEffect, useState } from 'react';
import { getOverview } from '../api';
import type { Overview as OverviewData } from '../types';

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">Could not load the overview: {error}</p>;
  if (!data) return <p>Loading…</p>;

  const byStatus = new Map<string, number>();
  for (const row of data.features) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);
  const proposalsByStatus = new Map(data.proposals.map((p) => [p.status, p.count]));
  const worstChecks = [...data.checks].filter((c) => c.blocker_count > 0).sort((a, b) => b.blocker_count - a.blocker_count).slice(0, 5);

  return (
    <section>
      <h2>Overview</h2>
      {byStatus.size === 0 ? (
        <p>No features yet.</p>
      ) : (
        <div className="tiles">
          {[...byStatus].map(([status, count]) => (
            <div className="tile" key={status}>
              <span className="tile-value">{count}</span>
              <span className="tile-label">{status}</span>
            </div>
          ))}
        </div>
      )}
      <h3>Proposals</h3>
      <p>
        {proposalsByStatus.get('pending') ?? 0} pending, {proposalsByStatus.get('approved') ?? 0} approved,{' '}
        {proposalsByStatus.get('rejected') ?? 0} rejected
      </p>
      <h3>Checks with the most blockers</h3>
      {worstChecks.length === 0 ? (
        <p>No gate failures recorded.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Check</th><th>Blockers</th><th>Warnings</th></tr>
          </thead>
          <tbody>
            {worstChecks.map((c) => (
              <tr key={c.check}><td>{c.check}</td><td>{c.blocker_count}</td><td>{c.warning_count}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
