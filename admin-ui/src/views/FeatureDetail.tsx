import { getFeatureDetail } from '../api';
import { BackButton, Badge, Empty, ErrorState, Loading, Time, useLoad } from '../ui';
import { RequirementList } from './Requirements';

export function FeatureDetail({ featureId, onBack }: { featureId: string; onBack: () => void }) {
  const { data, error, reload } = useLoad(() => getFeatureDetail(featureId), [featureId]);

  return (
    <section className="stack">
      <BackButton onClick={onBack} />
      {error && <ErrorState message={`Could not load feature ${featureId}: ${error}`} onRetry={reload} />}
      {!error && !data && <Loading />}
      {data && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{data.feature.slug}</h3>
              <Badge value={data.feature.status} />
            </div>
            <dl className="kv" style={{ marginTop: '0.75rem' }}>
              <dt>Phase</dt><dd>{data.feature.current_phase}</dd>
              <dt>Framework</dt><dd>{data.feature.framework}{data.feature.track ? `:${data.feature.track}` : ''}</dd>
              <dt>Updated</dt><dd><Time iso={data.feature.updated_at} /></dd>
              {data.feature.blocked_reason && <><dt>Blocked</dt><dd className="error">{data.feature.blocked_reason}</dd></>}
            </dl>
          </div>
          <div className="card">
            <h3>Phase history</h3>
            {data.transitions.length === 0 ? (
              <p className="muted">No transitions recorded yet.</p>
            ) : (
              <ol className="timeline">
                {data.transitions.map((t) => (
                  <li key={t.id} className={`tone-${t.result === 'pass' ? 'green' : 'red'}`}>
                    <div className="row">
                      <strong><span>{t.from_phase}</span> &rarr; <span>{t.to_phase}</span></strong>
                      <Badge value={t.result} />
                      {t.direction === 'backward' && <Badge value="backward" tone="amber" plain />}
                      {t.human_approved && <Badge value="human approved" tone="blue" plain />}
                      <span className="when"><Time iso={t.created_at} /></span>
                    </div>
                    {t.reason && <div className="muted">{t.reason}</div>}
                    {t.findings.length > 0 && (
                      <ul className="findings">
                        {t.findings.map((f, i) => (
                          <li key={i}><span className={`sev-${f.severity}`}>{f.severity}</span> <code>{f.check}</code>{f.message ? ` — ${f.message}` : ''}{f.location ? ` (${f.location})` : ''}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="card">
            <h3>Requirements</h3>
            {data.requirements.length === 0 ? <Empty title="No requirements captured." /> : <RequirementList requirements={data.requirements} />}
          </div>
        </>
      )}
    </section>
  );
}
