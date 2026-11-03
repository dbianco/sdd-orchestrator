import { useCallback, useEffect, useState } from 'react';
import { getApps, getApprovals, getMe } from './api';
import { Overview } from './views/Overview';
import { AppsFeatures } from './views/AppsFeatures';
import { Flow } from './views/Flow';
import { Proposals } from './views/Proposals';
import { Work } from './views/Work';
import { Approvals } from './views/Approvals';
import { Icon } from './ui';

type Tab = 'overview' | 'apps' | 'flow' | 'proposals' | 'work' | 'approvals';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'apps', label: 'Apps & Features' },
  { id: 'work', label: 'Work' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'flow', label: 'Flow' },
];

const tabFromHash = (): Tab => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? (id as Tab) : 'overview';
};

type Theme = 'light' | 'dark' | null;

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('sdd-theme') as Theme) || null; } catch { return null; }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { if (theme) localStorage.setItem('sdd-theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  const toggle = () => {
    const dark = theme ? theme === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(dark ? 'light' : 'dark');
  };
  return [theme, toggle];
}

export function App() {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(0);
  const [actor, setActor] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [app, setAppState] = useState<string | null>(() => {
    try { return localStorage.getItem('sdd-app') || null; } catch { return null; }
  });
  const setApp = (slug: string | null) => {
    setAppState(slug);
    try { if (slug) localStorage.setItem('sdd-app', slug); else localStorage.removeItem('sdd-app'); } catch { /* storage unavailable */ }
  };
  const [, toggleTheme] = useTheme();

  const setTab = (t: Tab) => { window.location.hash = `/${t}`; setTabState(t); };

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refreshBadges = useCallback(() => {
    getApprovals(app).then((r) => setPending(Array.isArray(r.approvals) ? r.approvals.filter((a) => a.status === 'pending').length : 0)).catch(() => undefined);
    getMe().then((m) => setActor(m.actor ?? null)).catch(() => undefined);
  }, [app]);

  useEffect(() => {
    getApps().then((r) => {
      const slugs = Array.isArray(r.apps) ? r.apps.map((a) => a.slug) : [];
      setApps(slugs);
      if (app && slugs.length > 0 && !slugs.includes(app)) setApp(null);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    refreshBadges();
    const id = setInterval(refreshBadges, 60_000);
    return () => clearInterval(id);
  }, [refreshBadges, version]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo"><Icon name="approvals" /></span>
          <span>SDD Admin<small>Orchestrator console</small></span>
        </div>
        {apps.length > 0 && (
          <label className="project-picker">
            <span>Project</span>
            <select aria-label="Project" value={app ?? ''} onChange={(e) => setApp(e.target.value || null)}>
              <option value="">All projects</option>
              {apps.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
            </select>
          </label>
        )}
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'tab tab-active' : 'tab'} aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <Icon name={t.id} />
              {t.label}
              {t.id === 'approvals' && pending > 0 && <span className="tab-count" title={`${pending} waiting for approval`}>{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="tab" onClick={() => setVersion((v) => v + 1)} title="Reload the current view"><Icon name="refresh" />Refresh</button>
          <button className="tab" onClick={toggleTheme} title="Switch light / dark theme"><Icon name="sun" />Theme</button>
          {actor && <div className="who">Signed in as<strong>{actor}</strong></div>}
        </div>
      </aside>
      <main className="main">
        <div className="content" key={`${tab}:${version}:${app ?? ''}`}>
          {tab === 'overview' && <Overview app={app} onNavigate={setTab} />}
          {tab === 'apps' && <AppsFeatures app={app} />}
          {tab === 'flow' && <Flow app={app} />}
          {tab === 'proposals' && <Proposals app={app} />}
          {tab === 'work' && <Work app={app} />}
          {tab === 'approvals' && <Approvals app={app} />}
        </div>
      </main>
    </div>
  );
}
