import { useState } from 'react';
import { Overview } from './views/Overview';
import { AppsFeatures } from './views/AppsFeatures';
import { Flow } from './views/Flow';
import { Proposals } from './views/Proposals';
import { Work } from './views/Work';
import { Approvals } from './views/Approvals';

type Tab = 'overview' | 'apps' | 'flow' | 'proposals' | 'work' | 'approvals';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'apps', label: 'Apps & Features' },
  { id: 'flow', label: 'Flow' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'work', label: 'Work' },
  { id: 'approvals', label: 'Approvals' },
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
        {tab === 'overview' && <Overview />}
        {tab === 'apps' && <AppsFeatures />}
        {tab === 'flow' && <Flow />}
        {tab === 'proposals' && <Proposals />}
        {tab === 'work' && <Work />}
        {tab === 'approvals' && <Approvals />}
      </main>
    </div>
  );
}
