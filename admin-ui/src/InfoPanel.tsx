import { useEffect, useState } from 'react';
import { PAGE_INFO } from './pageInfo';

const key = (tab: string) => `sdd-info-${tab}`;

function readClosed(tab: string): boolean {
  try { return localStorage.getItem(key(tab)) === 'closed'; } catch { return false; }
}

/** Collapsible "what can I do here" panel. Open the first time a page is visited, then remembers the choice. */
export function InfoPanel({ tab }: { tab: string }) {
  const info = PAGE_INFO[tab];
  const [open, setOpen] = useState(() => !readClosed(tab));
  useEffect(() => { setOpen(!readClosed(tab)); }, [tab]);
  if (!info) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(key(tab), next ? 'open' : 'closed'); } catch { /* storage unavailable */ }
  };
  const id = `info-${tab}`;

  return (
    <div className="info">
      <button className="info-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span aria-hidden="true">ⓘ</span> {open ? 'Hide page info' : 'About this page'}
      </button>
      {open && (
        <section id={id} className="info-panel" aria-label={`About ${info.title}`}>
          <p>{info.summary}</p>
          <h4>What you can do here</h4>
          <ul>{info.actions.map((a) => <li key={a}>{a}</li>)}</ul>
          {info.tips && info.tips.length > 0 && (
            <>
              <h4>Good to know</h4>
              <ul>{info.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
