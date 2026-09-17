import { useEffect, useState } from 'react';
import { getProposals } from '../api';
import type { Proposal } from '../types';

export function Proposals() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProposals().then((r) => setProposals(r.proposals)).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">Could not load proposals: {error}</p>;
  if (!proposals) return <p>Loading…</p>;
  if (proposals.length === 0) return <p>No proposals yet.</p>;

  return (
    <section>
      <h2>Proposals</h2>
      <table>
        <thead><tr><th>Id</th><th>Status</th><th>Created by</th><th>Created at</th></tr></thead>
        <tbody>
          {proposals.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.status}</td>
              <td>{p.created_by}</td>
              <td>{p.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
