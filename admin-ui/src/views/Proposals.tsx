import { useState } from 'react';
import { approveProposal, getApps, getMe, getProposals, rejectProposal } from '../api';
import type { Proposal } from '../types';
import { Badge, Empty, ErrorState, ExportCsv, Loading, PageHead, SortTh, Table, Time, useLoad, useSort, useToast } from '../ui';

const FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;

function ProposalReview({ proposal, canDecide, onClose, onDone }: { proposal: Proposal; canDecide: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = proposal.payload;
  const decide = (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    action().then(() => onDone(message)).catch((e: Error) => { setError(e.message); setBusy(false); });
  };
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{p?.title ?? proposal.id}</h3>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
      <div className="row">
        <Badge value={proposal.status} />
        {p?.kind && <Badge value={p.kind} tone="gray" plain />}
        {p?.memory_type && <Badge value={p.memory_type} tone="blue" plain />}
        <span className="muted">proposed by {proposal.created_by} · <Time iso={proposal.created_at} /></span>
      </div>
      {p?.body ? <div className="proposal-body">{p.body}</div> : <p className="muted">This server version does not send the proposal text.</p>}
      {(p?.links?.length ?? 0) > 0 && <ul>{p!.links!.map((l) => <li key={l}>{l}</li>)}</ul>}
      {proposal.reviewed_by && <p className="muted">Reviewed by {proposal.reviewed_by}{proposal.review_reason ? `: ${proposal.review_reason}` : ''}</p>}
      {error && <ErrorState message={error} />}
      {proposal.status === 'pending' && (
        <div className="row">
          {!canDecide && <span className="muted">Read-only login: sign in with a personal approver token to decide.</span>}
          <button className="primary" disabled={!canDecide || busy} onClick={() => decide(() => approveProposal(proposal.id), `Approved “${p?.title ?? proposal.id}”`)}>Accept into knowledge base</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejecting" aria-label="Reason for rejecting" disabled={!canDecide || busy} />
          <button className="danger" disabled={!canDecide || busy || reason.trim() === ''} onClick={() => decide(() => rejectProposal(proposal.id, reason.trim()), `Rejected “${p?.title ?? proposal.id}”`)}>Reject proposal</button>
        </div>
      )}
    </div>
  );
}

export function Proposals({ app }: { app?: string | null }) {
  const { data, error, reload } = useLoad(async () => {
    const [p, a] = await Promise.all([getProposals(), app ? getApps() : Promise.resolve(null)]);
    const appId = app ? a?.apps.find((x) => x.slug === app)?.id : undefined;
    return { proposals: app ? p.proposals.filter((x) => x.app_id === appId) : p.proposals };
  }, [app]);
  const me = useLoad(() => getMe().catch(() => null), []).data;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { show, toast } = useToast();
  const proposals = data?.proposals ?? [];
  const shown = filter === 'all' ? proposals : proposals.filter((p) => p.status === filter);
  const { sorted, sort, toggle } = useSort(shown, { id: (p) => p.id, title: (p) => p.payload?.title, status: (p) => p.status, by: (p) => p.created_by, created: (p) => p.created_at }, { key: 'created', dir: 'desc' });

  if (error) return <ErrorState message={`Could not load proposals: ${error}`} onRetry={reload} />;
  if (!data) return <Loading />;
  if (proposals.length === 0) return <Empty title="No proposals yet." hint={app ? `Nothing proposed for ${app}.` : 'Agents propose memory with propose_memory; they land here for review.'} />;
  const open = proposals.find((p) => p.id === openId) ?? null;

  return (
    <section className="stack">
      <PageHead title="Proposals" subtitle="Memory that agents suggested for the knowledge base. Review the text, then accept or reject." />
      <div className="filters" style={{ marginBottom: 0 }}>
        <div className="chips" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => {
            const n = f === 'all' ? proposals.length : proposals.filter((p) => p.status === f).length;
            return <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{`${f.charAt(0).toUpperCase()}${f.slice(1)} (${n})`}</button>;
          })}
        </div>
        <ExportCsv filename="proposals.csv" headers={['id', 'title', 'type', 'status', 'created_by', 'created_at']} rows={sorted.map((p) => [p.id, p.payload?.title, p.payload?.memory_type, p.status, p.created_by, p.created_at])} />
      </div>
      {open && <ProposalReview key={open.id} proposal={open} canDecide={Boolean(me?.canApprove)} onClose={() => setOpenId(null)} onDone={(m) => { setOpenId(null); reload(); show(m); }} />}
      {sorted.length === 0 ? <Empty title="Nothing in this status." /> : (
        <Table>
          <thead><tr>
            <SortTh id="id" label="Id" sort={sort} onSort={toggle} /><SortTh id="title" label="Proposal" sort={sort} onSort={toggle} /><SortTh id="status" label="Status" sort={sort} onSort={toggle} />
            <SortTh id="by" label="Created by" sort={sort} onSort={toggle} /><SortTh id="created" label="Created" sort={sort} onSort={toggle} /><th />
          </tr></thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td className="cell-clip">{p.payload?.title ?? '—'}</td>
                <td><Badge value={p.status} /></td>
                <td>{p.created_by}</td>
                <td><Time iso={p.created_at} /></td>
                <td><button className="link" onClick={() => setOpenId(p.id)}>{p.status === 'pending' ? 'Review' : 'View'}</button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {toast}
    </section>
  );
}
