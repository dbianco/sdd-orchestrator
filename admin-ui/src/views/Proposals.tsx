import { useState } from 'react';
import { getProposals } from '../api';
import { Badge, Empty, ErrorState, Loading, PageHead, Table, Time, useLoad } from '../ui';

const FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;

export function Proposals() {
  const { data, error, reload } = useLoad(() => getProposals(), []);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

  if (error) return <ErrorState message={`Could not load proposals: ${error}`} onRetry={reload} />;
  if (!data) return <Loading />;
  const proposals = data.proposals;
  if (proposals.length === 0) return <Empty title="No proposals yet." hint="Agents propose memory with propose_memory; they land here for review." />;
  const shown = filter === 'all' ? proposals : proposals.filter((p) => p.status === filter);

  return (
    <section>
      <PageHead title="Proposals" subtitle="Memory that agents suggested for the knowledge base." />
      <div className="filters">
        <div className="chips" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => {
            const n = f === 'all' ? proposals.length : proposals.filter((p) => p.status === f).length;
            return <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{`${f.charAt(0).toUpperCase()}${f.slice(1)} (${n})`}</button>;
          })}
        </div>
      </div>
      {shown.length === 0 ? <Empty title="Nothing in this status." /> : (
        <Table>
          <thead><tr><th>Id</th><th>Status</th><th>Created by</th><th>Created</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td><Badge value={p.status} /></td>
                <td>{p.created_by}</td>
                <td><Time iso={p.created_at} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
