import { useCallback, useEffect, useState, type ReactNode } from 'react';

export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray';

const TONES: Record<string, Tone> = {
  active: 'blue', blocked: 'red', archived: 'gray', pass: 'green', fail: 'red',
  pending: 'amber', approved: 'green', rejected: 'red', superseded: 'gray', covered: 'green', uncovered: 'red',
  ci: 'blue', host: 'gray',
};

export function toneOf(status: string): Tone {
  return TONES[status] ?? 'gray';
}

export function Badge({ value, tone, plain }: { value: string; tone?: Tone; plain?: boolean }) {
  return <span className={`badge badge-${tone ?? toneOf(value)}${plain ? ' badge-plain' : ''}`}>{value}</span>;
}

/** Loads data and exposes error + reload. Data resets when `deps` change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setError(null);
    let live = true;
    fn().then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => { setData(null); setTick((t) => t + 1); }, []);
  return { data, error, reload };
}

export function Loading() {
  return <div className="skeleton" role="status" aria-label="Loading"><span /><span /><span /><em hidden>Loading…</em></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return <div className="empty"><strong>{title}</strong>{hint}</div>;
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function BackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return <button className="link back" onClick={onClick}>&larr; Back{label ? <span className="muted">{` to ${label}`}</span> : null}</button>;
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="table-wrap"><table>{children}</table></div>;
}

const UNITS: [number, string][] = [[60, 's'], [60, 'm'], [24, 'h'], [30, 'd'], [12, 'mo']];

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  let diff = Math.max(0, Math.round((now - t) / 1000));
  if (diff < 45) return 'just now';
  for (const [size, unit] of UNITS) {
    if (diff < size) return `${diff}${unit} ago`;
    diff = Math.round(diff / size);
  }
  return `${diff}y ago`;
}

export function Time({ iso }: { iso: string }) {
  return <time dateTime={iso} title={new Date(iso).toLocaleString()}>{relativeTime(iso)}</time>;
}

/** Percent-split bar with a legend. */
export function SplitBar({ parts }: { parts: { label: string; value: number; tone: Tone }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <>
      <div className="bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: `var(--${p.tone})` }} />)}
      </div>
      <div className="legend">
        {parts.map((p) => <span key={p.label}><i className="dot" style={{ background: `var(--${p.tone})` }} />{p.label} <strong>{p.value}</strong></span>)}
      </div>
    </>
  );
}

/** Small transient confirmation message. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(id);
  }, [msg]);
  const toast = msg ? <div className="toast" role="status">{msg}</div> : null;
  return { show: setMsg, toast };
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
    apps: 'M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4',
    flow: 'M5 12h14M13 6l6 6-6 6',
    proposals: 'M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3zM9 21h6',
    work: 'M4 6h16M4 12h16M4 18h10',
    approvals: 'M20 6L9 17l-5-5',
    week: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined || Number.isNaN(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h / 24)}d`;
}
