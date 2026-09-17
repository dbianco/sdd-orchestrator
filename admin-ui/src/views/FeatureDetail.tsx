import { useEffect, useState } from 'react';
import { getFeatureDetail } from '../api';
import type { FeatureDetail as FeatureDetailData } from '../types';

export function FeatureDetail({ featureId, onBack }: { featureId: string; onBack: () => void }) {
  const [data, setData] = useState<FeatureDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    getFeatureDetail(featureId).then(setData).catch((e: Error) => setError(e.message));
  }, [featureId]);

  return (
    <section>
      <button className="link" onClick={onBack}>&larr; Back</button>
      {error && <p className="error">Could not load feature {featureId}: {error}</p>}
      {!error && !data && <p>Loading…</p>}
      {data && (
        <>
          <h3>{data.feature.slug}</h3>
          <p>{data.feature.status} — {data.feature.current_phase} ({data.feature.framework})</p>
          {data.transitions.length === 0 ? (
            <p>No transitions recorded yet.</p>
          ) : (
            <table>
              <thead><tr><th>From</th><th>To</th><th>Result</th><th>Approved</th><th>Findings</th></tr></thead>
              <tbody>
                {data.transitions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.from_phase}</td>
                    <td>{t.to_phase}</td>
                    <td>{t.result}</td>
                    <td>{t.human_approved ? 'yes' : 'no'}</td>
                    <td>{t.findings.length === 0 ? '—' : t.findings.map((f) => f.check).join(', ')}</td>
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
