import { useMemo, useState } from 'react';
import { getAppFeatures, getApps, getRtm } from '../api';
import type { FeatureSummary } from '../types';
import { Badge, Empty, ErrorState, Loading, PageHead, Table, Time, useLoad } from '../ui';
import { FeatureDetail } from './FeatureDetail';
import { RtmTable } from './Requirements';

function FeaturesTable({ features, onOpen }: { features: FeatureSummary[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const statuses = useMemo(() => [...new Set(features.map((f) => f.status))], [features]);
  const q = query.trim().toLowerCase();
  const shown = features.filter((f) =>
    (status === 'all' || f.status === status) &&
    (!q || [f.slug, f.intent, f.external_ref ?? '', f.framework, f.current_phase].some((v) => v.toLowerCase().includes(q))));
  return (
    <>
      <div className="filters">
        <input className="search" type="search" placeholder="Search features…" aria-label="Search features" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips" role="group" aria-label="Filter by status">
          {['all', ...statuses].map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <Empty title="No features match" hint="Try a different search or status." /> : (
        <Table>
          <thead><tr><th>Feature</th><th>Status</th><th>Phase</th><th>Framework</th><th>Ticket</th><th>Updated</th></tr></thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.feature_id}>
                <td>
                  <button className="link" onClick={() => onOpen(f.feature_id)}>{f.slug}</button>
                  <div className="muted cell-clip">{f.intent}</div>
                </td>
                <td><Badge value={f.status} /></td>
                <td><Badge value={f.current_phase} tone="gray" plain /></td>
                <td>{f.framework}{f.track ? <span className="muted">:{f.track}</span> : null}</td>
                <td>{f.external_ref ?? '—'}</td>
                <td><Time iso={f.updated_at} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

export function AppsFeatures({ app }: { app?: string | null }) {
  const apps = useLoad(getApps, []);
  const [pickedApp, setSelectedApp] = useState<string | null>(null);
  const selectedApp = app ?? pickedApp;
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const features = useLoad(() => (selectedApp ? getAppFeatures(selectedApp) : Promise.resolve(null)), [selectedApp]);
  const rtm = useLoad(() => (selectedApp ? getRtm(selectedApp) : Promise.resolve(null)), [selectedApp]);

  if (apps.error) return <ErrorState message={`Could not load apps: ${apps.error}`} onRetry={apps.reload} />;

  if (selectedFeatureId) {
    return <FeatureDetail featureId={selectedFeatureId} onBack={() => setSelectedFeatureId(null)} />;
  }

  const list = apps.data?.apps;
  const count = (a: { features: { count: number }[] }) => a.features.reduce((sum, f) => sum + f.count, 0);

  return (
    <section>
      <PageHead title="Apps & Features" subtitle="Pick an app to see its features and requirement traceability." />
      {!list ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="No apps yet." hint="Apps are created when an agent routes its first task." />
      ) : (
        <div className={app ? '' : 'split'}>
          {!app && <div className="card">
            <h3>Apps</h3>
            <ul className="apps-list">
              {list.map((a) => (
                <li key={a.id}>
                  <button aria-current={selectedApp === a.slug} onClick={() => setSelectedApp(a.slug)}>
                    {a.slug}
                    <span className="muted">{count(a)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>}
          <div className="stack">
            {!selectedApp ? (
              <Empty title="Select an app" hint="Its features and traceability matrix will show up here." />
            ) : (
              <>
                <h3 style={{ marginBottom: 0 }}>{selectedApp}</h3>
                {features.error ? <ErrorState message={features.error} onRetry={features.reload} /> : !features.data ? <Loading /> : features.data.features.length === 0 ? (
                  <Empty title="No features in this app yet" />
                ) : (
                  <FeaturesTable features={features.data.features} onOpen={setSelectedFeatureId} />
                )}
                <h4>Traceability</h4>
                {rtm.error ? <ErrorState message={rtm.error} onRetry={rtm.reload} /> : !rtm.data ? <Loading /> : <RtmTable rows={rtm.data.rows} onOpenFeature={setSelectedFeatureId} />}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
