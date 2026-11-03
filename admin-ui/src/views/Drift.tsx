import { useState } from 'react';
import { getDrift } from '../api';
import type { DriftEntry } from '../types';
import { Badge, Empty, ErrorState, ExportCsv, Loading, PageHead, SortTh, Table, Time, useLoad, useSort } from '../ui';
import { FeatureDetail } from './FeatureDetail';

function Details({ entry }: { entry: DriftEntry }) {
  return (
    <details>
      <summary>{entry.files.length} file(s)</summary>
      <ul className="stack" style={{ listStyle: 'none', padding: '0.5rem 0.9rem', margin: 0, gap: '0.6rem' }}>
        {entry.files.map((f) => (
          <li key={f.file}>
            <code>{f.file}</code>
            <ul>
              {f.commits.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha.slice(0, 7)}</code> {c.message} <span className="muted">· <Time iso={c.at} /> · {c.feature_slug ? `via ${c.feature_slug}` : 'no feature, no spec'}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Drift({ app }: { app?: string | null }) {
  const { data, error, reload } = useLoad(() => getDrift(app), [app]);
  const [openId, setOpenId] = useState<string | null>(null);
  const entries = data?.drift ?? [];
  const { sorted, sort, toggle } = useSort(entries, {
    feature: (e) => e.slug, level: (e) => (e.level === 'likely' ? 0 : 1), unspecced: (e) => e.unspecced_commits, other: (e) => e.other_feature_commits, changed: (e) => e.last_changed_at, archived: (e) => e.archived_at,
  }, { key: 'level', dir: 'asc' });

  if (error) return <ErrorState message={`Could not load the drift report: ${error}`} onRetry={reload} />;
  if (openId) return <FeatureDetail featureId={openId} onBack={() => setOpenId(null)} />;
  if (!data) return <Loading />;

  const likely = entries.filter((e) => e.level === 'likely').length;
  return (
    <section className="stack">
      <PageHead
        title="Spec drift"
        subtitle={entries.length === 0 ? 'Archived specs and the code still agree as far as the recorded commits show.' : `${likely} likely stale, ${entries.length - likely} to review. Archived specs whose files changed again.`}
        actions={entries.length > 0 ? <ExportCsv filename="spec-drift.csv" headers={['feature', 'app', 'level', 'file', 'sha', 'message', 'changed_at', 'via_feature']} rows={sorted.flatMap((e) => e.files.flatMap((f) => f.commits.map((c) => [e.slug, e.app, e.level, f.file, c.sha, c.message, c.at, c.feature_slug])))} /> : undefined}
      />
      {entries.length === 0 ? (
        <Empty title="No drift found." hint="A spec shows up here when files it delivered are changed after it was archived." />
      ) : (
        <Table>
          <thead><tr>
            <SortTh id="feature" label="Spec (feature)" sort={sort} onSort={toggle} /><SortTh id="level" label="Status" sort={sort} onSort={toggle} />
            <SortTh id="unspecced" label="Changes without a spec" className="num" sort={sort} onSort={toggle} /><SortTh id="other" label="Changes via other features" className="num" sort={sort} onSort={toggle} />
            <SortTh id="changed" label="Last changed" sort={sort} onSort={toggle} /><SortTh id="archived" label="Archived" sort={sort} onSort={toggle} /><th>Files</th>
          </tr></thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.feature_id}>
                <td><button className="link" onClick={() => setOpenId(e.feature_id)}>{e.slug}</button><div className="muted">{e.app}</div></td>
                <td><Badge value={e.level === 'likely' ? 'likely stale' : 'review'} tone={e.level === 'likely' ? 'red' : 'amber'} /></td>
                <td className="num">{e.unspecced_commits}</td>
                <td className="num">{e.other_feature_commits}</td>
                <td><Time iso={e.last_changed_at} /></td>
                <td><Time iso={e.archived_at} /></td>
                <td className="cell-clip" style={{ whiteSpace: 'normal' }}><Details entry={e} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
