import React, {
  useState, useCallback, useEffect, useRef,
  lazy, Suspense, memo,
} from 'react';
import { useLazyPanel } from '../hooks/useLazyPanel';
import { useStableCallback } from '../hooks/useStableCallback';
import ErrorBoundary from './ErrorBoundary';
import GlobalSearch, { ClipboardHistoryPanel } from './GlobalSearch';
import './ElectronWorkspace.css';

// ── Lazy imports — none of these load until first activated ───────────
const TerminalPanel        = lazy(() => import('./TerminalPanel'));
const FileExplorer         = lazy(() => import('./FileExplorer'));
const EngineeringConsole   = lazy(() => import('./EngineeringConsole'));
const AIOverlay            = lazy(() => import('./AIOverlay'));
const VisualGit            = lazy(() => import('./VisualGit'));
const AIPairProgramming    = lazy(() => import('./AIPairProgramming'));
const RuntimeDebugger      = lazy(() => import('./RuntimeDebugger'));
const VisualArchitecture   = lazy(() => import('./VisualArchitecture'));
const WorkspaceProductivity = lazy(() => import('./WorkspaceProductivity'));
const AutonomousOps        = lazy(() => import('./AutonomousOps'));

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

// ── Aliases for bottom (y-axis) and sidebar (x-axis) ─────────────────
function useBottomResize(initial = 340) {
  const { size: height, onResizerMouseDown } = useResize(initial, 140, 720, 'y');
  return { height, onResizerMouseDown };
}

function useSidebarResize(initial = 260) {
  const { size: width, onResizerMouseDown } = useResize(initial, 160, 520, 'x');
  return { width, onResizerMouseDown };
}

// ── Constants ──────────────────────────────────────────────────────────
const SIDEBAR_MODES = {
  explorer:     { label: 'Files',     icon: '📁', title: 'File Explorer' },
  git:          { label: 'Git',       icon: '🌿', title: 'Visual Git' },
  clipboard:    { label: 'Clipboard', icon: '📋', title: 'Clipboard History' },
  productivity: { label: 'Workspace', icon: '🗂',  title: 'Workspace' },
};

