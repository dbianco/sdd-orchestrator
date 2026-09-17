import { useState } from 'react';

type Tab = 'overview' | 'apps' | 'flow' | 'proposals';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'apps', label: 'Apps & Features' },
  { id: 'flow', label: 'Flow' },
  { id: 'proposals', label: 'Proposals' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'tab tab-active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {tab === 'overview' && <p>Overview coming soon.</p>}
        {tab === 'apps' && <p>Apps & Features coming soon.</p>}
        {tab === 'flow' && <p>Flow coming soon.</p>}
        {tab === 'proposals' && <p>Proposals coming soon.</p>}
      </main>
    </div>
  );
}
