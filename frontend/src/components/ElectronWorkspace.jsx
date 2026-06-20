import React, {
  useState, useCallback, useEffect, useRef,
  lazy, Suspense, memo,
} from 'react';
import { useLazyPanel } from '../hooks/useLazyPanel';
import { useStableCallback } from '../hooks/useStableCallback';
import ErrorBoundary from './ErrorBoundary';
import GlobalSearch, { ClipboardHistoryPanel } from './GlobalSearch';
import MissionControl from './operator-os/MissionControl';
import './ElectronWorkspace.css';

// ── Lazy imports — none of these load until first activated ───────────
const TerminalPanel           = lazy(() => import('./TerminalPanel'));
const FileExplorer            = lazy(() => import('./FileExplorer'));
const EngineeringConsole      = lazy(() => import('./EngineeringConsole'));
const AIOverlay               = lazy(() => import('./AIOverlay'));
const VisualGit               = lazy(() => import('./VisualGit'));
const AIPairProgramming       = lazy(() => import('./AIPairProgramming'));
const RuntimeDebugger         = lazy(() => import('./RuntimeDebugger'));
const VisualArchitecture      = lazy(() => import('./VisualArchitecture'));
const WorkspaceProductivity   = lazy(() => import('./WorkspaceProductivity'));
const AutonomousOps           = lazy(() => import('./AutonomousOps'));
const LiveAgentCollaboration  = lazy(() => import('./operator-os/LiveAgentCollaboration'));
const MissionEngine           = lazy(() => import('./operator-os/MissionEngine'));
const IntelligenceOverlay     = lazy(() => import('./operator-os/IntelligenceOverlay'));
const OperatorCommandLayer    = lazy(() => import('./operator-os/OperatorCommandLayer'));
const ExecutiveLoop           = lazy(() => import('./operator-os/ExecutiveLoop'));
const RuntimeObserverPanel    = lazy(() => import('./RuntimeObserverPanel'));
const DecisionQueuePanel      = lazy(() => import('./DecisionQueuePanel'));
const MissionOrchestratorPanel = lazy(() => import('./MissionOrchestratorPanel'));
const ExecutionRuntimePanel    = lazy(() => import('./ExecutionRuntimePanel'));
const CodeEditorPane              = lazy(() => import('./CodeEditorPane'));
const ProjectSearch               = lazy(() => import('./ProjectSearch'));
const WorkspaceTemplates          = lazy(() => import('./WorkspaceTemplates'));
const MissionDock                 = lazy(() => import('./MissionDock'));
const EngineeringIntelligencePane = lazy(() => import('./EngineeringIntelligencePane'));
const SymbolPanel                 = lazy(() => import('./SymbolPanel'));
const GitBlame                    = lazy(() => import('./GitBlame'));
const QuickPush                   = lazy(() => import('./QuickPush'));
const WorkspaceHealth             = lazy(() => import('./WorkspaceHealth'));
const DevDashboard                = lazy(() => import('./DevDashboard'));
const PluginMarketplace           = lazy(() => import('./PluginMarketplace'));
const LicenseManager              = lazy(() => import('./LicenseManager'));
const PerformanceAudit            = lazy(() => import('./PerformanceAudit'));
const ClosedBetaAudit             = lazy(() => import('./ClosedBetaAudit'));
const WorkspaceRecovery           = lazy(() => import('./WorkspaceRecovery'));
const DeveloperConsole            = lazy(() => import('./DeveloperConsole'));
const AdminDashboard              = lazy(() => import('./AdminDashboard'));
const CommercialBenchmark         = lazy(() => import('./CommercialBenchmark'));
const AIMarketplace               = lazy(() => import('./AIMarketplace'));
const AIBenchmarkLab              = lazy(() => import('./AIBenchmarkLab'));
const AutomationDashboard         = lazy(() => import('./AutomationDashboard'));
const CreativeStudio              = lazy(() => import('./CreativeStudio'));

