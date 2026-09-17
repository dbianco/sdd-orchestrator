import { useEffect, useState } from 'react';
import { getAppFeatures, getApps } from '../api';
import type { AppSummary, FeatureSummary } from '../types';
import { FeatureDetail } from './FeatureDetail';

export function AppsFeatures() {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureSummary[] | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApps().then((r) => setApps(r.apps)).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedApp) { setFeatures(null); return; }
    getAppFeatures(selectedApp).then((r) => setFeatures(r.features)).catch((e: Error) => setError(e.message));
  }, [selectedApp]);

  if (error) return <p className="error">Could not load apps: {error}</p>;

  if (selectedFeatureId) {
    return <FeatureDetail featureId={selectedFeatureId} onBack={() => setSelectedFeatureId(null)} />;
  }

  return (
    <section>
      <h2>Apps &amp; Features</h2>
      {!apps ? (
        <p>Loading…</p>
      ) : apps.length === 0 ? (
        <p>No apps yet.</p>
      ) : (
        <ul className="apps-list">
          {apps.map((a) => (
            <li key={a.id}>
              <button className="link" onClick={() => setSelectedApp(a.slug)}>{a.slug}</button>
              {' — '}
              {a.features.reduce((sum, f) => sum + f.count, 0)} feature(s)
            </li>
          ))}
        </ul>
      )}
      {selectedApp && (
        <>
          <h3>{selectedApp}</h3>
          {!features ? (
            <p>Loading…</p>
          ) : features.length === 0 ? (
            <p>No features in this app yet.</p>
          ) : (
            <table>
              <thead><tr><th>Slug</th><th>Status</th><th>Phase</th><th>Framework</th></tr></thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.feature_id}>
                    <td><button className="link" onClick={() => setSelectedFeatureId(f.feature_id)}>{f.slug}</button></td>
                    <td>{f.status}</td>
                    <td>{f.current_phase}</td>
                    <td>{f.framework}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
