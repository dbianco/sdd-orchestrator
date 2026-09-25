import { useCallback, useEffect, useState } from 'react';
import { approveApproval, getApproval, getApprovals, getMe, rejectApproval } from '../api';
import type { Approval, ApprovalDetail as ApprovalDetailData, Me } from '../types';

function ApprovalDetail({ id, me, onDone, onBack }: { id: string; me: Me; onDone: () => void; onBack: () => void }) {
  const [data, setData] = useState<ApprovalDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getApproval(id).then(setData).catch((e: Error) => setError(e.message)); }, [id]);

  const decide = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action().then(onDone).catch((e: Error) => { setError(e.message); setBusy(false); });
  };

  return (
    <section>
      <button className="link" onClick={onBack}>&larr; Back</button>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && (
        <>
          <h3>{data.feature.slug}: {data.approval.from_phase} &rarr; {data.approval.to_phase}</h3>
          <p>Requested by {data.approval.requested_by} · {data.feature.framework}{data.feature.track ? ` (${data.feature.track})` : ''}{data.feature.high_risk ? ' · high risk' : ''}</p>
          {data.requirements && (
            <>
              <h4>Requirements</h4>
              <p>{data.requirements.length === 0 ? 'No requirement ids found.' : data.requirements.join(', ')}</p>
            </>
          )}
          {data.findings.length > 0 && (
            <>
              <h4>Warnings</h4>
              <ul>{data.findings.map((f, i) => <li key={i}>{f.check}: {f.message}</li>)}</ul>
            </>
          )}
          {data.evidence && (
            <>
              <h4>Evidence</h4>
              <pre>{JSON.stringify(data.evidence, null, 2)}</pre>
            </>
          )}
          <h4>Artifacts</h4>
          {data.artifacts.length === 0 ? <p>No artifacts submitted.</p> : data.artifacts.map((a) => (
            <details key={a.name} open={data.artifacts.length === 1}>
              <summary>{a.name} ({a.byte_length} bytes)</summary>
              <pre>{a.content ?? '(too large to store; only its hash was recorded)'}</pre>
            </details>
          ))}
          {data.approval.status === 'pending' && (
            <div className="decision">
              {!me.canApprove && <p>Signed in as {me.actor}, read-only. Log in with a personal approver token to decide.</p>}
              <label className="filter">Comment (optional)
                <input value={comment} onChange={(e) => setComment(e.target.value)} disabled={!me.canApprove || busy} />
              </label>
              <button onClick={() => decide(() => approveApproval(id, comment.trim() || undefined))} disabled={!me.canApprove || busy}>Approve</button>
              <label className="filter">Reason for rejecting
                <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!me.canApprove || busy} />
              </label>
              <button onClick={() => decide(() => rejectApproval(id, reason.trim()))} disabled={!me.canApprove || busy || reason.trim() === ''}>Reject</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Approvals() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getApprovals().then((r) => setApprovals(r.approvals)).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    getMe().then(setMe).catch((e: Error) => setError(e.message));
  }, [load]);

  if (error) return <p className="error">Could not load approvals: {error}</p>;
  if (!approvals || !me) return <p>Loading…</p>;
  if (selected) return <ApprovalDetail id={selected} me={me} onBack={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />;

  return (
    <section>
      <h2>Approvals</h2>
      {approvals.length === 0 ? <p>Nothing waits for approval.</p> : (
        <table>
          <thead><tr><th>App</th><th>Feature</th><th>Move</th><th>Requested by</th><th>Since</th></tr></thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id} className="row-link" onClick={() => setSelected(a.id)}>
                <td>{a.app}</td>
                <td>{a.feature_slug}</td>
                <td>{a.from_phase} &rarr; {a.to_phase}</td>
                <td>{a.requested_by}</td>
                <td>{a.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