// ── Generic resize hook ───────────────────────────────────────────────
function useResize(initial, min, max, axis = 'y') {
  const [size, setSize] = useState(initial);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startPos  = axis === 'y' ? e.clientY : e.clientX;
    const startSize = size;
    const cursor    = axis === 'y' ? 'row-resize' : 'col-resize';

    const onMove = (mv) => {
      const pos   = axis === 'y' ? mv.clientY : mv.clientX;
      const delta = axis === 'y' ? startPos - pos : pos - startPos;
      setSize(Math.min(max, Math.max(min, startSize + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size, min, max, axis]);

  return { size, onResizerMouseDown: onMouseDown };
}

function useBottomResize(initial = 340) {
  const { size: height, onResizerMouseDown } = useResize(initial, 140, 720, 'y');
  return { height, onResizerMouseDown };
}

function useSidebarResize(initial = 260) {
  const stored = (() => { try { return parseInt(localStorage.getItem('ew-sidebar-w') || '', 10) || initial; } catch { return initial; } })();
  const { size: width, onResizerMouseDown: _mouse } = useResize(stored, 160, 520, 'x');

  // Persist on change
  useEffect(() => {
    try { localStorage.setItem('ew-sidebar-w', String(width)); } catch {}
  }, [width]);

  // Double-click to reset to default
  const onDoubleClick = useCallback(() => {
    try { localStorage.setItem('ew-sidebar-w', String(initial)); } catch {}
    window.location.reload(); // simplest reset — reload persists correctly
  }, [initial]);

  return { width, onResizerMouseDown: _mouse, onResizerDoubleClick: onDoubleClick };
}

// Horizontal split resize — for center panel split layout
function useCenterSplitResize(initial = 50) {
  // Returns percentage for top pane (0-100)
  const [pct, setPct] = useState(initial);
  const containerRef = useRef(null);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startPct = pct;

    const onMove = (mv) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newPct = startPct + ((mv.clientY - startY) / rect.height) * 100;
      setPct(Math.min(85, Math.max(15, newPct)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pct]);

  return { pct, containerRef, onResizerMouseDown: onMouseDown };
}

// ── Constants ──────────────────────────────────────────────────────────
const SIDEBAR_MODES = {
  explorer:     { label: 'Files',        icon: '📁', title: 'File Explorer',             shortcut: '1' },
  code:         { label: 'Search',       icon: '⌕',  title: 'Project Search',            shortcut: '2' },
  git:          { label: 'Git',          icon: '🌿', title: 'Visual Git',                shortcut: '3' },
  symbols:      { label: 'Outline',      icon: 'ƒ',  title: 'File Outline & Symbols',    shortcut: '4' },
  clipboard:    { label: 'Clipboard',    icon: '📋', title: 'Clipboard History',          shortcut: '5' },
  productivity: { label: 'Workspace',    icon: '🗂',  title: 'Workspace',                 shortcut: '6' },
  intelligence: { label: 'Intelligence', icon: '◈',  title: 'Engineering Intelligence',  shortcut: '7' },
};

const BOTTOM_TABS = {
  terminal:    { label: 'Terminal',    icon: '🖥' },
  console:     { label: 'Console',     icon: '📊' },
  debugger:    { label: 'Debugger',    icon: '🔍' },
  ops:         { label: 'Auto-Ops',    icon: '🤖' },
  arch:        { label: 'Arch',        icon: '🗺' },
  pair:        { label: 'AI Pair',     icon: '💡' },
  agents:      { label: 'Agents',      icon: '⬡' },
  missions:    { label: 'Missions',    icon: '◎' },
  command:     { label: 'Command',     icon: '❯' },
  execloop:    { label: 'Exec Loop',   icon: '↻' },
  observer:    { label: 'Observer',    icon: '◉' },
  decisions:   { label: 'Decisions',   icon: '◈' },
  orchestrator:{ label: 'Orchestrator',icon: '◎' },
  execution:   { label: 'Execution',   icon: '⚙' },
  blame:       { label: 'Git Blame',   icon: '⎇' },
  push:        { label: 'Quick Push',  icon: '▲' },
  health:      { label: 'WS Health',   icon: '◉' },
  devdash:     { label: 'Dev Stats',   icon: '★' },
  plugins:     { label: 'Plugins',     icon: '◈' },
  license:     { label: 'License',     icon: '🔑' },
  perf:        { label: 'Perf Audit',  icon: '⚡' },
  betaaudit:   { label: 'Beta Audit',  icon: '◎' },
  recovery:    { label: 'Recovery',    icon: '💾' },
  devconsole:  { label: 'Dev Console', icon: '⬡' },
  admin:       { label: 'Admin',       icon: '★' },
  benchmark:   { label: 'Benchmark',   icon: '◈' },
  aimarket:    { label: 'AI Market',   icon: '◎' },
  aibench:     { label: 'AI Bench',    icon: '◈' },
  automation:  { label: 'Automation',  icon: '⬢' },
  creative:    { label: 'Creative',    icon: '✦' },
};

const api        = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// ── Panel skeleton ─────────────────────────────────────────────────────
const PanelSkeleton = memo(function PanelSkeleton({ lines = 6, label }) {
  return (
    <div className="ew-skeleton">
      {label && <div className="ew-skeleton__label">{label}</div>}
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="ew-skeleton__line" style={{ width: `${60 + (i % 3) * 15}%` }} />
      ))}
    </div>
  );
});

// ── Empty state ────────────────────────────────────────────────────────
const EmptyPane = memo(function EmptyPane({ icon = '◻', label }) {
  return (
    <div className="ew-empty">
      <div className="ew-empty__icon">{icon}</div>
      {label && <div className="ew-empty__label">{label}</div>}
    </div>
  );
});

// ── LazyPane — keeps panel mounted after first show, hides via CSS ──────
const LazyPane = memo(function LazyPane({ active, children, minHeight }) {
  const { everShown } = useLazyPanel(active);
  return (
    <div style={{ display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight }}>
      {everShown && (
        <Suspense fallback={<PanelSkeleton />}>
          {children}
        </Suspense>
      )}
    </div>
  );
});