const BOTTOM_TABS = {
  terminal: { label: 'Terminal',  icon: '🖥' },
  console:  { label: 'Console',   icon: '📊' },
  debugger: { label: 'Debugger',  icon: '🔍' },
  ops:      { label: 'Auto-Ops',  icon: '🤖' },
  arch:     { label: 'Arch',      icon: '🗺' },
  pair:     { label: 'AI Pair',   icon: '💡' },
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
const ActivityBtn = memo(function ActivityBtn({ active, onClick, title, children }) {
  return (
    <button
      className={`ew-activity-btn${active ? ' ew-activity-btn--active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
});

// ── Bottom tab button ──────────────────────────────────────────────────
const BottomTabBtn = memo(function BottomTabBtn({ active, onClick, icon, label }) {
  return (
    <button
      className={`ew-bottom-tab${active ? ' ew-bottom-tab--active' : ''}`}
      onClick={onClick}
    >
      {icon} {label}
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

// ── Main component ─────────────────────────────────────────────────────
export default function ElectronWorkspace({ children }) {
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [aiCollapsed,  setAiCollapsed]  = useState(false);
  const [sidebarMode,  setSidebarMode]  = useState('explorer');
  const [showSidebar,  setShowSidebar]  = useState(true);
  const [showBottom,   setShowBottom]   = useState(false);
  const [bottomTab,    setBottomTab]    = useState('terminal');
  const [showAI,       setShowAI]       = useState(true);
  const [cwd,          setCwd]          = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const { height: bottomH,   onResizerMouseDown: onBottomResize }  = useBottomResize(340);
  const { width:  sidebarW,  onResizerMouseDown: onSidebarResize } = useSidebarResize(260);

  // ── Restore session on mount ─────────────────────────────────────
  useEffect(() => {
    if (!isElectron()) { setSessionLoaded(true); return; }
    loadSession().then(s => {
      if (s) {
        if (s.sidebarMode) setSidebarMode(s.sidebarMode);
        if (s.showSidebar !== undefined) setShowSidebar(s.showSidebar);
        if (s.showBottom  !== undefined) setShowBottom(s.showBottom);
        if (s.bottomTab)  setBottomTab(s.bottomTab);
        if (s.showAI      !== undefined) setShowAI(s.showAI);
        if (s.aiCollapsed !== undefined) setAiCollapsed(s.aiCollapsed);
      }
      setSessionLoaded(true);
    });
  }, []); // eslint-disable-line

  // ── Persist session on any layout change ─────────────────────────
  useEffect(() => {
    if (!sessionLoaded) return;
    const timer = setTimeout(() => {
      saveSession({ sidebarMode, showSidebar, showBottom, bottomTab, showAI, aiCollapsed });
    }, 500);
    return () => clearTimeout(timer);
  }, [sidebarMode, showSidebar, showBottom, bottomTab, showAI, aiCollapsed, sessionLoaded]);

  // Resolve CWD once at startup
  useEffect(() => {
    if (!isElectron()) return;
    api()?.fsGetHomePath?.().then(r => r?.path && setCwd(r.path));
  }, []);

  // Sidebar toggle — stable, no re-renders on consumers
  const setSidebar = useStableCallback((mode) => {
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.metaKey || e.ctrlKey;
      if (!ctrl) return;
      if (e.key === 'k')                     { e.preventDefault(); setSearchOpen(s => !s); }
      if (e.shiftKey && e.key === 'E')       { e.preventDefault(); setSidebar('explorer'); }
      if (e.shiftKey && e.key === 'G')       { e.preventDefault(); setSidebar('git'); }
      if (e.shiftKey && e.key === '`')       { e.preventDefault(); setShowBottom(s => !s); }
      if (e.shiftKey && e.key === 'D')       { e.preventDefault(); openBottomTab('debugger'); }
      if (e.shiftKey && e.key === 'P')       { e.preventDefault(); openBottomTab('pair'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSidebar, openBottomTab]);

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
        default: break;
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [openBottomTab, setSidebar]);

  // Global search action handler
  const handleAction = useStableCallback((action, item) => {
    switch (action) {
      case 'nav:terminal':     openBottomTab('terminal'); break;
      case 'nav:explorer':     setSidebar('explorer'); break;
      case 'nav:console':      openBottomTab('console'); break;
      case 'nav:ai':           setShowAI(true); setAiCollapsed(false); break;
      case 'nav:clipboard':    setSidebar('clipboard'); break;
      case 'nav:git':          setSidebar('git'); break;
      case 'nav:debugger':     openBottomTab('debugger'); break;
      case 'nav:pair':         openBottomTab('pair'); break;
      case 'nav:ops':          openBottomTab('ops'); break;
      case 'nav:arch':         openBottomTab('arch'); break;
      case 'nav:productivity': setSidebar('productivity'); break;
      case 'screenshot':
        api()?.screenshotWindow?.().then(p => {
          if (p) api()?.showNotification?.({ title: 'Screenshot saved', body: p });
        });
        break;
      case 'settings': api()?.openSettings?.(); break;
      case 'update':   api()?.checkForUpdates?.(); break;
      default: break;
    }
  });

  // Browser passthrough — no workspace chrome in web mode
  if (!isElectron()) return <>{children}</>;

  return (
    <div className="ew-shell">
      {/* Activity bar */}
      <div className="ew-activity">
        {Object.entries(SIDEBAR_MODES).map(([mode, cfg]) => (
          <ActivityBtn
            key={mode}
            active={showSidebar && sidebarMode === mode}
            onClick={() => setSidebar(mode)}
            title={cfg.title}
          >
            {cfg.icon}
          </ActivityBtn>
        ))}
        <div className="ew-activity__spacer" />
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
        <ActivityBtn active={false} onClick={() => setSearchOpen(true)} title="Global Search (Cmd+K)">⌕</ActivityBtn>
      </div>

      {/* Main workspace */}
      <div className="ew-main">
        {/* Left sidebar — all modes always mounted after first visit */}
        {showSidebar && (
          <>
            <div className="ew-sidebar" style={{ width: sidebarW }}>
              <div className="ew-sidebar__header">
                <span className="ew-sidebar__title">{SIDEBAR_MODES[sidebarMode]?.title}</span>
                <button className="ew-sidebar__close" onClick={() => setShowSidebar(false)}>✕</button>
              </div>
              <div className="ew-sidebar__body">
                <LazyPane active={sidebarMode === 'explorer'}>
                  <ErrorBoundary label="File Explorer">
                    <FileExplorer cwd={cwd} onFileOpen={() => {}} />
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'git'}>
                  <ErrorBoundary label="Visual Git">
                    <VisualGit cwd={cwd} />
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'clipboard'}>
                  <ErrorBoundary label="Clipboard">
                    <ClipboardHistoryPanel onClose={() => setShowSidebar(false)} />
                  </ErrorBoundary>
                </LazyPane>
                <LazyPane active={sidebarMode === 'productivity'}>
                  <ErrorBoundary label="Workspace">
                    <WorkspaceProductivity
                      onProjectSwitch={p => { setCwd(p.path); setSidebar('explorer'); }}
                    />
                  </ErrorBoundary>
                </LazyPane>
              </div>
            </div>
            {/* Sidebar resize handle */}
            <div className="ew-sidebar-resizer" onMouseDown={onSidebarResize} />
          </>
        )}

        {/* Center column */}
        <div className="ew-center">
          <div className="ew-content">{children}</div>

          {/* Bottom panel */}
          {showBottom && (
            <>
              <div className="ew-bottom-resizer" onMouseDown={onBottomResize} />
              <div className="ew-bottom" style={{ height: bottomH, flexShrink: 0 }}>
                <div className="ew-bottom__tabs">
                  {Object.entries(BOTTOM_TABS).map(([id, cfg]) => (
                    <BottomTabBtn
                      key={id}
                      active={bottomTab === id}
                      onClick={() => setBottomTab(id)}
                      icon={cfg.icon}
                      label={cfg.label}
                    />
                  ))}
                  <div style={{ flex: 1 }} />
                  <button className="ew-bottom-close" onClick={() => setShowBottom(false)}>✕</button>
                </div>
                <div className="ew-bottom__body">
                  <LazyPane active={bottomTab === 'terminal'}>
                    <ErrorBoundary label="Terminal">
                      <TerminalPanel cwd={cwd} />
                    </ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'console'}>
                    <ErrorBoundary label="Engineering Console">
                      <EngineeringConsole />
                    </ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'debugger'}>
                    <ErrorBoundary label="Debugger">
                      <RuntimeDebugger />
                    </ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'ops'}>
                    <ErrorBoundary label="Auto-Ops">
                      <AutonomousOps />
                    </ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'arch'}>
                    <ErrorBoundary label="Architecture">
                      <VisualArchitecture />
                    </ErrorBoundary>
                  </LazyPane>
                  <LazyPane active={bottomTab === 'pair'}>
                    <ErrorBoundary label="AI Pair">
                      <AIPairProgramming />
                    </ErrorBoundary>
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

      {/* Global search — separate Suspense so it doesn't block the shell */}
      <Suspense fallback={null}>
        <GlobalSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onAction={handleAction}
        />
      </Suspense>
    </div>
  );
}
