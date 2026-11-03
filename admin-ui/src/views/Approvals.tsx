import { useState } from 'react';
import { approveApproval, getApproval, getApprovals, getMe, rejectApproval } from '../api';
import type { Me } from '../types';
import { BackButton, Badge, Empty, ErrorState, Loading, PageHead, Table, Time, useLoad, useToast } from '../ui';

function ApprovalDetail({ id, me, onDone, onBack }: { id: string; me: Me; onDone: (message: string) => void; onBack: () => void }) {
  const { data, error: loadError, reload } = useLoad(() => getApproval(id), [id]);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    action().then(() => onDone(message)).catch((e: Error) => { setError(e.message); setBusy(false); });
  };

  const slug = data?.feature.slug ?? '';

  return (
    <section className="stack">
      <BackButton onClick={onBack} label="approvals" />
      {loadError && <ErrorState message={loadError} onRetry={reload} />}
      {error && <ErrorState message={error} />}
      {!data && !loadError && <Loading />}
      {data && (
        <>
          <div className="card">
            <h3 style={{ fontSize: '1.15rem' }}>{data.feature.slug}: {data.approval.from_phase} &rarr; {data.approval.to_phase}</h3>
            <p className="muted">Requested by {data.approval.requested_by} · {data.feature.framework}{data.feature.track ? ` (${data.feature.track})` : ''}</p>
            {data.feature.high_risk && <Badge value="high risk" tone="red" />}
          </div>
          {data.requirements && (
            <div className="card">
              <h3>Requirements</h3>
              {data.requirements.length === 0 ? <p className="muted">No requirement ids found.</p> : (
                <ul className="requirements">{data.requirements.map((r) => <li key={r} className="mono">{r}</li>)}</ul>
              )}
            </div>
          )}
          {data.findings.length > 0 && (
            <div className="card">
              <h3>Warnings</h3>
              <ul className="findings">{data.findings.map((f, i) => <li key={i}><code>{f.check}</code>: {f.message}</li>)}</ul>
            </div>
          )}
          {data.evidence && (
            <div className="card">
              <h3>Evidence</h3>
              <pre>{JSON.stringify(data.evidence, null, 2)}</pre>
            </div>
          )}
          <div className="card">
            <h3>Artifacts</h3>
            {data.artifacts.length === 0 ? <p className="muted">No artifacts submitted.</p> : data.artifacts.map((a) => (
              <details key={a.name} open={data.artifacts.length === 1}>
                <summary>{a.name} ({a.byte_length} bytes)</summary>
                <pre>{a.content ?? '(too large to store; only its hash was recorded)'}</pre>
              </details>
            ))}
          </div>
          {data.approval.status === 'pending' && (
            <>
              {!me.canApprove && <ErrorState message={`Signed in as ${me.actor}, read-only. Log in with a personal approver token to decide.`} />}
              <div className="decision">
                <div className="card">
                  <h3>Approve</h3>
                  <label className="filter">Comment (optional)
                    <input value={comment} onChange={(e) => setComment(e.target.value)} disabled={!me.canApprove || busy} />
                  </label>
                  <button className="primary" onClick={() => decide(() => approveApproval(id, comment.trim() || undefined), `Approved ${slug}`)} disabled={!me.canApprove || busy}>Approve</button>
                </div>
                <div className="card">
                  <h3>Reject</h3>
                  <label className="filter">Reason for rejecting
                    <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!me.canApprove || busy} />
                  </label>
                  <button className="danger" onClick={() => decide(() => rejectApproval(id, reason.trim()), `Rejected ${slug}`)} disabled={!me.canApprove || busy || reason.trim() === ''}>Reject</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function Approvals() {
  const list = useLoad(getApprovals, []);
  const me = useLoad(getMe, []);
  const [selected, setSelected] = useState<string | null>(null);
  const { show, toast } = useToast();

  const error = list.error ?? me.error;
  if (error) return <ErrorState message={`Could not load approvals: ${error}`} onRetry={() => { list.reload(); me.reload(); }} />;
  if (!list.data || !me.data) return <Loading />;
  if (selected) {
    return <ApprovalDetail id={selected} me={me.data} onBack={() => setSelected(null)} onDone={(m) => { setSelected(null); list.reload(); show(m); }} />;
  }
  const approvals = list.data.approvals;

  return (
    <section>
      <PageHead title="Approvals" subtitle="Phase changes waiting for a human decision." />
      {approvals.length === 0 ? <Empty title="Nothing waits for approval." hint="You're all caught up." /> : (
        <Table>
          <thead><tr><th>App</th><th>Feature</th><th>Move</th><th>Requested by</th><th>Waiting</th></tr></thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id} className="row-link" tabIndex={0} onClick={() => setSelected(a.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(a.id); }}>
                <td>{a.app}</td>
                <td><strong>{a.feature_slug}</strong></td>
                <td>{a.from_phase} &rarr; {a.to_phase}</td>
                <td>{a.requested_by}</td>
                <td><Time iso={a.created_at} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {toast}
    </section>
  );
}