// ── Activity button ────────────────────────────────────────────────────
const ActivityBtn = memo(function ActivityBtn({ active, onClick, title, children, shortcut }) {
  return (
    <button
      className={`ew-activity-btn${active ? ' ew-activity-btn--active' : ''}`}
      onClick={onClick}
      title={shortcut ? `${title} (⌘${shortcut})` : title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
});

// ── Bottom tab button ──────────────────────────────────────────────────
const BottomTabBtn = memo(function BottomTabBtn({ active, onClick, icon, label, onDock }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      className={`ew-bottom-tab${active ? ' ew-bottom-tab--active' : ''}`}
      onClick={onClick}
    >
      {icon} {label}
      {active && onDock && (
        <span
          className="ew-dock-btn"
          title="Dock to floating window"
          onClick={(e) => { e.stopPropagation(); onDock(); }}
        >⧉</span>
      )}
    </button>
  );
});

// ── Session restore helpers ────────────────────────────────────────────
const SESSION_KEY = 'workspace-session';

async function loadSession() {
  if (!window.electronAPI?.isElectron) return null;
  try {
    const r = await window.electronAPI.storeGet(SESSION_KEY);
    return r?.value || null;
  } catch { return null; }
}

async function saveSession(state) {
  if (!window.electronAPI?.isElectron) return;
  try {
    await window.electronAPI.storeSet(SESSION_KEY, state);
  } catch {}
}

// ── Recent missions hook ───────────────────────────────────────────────
const RECENT_MISSIONS_KEY = 'recent-missions';
const RECENT_REPOS_KEY    = 'recent-repos';

function useRecentMissions() {
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_MISSIONS_KEY) || '[]'); } catch { return []; }
  });

  const push = useCallback((mission) => {
    setRecents(prev => {
      const filtered = prev.filter(m => m.id !== mission.id);
      const next = [{ id: mission.id, title: mission.title || mission.name || mission.goal, ts: Date.now() }, ...filtered].slice(0, 8);
      try { localStorage.setItem(RECENT_MISSIONS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { recents, push };
}

function useRecentRepos() {
  const [repos, setRepos] = useState([]);

  // Load from electron store (persists across launches) + localStorage fallback
  useEffect(() => {
    if (isElectron()) {
      api()?.getRecentProjects?.().then(r => {
        if (r?.projects?.length) setRepos(r.projects);
      }).catch(() => {});
    }
    try {
      const local = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) || '[]');
      if (local.length) setRepos(prev => {
        const paths = new Set(prev.map(p => p.path));
        return [...prev, ...local.filter(l => !paths.has(l.path))].slice(0, 10);
      });
    } catch {}
  }, []);

  const push = useCallback((repo) => {
    setRepos(prev => {
      const filtered = prev.filter(r => r.path !== repo.path);
      const next = [{ path: repo.path, name: repo.name || repo.path.split('/').pop(), ts: Date.now() }, ...filtered].slice(0, 10);
      try { localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(next)); } catch {}
      if (isElectron()) api()?.addRecentProject?.(repo.path, repo.name).catch(() => {});
      return next;
    });
  }, []);

  return { repos, push };
}

// ── Quick Switcher (Cmd+P) ─────────────────────────────────────────────
const _QS_BASE = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');

const QuickSwitcher = memo(function QuickSwitcher({ open, onClose, onSelect, recentMissions, recentRepos }) {
  const [query,       setQuery]       = useState('');
  const [cursor,      setCursor]      = useState(0);
  const [liveMissions, setLiveMissions] = useState([]);
  const inputRef = useRef(null);
  const debounce = useRef(null);

  useEffect(() => {
    if (open) { setQuery(''); setCursor(0); setLiveMissions([]); setTimeout(() => inputRef.current?.focus(), 40); }
  }, [open]);

  // Live mission search from backend
  useEffect(() => {
    if (!query.trim()) { setLiveMissions([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`${_QS_BASE}/missions?search=${encodeURIComponent(query)}&limit=6`, { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        const list = d.missions || d || [];
        setLiveMissions(list.slice(0, 6));
      } catch {}
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const items = React.useMemo(() => {
    const liveMissionItems = liveMissions.map(m => ({
      type: 'mission', id: `lm:${m.id}`, label: m.title || m.objective || `Mission ${m.id}`,
      sub: m.status, icon: '◎', data: m,
    }));
    const all = [
      ...recentMissions.map(m => ({ type: 'mission', id: `m:${m.id}`, label: m.title || `Mission ${m.id}`, icon: '◎', data: m })),
      ...recentRepos.map(r => ({ type: 'repo', id: `r:${r.path}`, label: r.name, sub: r.path, icon: '📁', data: r })),
      ...Object.entries(BOTTOM_TABS).map(([id, cfg]) => ({ type: 'panel', id: `p:${id}`, label: cfg.label, icon: cfg.icon, panelId: id })),
      ...Object.entries(SIDEBAR_MODES).map(([id, cfg]) => ({ type: 'sidebar', id: `s:${id}`, label: cfg.title, icon: cfg.icon, sidebarId: id })),
    ];
    if (!query.trim()) return all.slice(0, 12);
    const q = query.toLowerCase();
    const filtered = all.filter(i => i.label.toLowerCase().includes(q) || (i.sub || '').toLowerCase().includes(q));
    // Merge live results, dedup by id
    const seen = new Set(filtered.map(x => x.id));
    const merged = [...filtered, ...liveMissionItems.filter(x => !seen.has(x.id))];
    return merged.slice(0, 14);
  }, [query, recentMissions, recentRepos, liveMissions]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, items.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (items[cursor]) { onSelect(items[cursor]); onClose(); } }
    if (e.key === 'Escape')    { onClose(); }
  };

  if (!open) return null;

  return (
    <div className="ew-qs-backdrop" onClick={onClose}>
      <div className="ew-qs-modal" onClick={e => e.stopPropagation()}>
        <div className="ew-qs-header">
          <span className="ew-qs-icon">⌘</span>
          <input
            ref={inputRef}
            className="ew-qs-input"
            placeholder="Go to mission, repo, panel… (⌘P)"
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="ew-qs-close" onClick={onClose}>Esc</button>
        </div>
        <div className="ew-qs-list">
          {items.length === 0 && (
            <div className="ew-qs-empty">
              <div>No matches for "{query}"</div>
              <div className="ew-qs-empty__hint">Try: mission name, panel name, or file path</div>
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`ew-qs-item${i === cursor ? ' ew-qs-item--active' : ''}`}
              onClick={() => { onSelect(item); onClose(); }}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="ew-qs-item__icon">{item.icon}</span>
              <div className="ew-qs-item__text">
                <span className="ew-qs-item__label">{item.label}</span>
                {item.sub && <span className="ew-qs-item__sub">{item.sub}</span>}
              </div>
              <span className="ew-qs-item__type">{item.type}</span>
            </div>
          ))}
        </div>
        <div className="ew-qs-footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
});

// ── Floating docked panel ──────────────────────────────────────────────
// Opens a bottom-panel tab in a floating Electron window
function dockTabToFloat(tabId) {
  if (!isElectron()) return;
  // Use broadcast + createFloatingWindow — the floating window renders in mode=floating
  // which App.jsx routes to the appropriate panel via ?mode=floating&panel=<tabId>
  api()?.createFloatingWindow?.();
}

// ── Main component ─────────────────────────────────────────────────────
export default function ElectronWorkspace({ children }) {
  const [searchOpen,    setSearchOpen]    = useState(false);
  const [switcherOpen,  setSwitcherOpen]  = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aiCollapsed,   setAiCollapsed]   = useState(false);
  const [sidebarMode,   setSidebarMode]   = useState('explorer');
  const [showSidebar,   setShowSidebar]   = useState(true);
  const [showBottom,    setShowBottom]    = useState(false);
  const [bottomTab,     setBottomTab]     = useState('terminal');
  const [showAI,        setShowAI]        = useState(true);
  const [cwd,           setCwd]           = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [splitLayout,   setSplitLayout]   = useState(false); // center horizontal split
  const [splitContent,  setSplitContent]  = useState('missions'); // what fills the split bottom pane
  // Operator OS home — 'os' = Mission Control; 'editor' = Code Editor; anything else = App tab name
  const [osView,        setOsView]        = useState('os');
  // J2 code editor
  const [editorFile,    setEditorFile]    = useState(null); // path to open
  const [missionJump,   setMissionJump]   = useState(null); // { filePath, startLine, endLine }
  const [gitChangedCount, setGitChangedCount] = useState(0);
  const [editorSymbols,   setEditorSymbols]   = useState([]);
  const [editorSymFile,   setEditorSymFile]   = useState('');
  const [showTemplates,   setShowTemplates]   = useState(false);

  const { height: bottomH,   onResizerMouseDown: onBottomResize }  = useBottomResize(340);
  const { width:  sidebarW,  onResizerMouseDown: onSidebarResize, onResizerDoubleClick: onSidebarReset } = useSidebarResize(260);
  const { pct: splitPct, containerRef: splitRef, onResizerMouseDown: onSplitResize } = useCenterSplitResize(55);

  const { recents: recentMissions, push: pushMission } = useRecentMissions();
  const { repos: recentRepos, push: pushRepo }         = useRecentRepos();

  // ── Git changed-files badge ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => setGitChangedCount(e.detail?.changed || 0);
    window.addEventListener('git-status-update', handler);
    return () => window.removeEventListener('git-status-update', handler);
  }, []);

  // ── Symbol index from active editor ─────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      setEditorSymbols(e.detail?.symbols || []);
      setEditorSymFile(e.detail?.filePath || '');
    };
    window.addEventListener('symbol-index-update', handler);
    return () => window.removeEventListener('symbol-index-update', handler);
  }, []);

  // ── Restore session on mount ─────────────────────────────────────
  useEffect(() => {
    if (!isElectron()) { setSessionLoaded(true); return; }
    loadSession().then(s => {
      if (s) {
        if (s.sidebarMode)  setSidebarMode(s.sidebarMode);
        if (s.showSidebar !== undefined) setShowSidebar(s.showSidebar);
        if (s.showBottom  !== undefined) setShowBottom(s.showBottom);
        if (s.bottomTab)    setBottomTab(s.bottomTab);
        if (s.showAI      !== undefined) setShowAI(s.showAI);
        if (s.aiCollapsed !== undefined) setAiCollapsed(s.aiCollapsed);
        if (s.splitLayout !== undefined) setSplitLayout(s.splitLayout);
        if (s.splitContent) setSplitContent(s.splitContent);
        if (s.cwd)          setCwd(s.cwd);
        setOsView(s.osView || 'os');
      }
      setSessionLoaded(true);
    });
  }, []); // eslint-disable-line

  // ── Persist session on any layout change ─────────────────────────
  useEffect(() => {
    if (!sessionLoaded) return;
    const timer = setTimeout(() => {
      saveSession({ sidebarMode, showSidebar, showBottom, bottomTab, showAI, aiCollapsed, osView, splitLayout, splitContent, cwd });
    }, 500);
    return () => clearTimeout(timer);
  }, [sidebarMode, showSidebar, showBottom, bottomTab, showAI, aiCollapsed, osView, splitLayout, splitContent, cwd, sessionLoaded]);

  // Resolve CWD on startup — restore from session first, fall back to home
  useEffect(() => {
    if (!isElectron() || cwd) return;
    api()?.fsGetHomePath?.().then(r => r?.path && setCwd(r.path));
  }, []); // eslint-disable-line

  // Track project changes → recent repos
  useEffect(() => {
    if (cwd) pushRepo({ path: cwd, name: cwd.split('/').pop() });
  }, [cwd]); // eslint-disable-line

  // Sidebar toggle — stable, no re-renders on consumers
  // 'intelligence' opens the J4 Engineering Intelligence center pane instead of a sidebar
  const setSidebar = useStableCallback((mode) => {
    if (mode === 'intelligence') {
      setOsView(v => v === 'intelligence' ? 'os' : 'intelligence');
      return;
    }
    setSidebarMode(prev => {
      if (prev === mode && showSidebar) { setShowSidebar(false); return prev; }
      setShowSidebar(true);
      return mode;
    });
  });

  const openBottomTab = useStableCallback((tab) => {
    setBottomTab(tab);
    setShowBottom(true);
  });

  // ── Quick Switcher handler ────────────────────────────────────────
  const handleQuickSwitch = useStableCallback((item) => {
    if (item.type === 'panel')   { openBottomTab(item.panelId); return; }
    if (item.type === 'sidebar') { setSidebar(item.sidebarId); return; }
    if (item.type === 'repo')    { setCwd(item.data.path); setSidebar('explorer'); return; }
    if (item.type === 'mission') {
      setOsView('os');
      window.dispatchEvent(new CustomEvent('jarvis-os-nav', { detail: { tab: 'jarvisbrain', mission: item.data } }));
    }
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.metaKey || e.ctrlKey;

      // Cmd+? — keyboard shortcuts overlay (must check before ctrl guard)
      if (ctrl && e.shiftKey && e.key === '/') { e.preventDefault(); setShortcutsOpen(s => !s); return; }

      if (!ctrl) return;

      // Cmd+K — global search
      if (e.key === 'k' && !e.shiftKey) { e.preventDefault(); setSearchOpen(s => !s); return; }

      // Cmd+P — quick switcher
      if (e.key === 'p' && !e.shiftKey) { e.preventDefault(); setSwitcherOpen(s => !s); return; }

      // Cmd+\ — toggle split layout
      if (e.key === '\\') { e.preventDefault(); setSplitLayout(s => !s); return; }

      // Cmd+Shift+` — toggle bottom panel
      if (e.shiftKey && e.key === '`') { e.preventDefault(); setShowBottom(s => !s); return; }

      // Cmd+B — toggle sidebar (VSCode convention)
      if (e.key === 'b' && !e.shiftKey) { e.preventDefault(); setShowSidebar(s => !s); return; }

      // Cmd+Shift+E/F/G/S/D/P/M/T — sidebar/panel shortcuts
      if (e.shiftKey && e.key === 'E')  { e.preventDefault(); setSidebar('explorer'); return; }
      if (e.shiftKey && e.key === 'F')  { e.preventDefault(); setSidebar('code'); return; }
      if (e.shiftKey && e.key === 'G')  { e.preventDefault(); setSidebar('git'); return; }
      if (e.shiftKey && e.key === 'S')  { e.preventDefault(); setSidebar('symbols'); return; }
      if (e.shiftKey && e.key === 'D')  { e.preventDefault(); openBottomTab('debugger'); return; }
      if (e.shiftKey && e.key === 'P')  { e.preventDefault(); openBottomTab('pair'); return; }
      if (e.shiftKey && e.key === 'M')  { e.preventDefault(); openBottomTab('missions'); return; }
      if (e.shiftKey && e.key === 'T')  { e.preventDefault(); openBottomTab('terminal'); return; }

      // Cmd+1..6 — sidebar mode by position
      const sidebarKeys = Object.keys(SIDEBAR_MODES);
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= sidebarKeys.length && !e.shiftKey) {
        e.preventDefault();
        setSidebar(sidebarKeys[num - 1]);
      }
    };

    const escHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (shortcutsOpen) { setShortcutsOpen(false); return; }
      if (switcherOpen || searchOpen) return;
      if (showBottom) { setShowBottom(false); }
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', escHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', escHandler);
    };
  }, [setSidebar, openBottomTab, switcherOpen, searchOpen, showBottom, shortcutsOpen]);

  // Native menu actions
  useEffect(() => {
    if (!isElectron()) return;
    const unsub = api()?.onMenuAction?.((action) => {
      switch (action) {
        case 'open-command-palette': setSearchOpen(true); break;
        case 'toggle-sidebar':       setShowSidebar(s => !s); break;
        case 'toggle-terminal':      openBottomTab('terminal'); break;
        case 'toggle-ai':            setShowAI(s => !s); break;
        case 'toggle-git':           setSidebar('git'); break;
        case 'toggle-debugger':      openBottomTab('debugger'); break;
        case 'toggle-pair':          openBottomTab('pair'); break;
        case 'home':                 setOsView('os'); break;
        default: break;
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [openBottomTab, setSidebar]);

  // Navigate Operator OS center view
  const navigateOs = useStableCallback((view) => {
    setOsView(view);
    if (view !== 'os') {
      window.dispatchEvent(new CustomEvent('jarvis-os-nav', { detail: view }));
    }
  });

  // J2: open file in code editor
  const handleFileOpen = useStableCallback((filePath) => {
    setEditorFile(filePath);
    setOsView('editor');
  });

  // J2: mission jump-to-line (from mission runtime events)
  useEffect(() => {
    const handler = (e) => {
      const { filePath, startLine, endLine } = e.detail || {};
      if (!filePath) return;
      setMissionJump({ filePath, startLine, endLine });
      setEditorFile(filePath);
      setOsView('editor');
    };
    window.addEventListener('cep-jump', handler);
    window.addEventListener('jarvis-mission-jump', handler);
    return () => {
      window.removeEventListener('cep-jump', handler);
      window.removeEventListener('jarvis-mission-jump', handler);
    };
  }, []);

  // Open AI Pair panel when editor right-click fires a capability with a selection
  useEffect(() => {
    const handler = (e) => {
      const { payload } = e.detail || {};
      if (payload?.selection) openBottomTab('pair');
    };
    window.addEventListener('jarvis-capability', handler);
    return () => window.removeEventListener('jarvis-capability', handler);
  }, [openBottomTab]);

  // Breadcrumb "⬡ AI" button and direct event-based tab open
  useEffect(() => {
    const handler = (e) => openBottomTab(e.detail || 'pair');
    window.addEventListener('ew-open-bottom-tab', handler);
    return () => window.removeEventListener('ew-open-bottom-tab', handler);
  }, [openBottomTab]);

  // Global search action handler
  const handleAction = useStableCallback((action, item) => {
    switch (action) {
      case 'nav:terminal':     openBottomTab('terminal'); break;
      case 'nav:explorer':     setSidebar('explorer'); break;
      case 'nav:console':      openBottomTab('console'); break;
      case 'nav:ai':           setShowAI(true); setAiCollapsed(false); break;
      case 'nav:editor':       setOsView('editor'); setSidebar('code'); break;
      case 'nav:intelligence': setOsView('intelligence'); break;
      case 'nav:clipboard':    setSidebar('clipboard'); break;
      case 'nav:git':          setSidebar('git'); break;
      case 'nav:search':       setSidebar('code'); break;
      case 'nav:symbols':      setSidebar('symbols'); break;
      case 'nav:debugger':     openBottomTab('debugger'); break;
      case 'nav:pair':         openBottomTab('pair'); break;
      case 'nav:ops':          openBottomTab('ops'); break;
      case 'nav:arch':         openBottomTab('arch'); break;
      case 'nav:productivity': setSidebar('productivity'); break;
      case 'nav:home':         setOsView('os'); break;
      case 'nav:tab':
        if (item?.tab) {
          setOsView('os');
          window.dispatchEvent(new CustomEvent('jarvis-os-nav', { detail: item.tab }));
          // Track recent missions
          if (item.type === 'mission' && item.data) pushMission(item.data);
        }
        break;
      case 'open-search': setSearchOpen?.(true); break;
      case 'screenshot':
        api()?.screenshotWindow?.().then(p => {
          if (p) api()?.showNotification?.({ title: 'Screenshot saved', body: p });
        });
        break;
      case 'settings':     api()?.openSettings?.(); break;
      case 'update':       api()?.checkForUpdates?.(); break;
      case 'nav:missions': openBottomTab('missions'); break;
      case 'open-folder':
        api()?.fsShowOpenDialog?.({ properties: ['openDirectory'] }).then(result => {
          const p = result?.filePaths?.[0];
          if (p) { setCwd(p); pushRepo({ path: p, name: p.split('/').pop(), id: Date.now(), ts: Date.now() }); setSidebar('explorer'); }
        });
        break;
      default: break;
    }
  });

  // Browser passthrough — no workspace chrome in web mode
  if (!isElectron()) return <>{children}</>;

  return (
    <div className="ew-shell">
      {/* Activity bar */}
      <div className="ew-activity" role="toolbar" aria-label="Activity bar">
        {/* Mission Control home */}
        <ActivityBtn
          active={osView === 'os'}
          onClick={() => setOsView('os')}
          title="Mission Control (Operator OS Home)"
        >
          ⬡
        </ActivityBtn>
        <div className="ew-activity__separator" />
        {Object.entries(SIDEBAR_MODES).map(([mode, cfg]) => (
          <ActivityBtn
            key={mode}
            active={showSidebar && sidebarMode === mode}
            onClick={() => setSidebar(mode)}
            title={cfg.title}
            shortcut={cfg.shortcut}
          >
            {cfg.icon}
            {mode === 'git' && gitChangedCount > 0 && (
              <span className="ew-activity__badge">{gitChangedCount > 99 ? '99+' : gitChangedCount}</span>
            )}
          </ActivityBtn>
        ))}
        <div className="ew-activity__spacer" />

        {/* Split layout toggle */}
        <ActivityBtn
          active={splitLayout}
          onClick={() => setSplitLayout(s => !s)}
          title="Split editor layout (⌘\)"
        >
          ⊟
        </ActivityBtn>

        {Object.entries(BOTTOM_TABS).map(([id, cfg]) => (
          <ActivityBtn
            key={id}
            active={showBottom && bottomTab === id}
            onClick={() => openBottomTab(id)}
            title={cfg.label}
          >
            {cfg.icon}
          </ActivityBtn>
        ))}
        <ActivityBtn active={showAI} onClick={() => setShowAI(s => !s)} title="AI Overlay">✨</ActivityBtn>
        {/* Quick switcher shortcut */}
        <ActivityBtn active={switcherOpen} onClick={() => setSwitcherOpen(true)} title="Quick Switcher (⌘P)">⌘</ActivityBtn>
        <ActivityBtn active={false} onClick={() => setSearchOpen(true)} title="Global Search (⌘K)">⌕</ActivityBtn>
        <ActivityBtn active={shortcutsOpen} onClick={() => setShortcutsOpen(s => !s)} title="Keyboard Shortcuts (⌘⇧/)">?</ActivityBtn>
      </div>

      {/* Main workspace */}
      <div className="ew-main">
        {/* Left sidebar — all modes always mounted after first visit */}
        {showSidebar && (
          <>
            <div className="ew-sidebar" style={{ width: sidebarW }}>
              <div className="ew-sidebar__header">
                <span className="ew-sidebar__title">{SIDEBAR_MODES[sidebarMode]?.title}</span>
                <button className="ew-sidebar__close" onClick={() => setShowSidebar(false)} aria-label="Close sidebar">✕</button>
              </div>
              <div className="ew-sidebar__body">
                <LazyPane active={sidebarMode === 'explorer'}>
                  <ErrorBoundary label="File Explorer">
                    <div className="ew-explorer-wrap">
                      {recentRepos.length > 1 && (
                        <div className="ew-recent-repos">
                          <span className="ew-recent-repos__label">Recent</span>
                          <div className="ew-recent-repos__list">
                            {recentRepos.slice(0, 5).map(r => (
                              <button
                                key={r.path}
                                className={`ew-recent-repo-btn${r.path === cwd ? ' ew-recent-repo-btn--active' : ''}`}
                                title={r.path}
                                onClick={() => { setCwd(r.path); pushRepo(r); }}
                              >
                                <span className="ew-recent-repo-icon">📁</span>
                                <span className="ew-recent-repo-name">{r.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <FileExplorer
                        cwd={cwd}
                        onFileOpen={handleFileOpen}
                        onOpenFolder={async () => {
                          const result = await api().fsShowOpenDialog({ properties: ['openDirectory'] });
                          const p = result?.filePaths?.[0];
                          if (p) { setCwd(p); pushRepo({ path: p, name: p.split('/').pop(), id: Date.now(), ts: Date.now() }); }
                        }}
                      />
                    </div>
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'code'}>
                  <ErrorBoundary label="Project Search">
                    <Suspense fallback={<PanelSkeleton />}>
                      <ProjectSearch
                        cwd={cwd}
                        onJumpToFile={(file, line) => {
                          setMissionJump({ filePath: file, startLine: line });
                          handleFileOpen(file);
                        }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'git'}>
                  <ErrorBoundary label="Visual Git">
                    <VisualGit cwd={cwd} />
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'symbols'}>
                  <ErrorBoundary label="Symbol Outline">
                    <Suspense fallback={<PanelSkeleton />}>
                      <SymbolPanel
                        symbols={editorSymbols}
                        filePath={editorSymFile}
                        onJump={(sym) => {
                          if (sym.filePath) handleFileOpen(sym.filePath);
                          setMissionJump({ filePath: sym.filePath || editorSymFile, startLine: sym.line });
                        }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'clipboard'}>
                  <ErrorBoundary label="Clipboard">
                    <ClipboardHistoryPanel onClose={() => setShowSidebar(false)} />
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'productivity'}>
                  <ErrorBoundary label="Workspace">
                    <Suspense fallback={<PanelSkeleton />}>
                      <WorkspaceProductivity
                        onProjectSwitch={p => { setCwd(p.path); pushRepo(p); setSidebar('explorer'); }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'intelligence'}>
                  <ErrorBoundary label="Intelligence Overlay">
                    <IntelligenceOverlay />
                  </ErrorBoundary>
                </LazyPane>
              </div>
            </div>
            {/* Sidebar resize handle — double-click to reset to default width */}
            <div className="ew-sidebar-resizer" onMouseDown={onSidebarResize} onDoubleClick={onSidebarReset} title="Drag to resize · Double-click to reset" />
          </>
        )}

        {/* Center column */}
        <div className="ew-center" ref={splitRef}>
          {/* OS home button — shown when not on Mission Control */}
          {osView !== 'os' && (
            <div className="ew-topbar">
              <button className="ew-os-home-btn" onClick={() => setOsView('os')} title="Back to Mission Control">
                ⬡ Mission Control
              </button>
              {osView === 'editor' && (
                <>
                  <span className="ew-topbar__sep">›</span>
                  <span className="ew-topbar__view">Code Editor</span>
                </>
              )}
              {osView === 'intelligence' && (
                <>
                  <span className="ew-topbar__sep">›</span>
                  <span className="ew-topbar__view">Engineering Intelligence</span>
                </>
              )}
            </div>
          )}

          {/* Split layout or normal content */}
          <div className={`ew-content${splitLayout ? ' ew-content--split' : ''}`}
               style={splitLayout ? { display: 'flex', flexDirection: 'column' } : {}}>
            {splitLayout ? (
              <>
                {/* Top pane — primary content */}
                <div style={{ flex: 'none', height: `${splitPct}%`, overflow: 'hidden', minHeight: 80 }}>
                  {showTemplates
                    ? <ErrorBoundary label="Workspace Templates"><Suspense fallback={null}><WorkspaceTemplates onOpenFolder={(path) => { setCwd(path); setShowTemplates(false); }} onDismiss={() => setShowTemplates(false)} /></Suspense></ErrorBoundary>
                    : osView === 'os'
                    ? <ErrorBoundary label="Mission Control"><MissionControl onNavigate={navigateOs} /></ErrorBoundary>
                    : osView === 'editor'
                    ? (
                      <ErrorBoundary label="Code Editor">
                        <Suspense fallback={<PanelSkeleton label="Code Editor" />}>
                          <CodeEditorPane
                            initialPath={editorFile}
                            missionJump={missionJump}
                            onOpenMission={() => setOsView('os')}
                            cwd={cwd}
                            onRunInTerminal={() => openBottomTab('terminal')}
                          />
                        </Suspense>
                      </ErrorBoundary>
                    )
                    : osView === 'intelligence'
                    ? (
                      <ErrorBoundary label="Engineering Intelligence">
                        <Suspense fallback={<PanelSkeleton label="Engineering Intelligence" />}>
                          <EngineeringIntelligencePane style={{ height: '100%' }} />
                        </Suspense>
                      </ErrorBoundary>
                    )
                    : children
                  }
                </div>
                {/* Split handle */}
                <div className="ew-split-resizer" onMouseDown={onSplitResize} />
                {/* Bottom pane — secondary content (missions by default) */}
                <div style={{ flex: 1, overflow: 'hidden', minHeight: 60 }}>
                  <div className="ew-split-tab-bar">
                    {['missions', 'terminal', 'console', 'observer'].map(id => (
                      <button
                        key={id}
                        className={`ew-split-tab${splitContent === id ? ' ew-split-tab--active' : ''}`}
                        onClick={() => setSplitContent(id)}
                      >
                        {BOTTOM_TABS[id]?.icon} {BOTTOM_TABS[id]?.label || id}
                      </button>
                    ))}
                    <button className="ew-split-close" onClick={() => setSplitLayout(false)}>✕ unsplit</button>
                  </div>
                  <div style={{ height: 'calc(100% - 28px)', overflow: 'hidden' }}>
                    <LazyPane active={splitContent === 'missions'}>
                      <ErrorBoundary label="Mission Engine"><MissionEngine /></ErrorBoundary>
                    </LazyPane>
                    <LazyPane active={splitContent === 'terminal'}>
                      <ErrorBoundary label="Terminal"><TerminalPanel cwd={cwd} /></ErrorBoundary>
                    </LazyPane>
                    <LazyPane active={splitContent === 'console'}>
                      <ErrorBoundary label="Console"><EngineeringConsole /></ErrorBoundary>
                    </LazyPane>
                    <LazyPane active={splitContent === 'observer'}>
                      <ErrorBoundary label="Observer"><RuntimeObserverPanel /></ErrorBoundary>
                    </LazyPane>
                  </div>
                </div>
              </>
            ) : showTemplates ? (
              <ErrorBoundary label="Workspace Templates">
                <Suspense fallback={<PanelSkeleton label="Templates" />}>
                  <WorkspaceTemplates
                    onOpenFolder={(path) => { setCwd(path); pushRepo({ path, name: path.split('/').pop() }); setSidebar('explorer'); }}
                    onDismiss={() => setShowTemplates(false)}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : osView === 'os' ? (
              <ErrorBoundary label="Mission Control">
                <MissionControl onNavigate={navigateOs} />
              </ErrorBoundary>
            ) : osView === 'editor' ? (
              <ErrorBoundary label="Code Editor">
                <Suspense fallback={<PanelSkeleton label="Code Editor" />}>
                  <CodeEditorPane
                    initialPath={editorFile}
                    missionJump={missionJump}
                    onOpenMission={() => setOsView('os')}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : osView === 'intelligence' ? (
              <ErrorBoundary label="Engineering Intelligence">
                <Suspense fallback={<PanelSkeleton label="Engineering Intelligence" />}>
                  <EngineeringIntelligencePane style={{ height: '100%' }} />
                </Suspense>
              </ErrorBoundary>
            ) : children}
          </div>

          {/* Mission Dock — always visible when in editor view */}
          {osView === 'editor' && (
            <Suspense fallback={null}>
              <MissionDock onNavigate={(tab) => window.dispatchEvent(new CustomEvent('jarvis-nav', { detail: tab }))} />
            </Suspense>
          )}

          {/* Bottom panel */}
          {showBottom && (
            <>
              <div className="ew-bottom-resizer" onMouseDown={onBottomResize} />
              <div className="ew-bottom" style={{ height: bottomH, flexShrink: 0 }}>
                <div className="ew-bottom__tabs" role="tablist" aria-label="Bottom panel tabs">
                  {Object.entries(BOTTOM_TABS).map(([id, cfg]) => (
                    <BottomTabBtn
                      key={id}
                      active={bottomTab === id}
                      onClick={() => setBottomTab(id)}
                      icon={cfg.icon}
                      label={cfg.label}
                      onDock={bottomTab === id ? () => dockTabToFloat(id) : null}
                    />
                  ))}
                  <div style={{ flex: 1 }} />
                  <button className="ew-bottom-close" onClick={() => setShowBottom(false)} aria-label="Close panel">✕</button>
                </div>
                <div className="ew-bottom__body">
                  <LazyPane active={bottomTab === 'terminal'}>
                    <ErrorBoundary label="Terminal"><TerminalPanel cwd={cwd} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'console'}>
                    <ErrorBoundary label="Engineering Console"><EngineeringConsole /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'debugger'}>
                    <ErrorBoundary label="Debugger"><RuntimeDebugger /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'ops'}>
                    <ErrorBoundary label="Auto-Ops"><AutonomousOps /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'arch'}>
                    <ErrorBoundary label="Architecture"><VisualArchitecture /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'pair'}>
                    <ErrorBoundary label="AI Pair"><AIPairProgramming cwd={cwd} filePath={editorFile} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'agents'}>
                    <ErrorBoundary label="Live Agents"><LiveAgentCollaboration /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'missions'}>
                    <ErrorBoundary label="Mission Engine"><MissionEngine /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'command'}>
                    <ErrorBoundary label="Operator Command"><OperatorCommandLayer /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'execloop'}>
                    <ErrorBoundary label="Executive Loop"><ExecutiveLoop /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'observer'}>
                    <ErrorBoundary label="Runtime Observer"><RuntimeObserverPanel /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'decisions'}>
                    <ErrorBoundary label="Decision Engine"><DecisionQueuePanel /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'orchestrator'}>
                    <ErrorBoundary label="Mission Orchestrator"><MissionOrchestratorPanel /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'execution'}>
                    <ErrorBoundary label="Execution Runtime"><ExecutionRuntimePanel /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'blame'}>
                    <ErrorBoundary label="Git Blame"><GitBlame filePath={editorFile} cwd={cwd} lineCount={500} visible={bottomTab === 'blame'} onViewHistory={() => openBottomTab('missions')} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'push'}>
                    <ErrorBoundary label="Quick Push"><QuickPush cwd={cwd} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'health'}>
                    <ErrorBoundary label="Workspace Health"><WorkspaceHealth cwd={cwd} filePath={editorFile} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'devdash'}>
                    <ErrorBoundary label="Dev Dashboard"><DevDashboard cwd={cwd} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'plugins'}>
                    <ErrorBoundary label="Plugin Marketplace"><PluginMarketplace /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'license'}>
                    <ErrorBoundary label="License Manager"><LicenseManager /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'perf'}>
                    <ErrorBoundary label="Performance Audit"><PerformanceAudit cwd={cwd} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'betaaudit'}>
                    <ErrorBoundary label="Beta Audit"><ClosedBetaAudit /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'recovery'}>
                    <ErrorBoundary label="Recovery"><WorkspaceRecovery currentSession={{ cwd, osView, bottomTab, sidebarMode }} /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'devconsole'}>
                    <ErrorBoundary label="Developer Console"><DeveloperConsole /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'admin'}>
                    <ErrorBoundary label="Admin Dashboard"><AdminDashboard /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'benchmark'}>
                    <ErrorBoundary label="Commercial Benchmark"><CommercialBenchmark /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'aimarket'}>
                    <ErrorBoundary label="AI Marketplace"><AIMarketplace /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'aibench'}>
                    <ErrorBoundary label="AI Benchmark Lab"><AIBenchmarkLab /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'automation'}>
                    <ErrorBoundary label="Automation Dashboard"><AutomationDashboard /></ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'creative'}>
                    <ErrorBoundary label="Creative Studio"><CreativeStudio /></ErrorBoundary>
                  </LazyPane>
                </div>
              </div>
            </>
          )}
        </div>

        {/* AI sidebar */}
        {showAI && (
          <LazyPane active={showAI}>
            <ErrorBoundary label="AI Overlay">
              <AIOverlay
                collapsed={aiCollapsed}
                onToggle={() => setAiCollapsed(c => !c)}
                className="ew-ai-sidebar"
              />
            </ErrorBoundary>
          </LazyPane>
        )}
      </div>

      {/* Quick Switcher (Cmd+P) */}
      <QuickSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        onSelect={handleQuickSwitch}
        recentMissions={recentMissions}
        recentRepos={recentRepos}
      />

      {/* Global search — separate Suspense so it doesn't block the shell */}
      <Suspense fallback={null}>
        <GlobalSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onAction={handleAction}
          recentMissions={recentMissions}
          recentRepos={recentRepos}
        />
      </Suspense>

      {/* Keyboard Shortcuts Overlay (⌘⇧/) */}
      {shortcutsOpen && (
        <WorkspaceShortcutsOverlay onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}

// ── Workspace Keyboard Shortcuts Overlay ──────────────────────────────
const WS_SHORTCUTS = [
  { group: 'Navigation', rows: [
    { keys: '⌘K',       desc: 'Global search' },
    { keys: '⌘P',       desc: 'Quick switcher (files, missions, panels)' },
    { keys: '⌘B',       desc: 'Toggle sidebar' },
    { keys: '⌘1–6',     desc: 'Switch sidebar panel (Files, Search, Git, Clipboard, Workspace, AI)' },
    { keys: '⌘⇧E',      desc: 'Files sidebar' },
    { keys: '⌘⇧G',      desc: 'Git sidebar' },
  ]},
  { group: 'Editor', rows: [
    { keys: '⌘S',       desc: 'Save file (auto-save also runs every 4s)' },
    { keys: '⌘W',       desc: 'Close tab' },
    { keys: '⌘⇧[',      desc: 'Previous tab' },
    { keys: '⌘⇧]',      desc: 'Next tab' },
    { keys: '⌃G',       desc: 'Go to line' },
    { keys: '⌘⇧W',      desc: 'Toggle word wrap' },
    { keys: '⌘F',       desc: 'Find in file' },
  ]},
  { group: 'Panels', rows: [
    { keys: '⌘⇧`',      desc: 'Toggle bottom panel' },
    { keys: '⌘⇧D',      desc: 'Debugger panel' },
    { keys: '⌘⇧P',      desc: 'AI Pair Programming' },
    { keys: '⌘\\',      desc: 'Toggle split layout' },
    { keys: 'Esc',       desc: 'Close bottom panel / overlays' },
  ]},
  { group: 'Git', rows: [
    { keys: '⌘⇧G',      desc: 'Open Git sidebar' },
    { keys: '⌘↵',       desc: 'Commit (in commit message textarea)' },
  ]},
  { group: 'File Explorer', rows: [
    { keys: '↑↓',        desc: 'Navigate files' },
    { keys: '↵',         desc: 'Open selected file' },
    { keys: 'Right-click', desc: 'New File, New Folder, Rename, Delete, Copy Path' },
  ]},
];

function WorkspaceShortcutsOverlay({ onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="ew-shortcuts-overlay" onClick={onClose}>
      <div className="ew-shortcuts-panel" onClick={e => e.stopPropagation()}>
        <div className="ew-shortcuts-header">
          <span className="ew-shortcuts-title">Workspace Keyboard Shortcuts</span>
          <button className="ew-shortcuts-close" onClick={onClose}><kbd>Esc</kbd></button>
        </div>
        <div className="ew-shortcuts-body">
          {WS_SHORTCUTS.map(group => (
            <div key={group.group} className="ew-shortcuts-group">
              <div className="ew-shortcuts-group-label">{group.group}</div>
              {group.rows.map(row => (
                <div key={row.desc} className="ew-shortcuts-row">
                  <span className="ew-shortcuts-desc">{row.desc}</span>
                  <kbd className="ew-shortcuts-keys">{row.keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="ew-shortcuts-footer">Press <kbd>⌘⇧/</kbd> to open · <kbd>Esc</kbd> to close</div>
      </div>
    </div>
  );
}
