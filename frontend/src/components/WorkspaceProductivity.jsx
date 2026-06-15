import React, { useState, useEffect, useCallback, useRef } from 'react';
import { _fetch } from '../_client';
import './WorkspaceProductivity.css';

const STORE_KEY_SESSIONS   = 'wp-sessions';
const STORE_KEY_PROJECTS   = 'wp-projects';
const STORE_KEY_SNAPSHOTS  = 'wp-snapshots';

const api = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

function store(key) {
  return {
    get: () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} },
  };
}

// ── Session restore ────────────────────────────────────────────────────
function SessionRestore({ onRestore }) {
  const [sessions, setSessions] = useState(() => store(STORE_KEY_SESSIONS).get() || []);
  const [name, setName]         = useState('');

  const saveSession = useCallback(async () => {
    const label = name.trim() || `Session ${new Date().toLocaleString()}`;
    const electronStore = isElectron() ? await api().storeGetAll() : {};
    const session = {
      id:       Date.now(),
      name:     label,
      ts:       Date.now(),
      layout:   electronStore['workspace-layout'] || null,
      tab:      document.title || '',
      url:      window.location.hash || '',
    };
    const next = [session, ...sessions].slice(0, 10);
    setSessions(next);
    store(STORE_KEY_SESSIONS).set(next);
    setName('');
  }, [name, sessions]);

  const restore = useCallback((session) => {
    if (session.layout && isElectron()) {
      api().storeSet('workspace-layout', session.layout);
    }
    onRestore?.(session);
  }, [onRestore]);

  const remove = useCallback((id) => {
    const next = sessions.filter(s => s.id !== id);
    setSessions(next);
    store(STORE_KEY_SESSIONS).set(next);
  }, [sessions]);

  return (
    <div className="wp-section">
      <div className="wp-section__label">Session Restore</div>
      <div className="wp-save-row">
        <input
          className="wp-input"
          placeholder="Session name (optional)…"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveSession()}
        />
        <button className="wp-btn wp-btn--green" onClick={saveSession}>Save</button>
      </div>
      {sessions.length === 0 ? (
        <div className="wp-empty">No saved sessions.</div>
      ) : sessions.map(s => (
        <div key={s.id} className="wp-session-row">
          <div className="wp-session-row__info">
            <span className="wp-session-row__name">{s.name}</span>
            <span className="wp-session-row__ts">{new Date(s.ts).toLocaleString()}</span>
          </div>
          <div className="wp-session-row__actions">
            <button className="wp-btn wp-btn--sm" onClick={() => restore(s)}>Restore</button>
            <button className="wp-btn wp-btn--sm wp-btn--red" onClick={() => remove(s.id)}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Workspace snapshots ────────────────────────────────────────────────
function WorkspaceSnapshots() {
  const [snapshots, setSnapshots] = useState(() => store(STORE_KEY_SNAPSHOTS).get() || []);
  const [taking, setTaking]       = useState(false);

  const takeSnapshot = useCallback(async () => {
    setTaking(true);
    try {
      const electronData = isElectron() ? await api().storeGetAll() : {};
      const snap = {
        id:       Date.now(),
        ts:       Date.now(),
        label:    `Snapshot ${new Date().toLocaleString()}`,
        layout:   electronData['workspace-layout'] || null,
        prefs:    electronData,
      };
      if (isElectron() && api().screenshotWindow) {
        snap.screenshot = await api().screenshotWindow();
      }
      const next = [snap, ...snapshots].slice(0, 20);
      setSnapshots(next);
      store(STORE_KEY_SNAPSHOTS).set(next);
    } finally {
      setTaking(false);
    }
  }, [snapshots]);

  const restoreSnapshot = useCallback(async (snap) => {
    if (snap.layout && isElectron()) {
      await api().storeSet('workspace-layout', snap.layout);
      window.location.reload();
    }
  }, []);

  const removeSnapshot = useCallback((id) => {
    const next = snapshots.filter(s => s.id !== id);
    setSnapshots(next);
    store(STORE_KEY_SNAPSHOTS).set(next);
  }, [snapshots]);

  return (
    <div className="wp-section">
      <div className="wp-section__label">Workspace Snapshots</div>
      <button className="wp-btn wp-btn--primary" onClick={takeSnapshot} disabled={taking}>
        {taking ? 'Snapping…' : '📸 Take Snapshot'}
      </button>
      {snapshots.length === 0 ? (
        <div className="wp-empty">No snapshots yet.</div>
      ) : snapshots.map(s => (
        <div key={s.id} className="wp-snap-row">
          <div className="wp-snap-row__info">
            <span className="wp-snap-row__label">{s.label}</span>
            {s.screenshot && <span className="wp-snap-row__meta">📸 screenshot saved</span>}
          </div>
          <div className="wp-snap-row__actions">
            <button className="wp-btn wp-btn--sm" onClick={() => restoreSnapshot(s)}>Restore</button>
            <button className="wp-btn wp-btn--sm wp-btn--red" onClick={() => removeSnapshot(s.id)}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Multi-project support ──────────────────────────────────────────────
function ProjectSwitcher({ onSwitch }) {
  const [projects, setProjects] = useState(() => store(STORE_KEY_PROJECTS).get() || []);
  const [adding, setAdding]     = useState(false);
  const [newPath, setNewPath]   = useState('');
  const [newName, setNewName]   = useState('');

  const addProject = useCallback(async () => {
    let path = newPath.trim();
    if (!path && isElectron()) {
      const result = await api().fsShowOpenDialog({ properties: ['openDirectory'] });
      path = result?.filePaths?.[0] || '';
    }
    if (!path) return;
    const project = {
      id:   Date.now(),
      name: newName.trim() || path.split('/').pop(),
      path,
      ts:   Date.now(),
    };
    const next = [...projects, project];
    setProjects(next);
    store(STORE_KEY_PROJECTS).set(next);
    setNewPath('');
    setNewName('');
    setAdding(false);
  }, [newPath, newName, projects]);

  const remove = useCallback((id) => {
    const next = projects.filter(p => p.id !== id);
    setProjects(next);
    store(STORE_KEY_PROJECTS).set(next);
  }, [projects]);

  return (
    <div className="wp-section">
      <div className="wp-section__label">Projects</div>
      {projects.map(p => (
        <div key={p.id} className="wp-project-row">
          <div className="wp-project-row__info" onClick={() => onSwitch?.(p)}>
            <span className="wp-project-row__name">{p.name}</span>
            <span className="wp-project-row__path">{p.path}</span>
          </div>
          <div className="wp-project-row__actions">
            <button className="wp-btn wp-btn--sm" onClick={() => onSwitch?.(p)}>Open</button>
            <button className="wp-btn wp-btn--sm wp-btn--red" onClick={() => remove(p.id)}>✕</button>
          </div>
        </div>
      ))}
      {!adding ? (
        <button className="wp-btn wp-btn--sm" onClick={() => setAdding(true)}>+ Add Project</button>
      ) : (
        <div className="wp-add-project">
          <input className="wp-input" placeholder="Path…" value={newPath} onChange={e => setNewPath(e.target.value)} />
          <input className="wp-input" placeholder="Name (optional)…" value={newName} onChange={e => setNewName(e.target.value)} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="wp-btn wp-btn--green" onClick={addProject}>Add</button>
            <button className="wp-btn wp-btn--sm"    onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cross-workspace search ─────────────────────────────────────────────
function CrossSearch() {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const projects = store(STORE_KEY_PROJECTS).get() || [];
  const timer    = useRef(null);

  const search = useCallback(async (q) => {
    if (!q.trim() || !isElectron()) { setResults([]); return; }
    setLoading(true);
    const all = [];
    for (const project of projects) {
      try {
        const matches = await api().fsGrep(project.path, q.trim());
        (matches || []).forEach(m => all.push({ ...m, project: project.name }));
      } catch {}
    }
    setResults(all.slice(0, 50));
    setLoading(false);
  }, [projects]);

  const onInput = (e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(q), 350);
  };

  return (
    <div className="wp-section">
      <div className="wp-section__label">Cross-Project Search</div>
      <input
        className="wp-input"
        placeholder="Search all projects… (grep)"
        value={query}
        onChange={onInput}
      />
      {loading && <div className="wp-empty">Searching…</div>}
      {!loading && results.length === 0 && query && <div className="wp-empty">No results.</div>}
      {results.map((r, i) => (
        <div key={i} className="wp-search-result">
          <div className="wp-search-result__meta">
            <span className="wp-search-result__project">{r.project}</span>
            <span className="wp-search-result__file">{r.file}</span>
            {r.line && <span className="wp-search-result__line">:{r.line}</span>}
          </div>
          <div className="wp-search-result__text">{r.text || r.match}</div>
        </div>
      ))}
    </div>
  );
}

// ── Background indexing status ─────────────────────────────────────────
function IndexingStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const run = async () => {
      try {
        setStatus(await _fetch('/runtime/index/status'));
      } catch {}
    };
    run();
    const id = setInterval(run, 10000);
    return () => clearInterval(id);
  }, []);

  if (!status) return null;

  return (
    <div className="wp-index-status">
      <span className="wp-index-status__label">Background Index</span>
      <span className={`wp-badge wp-badge--${status.running ? 'blue' : 'green'}`}>
        {status.running ? 'indexing' : 'ready'}
      </span>
      {status.files != null && <span className="wp-index-status__count">{status.files} files</span>}
    </div>
  );
}

// ── Offline project cache ──────────────────────────────────────────────
function OfflineCache() {
  const [cached, setCached] = useState([]);

  useEffect(() => {
    if (isElectron()) {
      api().storeGetAll?.().then(all => {
        const keys = Object.keys(all).filter(k => k.startsWith('cache:'));
        setCached(keys.map(k => ({ key: k.slice(6), size: JSON.stringify(all[k]).length })));
      });
    }
  }, []);

  const clear = useCallback(async () => {
    if (isElectron()) {
      await api().cacheClear?.();
      setCached([]);
    }
  }, []);

  return (
    <div className="wp-section">
      <div className="wp-section__label">Offline Project Cache</div>
      {!cached.length ? (
        <div className="wp-empty">No cached data.</div>
      ) : cached.map((c, i) => (
        <div key={i} className="wp-cache-row">
          <span className="wp-cache-key">{c.key}</span>
          <span className="wp-cache-size">{(c.size / 1024).toFixed(1)}KB</span>
        </div>
      ))}
      {cached.length > 0 && (
        <button className="wp-btn wp-btn--sm wp-btn--red" onClick={clear}>Clear Cache</button>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'sessions',  label: 'Sessions' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'projects',  label: 'Projects' },
  { id: 'search',    label: 'Cross-Search' },
  { id: 'cache',     label: 'Offline Cache' },
];

export default function WorkspaceProductivity({ onProjectSwitch, onSessionRestore, className = '' }) {
  const [tab, setTab] = useState('sessions');

  return (
    <div className={`workspace-productivity ${className}`}>
      <div className="wp-header">
        <span className="wp-header__title">Workspace Productivity</span>
        <IndexingStatus />
      </div>
      <div className="wp-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`wp-tab${tab === t.id ? ' wp-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wp-body">
        {tab === 'sessions'  && <SessionRestore   onRestore={onSessionRestore} />}
        {tab === 'snapshots' && <WorkspaceSnapshots />}
        {tab === 'projects'  && <ProjectSwitcher  onSwitch={onProjectSwitch} />}
        {tab === 'search'    && <CrossSearch />}
        {tab === 'cache'     && <OfflineCache />}
      </div>
    </div>
  );
}
