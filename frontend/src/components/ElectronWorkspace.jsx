import React, { useState, useCallback, useEffect } from 'react';
import WorkspaceLayout from './WorkspaceLayout';
import TerminalPanel from './TerminalPanel';
import FileExplorer from './FileExplorer';
import EngineeringConsole from './EngineeringConsole';
import AIOverlay from './AIOverlay';
import GlobalSearch, { ClipboardHistoryPanel } from './GlobalSearch';
import VisualGit from './VisualGit';
import AIPairProgramming from './AIPairProgramming';
import RuntimeDebugger from './RuntimeDebugger';
import VisualArchitecture from './VisualArchitecture';
import WorkspaceProductivity from './WorkspaceProductivity';
import AutonomousOps from './AutonomousOps';
import './ElectronWorkspace.css';

const api = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// Sidebar modes available in the left panel
const SIDEBAR_MODES = {
  explorer:     { label: 'Files',       icon: '📁', title: 'File Explorer' },
  git:          { label: 'Git',         icon: '🌿', title: 'Visual Git' },
  clipboard:    { label: 'Clipboard',   icon: '📋', title: 'Clipboard History' },
  productivity: { label: 'Workspace',   icon: '🗂', title: 'Workspace' },
};

// Bottom panel tabs
const BOTTOM_TABS = {
  terminal:   { label: 'Terminal',   icon: '🖥' },
  console:    { label: 'Console',    icon: '📊' },
  debugger:   { label: 'Debugger',   icon: '🔍' },
  ops:        { label: 'Auto-Ops',   icon: '🤖' },
  arch:       { label: 'Arch',       icon: '🗺' },
  pair:       { label: 'AI Pair',    icon: '💡' },
};

export default function ElectronWorkspace({ children }) {
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [aiCollapsed,  setAiCollapsed]  = useState(false);
  const [sidebarMode,  setSidebarMode]  = useState('explorer');
  const [showSidebar,  setShowSidebar]  = useState(true);
  const [showBottom,   setShowBottom]   = useState(false);
  const [bottomTab,    setBottomTab]    = useState('terminal');
  const [showAI,       setShowAI]       = useState(true);
  const [openFilePath, setOpenFilePath] = useState(null);
  const [cwd,          setCwd]          = useState(null);

  // Resolve CWD for terminal/git from home
  useEffect(() => {
    if (!isElectron()) return;
    api()?.fsGetHomePath?.().then(home => home && setCwd(home));
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.metaKey || e.ctrlKey;
      if (ctrl && e.key === 'k')                          { e.preventDefault(); setSearchOpen(s => !s); }
      if (ctrl && e.shiftKey && e.key === 'E')            { e.preventDefault(); setSidebar('explorer'); }
      if (ctrl && e.shiftKey && e.key === 'G')            { e.preventDefault(); setSidebar('git'); }
      if (ctrl && e.shiftKey && e.key === '`')            { e.preventDefault(); setShowBottom(s => !s); }
      if (ctrl && e.shiftKey && e.key === 'D')            { e.preventDefault(); openBottomTab('debugger'); }
      if (ctrl && e.shiftKey && e.key === 'P')            { e.preventDefault(); openBottomTab('pair'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const setSidebar = useCallback((mode) => {
    setSidebarMode(prev => {
      if (prev === mode && showSidebar) { setShowSidebar(false); return prev; }
      setShowSidebar(true);
      return mode;
    });
  }, [showSidebar]);

  const openBottomTab = useCallback((tab) => {
    setBottomTab(tab);
    setShowBottom(true);
  }, []);

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

  const handleAction = useCallback((action, item) => {
    switch (action) {
      case 'nav:terminal':      openBottomTab('terminal'); break;
      case 'nav:explorer':      setSidebar('explorer'); break;
      case 'nav:console':       openBottomTab('console'); break;
      case 'nav:ai':            setShowAI(true); setAiCollapsed(false); break;
      case 'nav:clipboard':     setSidebar('clipboard'); break;
      case 'nav:git':           setSidebar('git'); break;
      case 'nav:debugger':      openBottomTab('debugger'); break;
      case 'nav:pair':          openBottomTab('pair'); break;
      case 'nav:ops':           openBottomTab('ops'); break;
      case 'nav:arch':          openBottomTab('arch'); break;
      case 'nav:productivity':  setSidebar('productivity'); break;
      case 'open-file':
        if (item?.path) setOpenFilePath(item.path);
        break;
      case 'screenshot':
        api()?.screenshotWindow?.().then(p => {
          if (p) api()?.showNotification?.({ title: 'Screenshot saved', body: p });
        });
        break;
      case 'settings': api()?.openSettings?.(); break;
      case 'update':   api()?.checkForUpdates?.(); break;
      default: break;
    }
  }, [openBottomTab, setSidebar]);

  if (!isElectron()) return <>{children}</>;

  return (
    <div className="ew-shell">
      {/* Activity bar */}
      <div className="ew-activity">
        {Object.entries(SIDEBAR_MODES).map(([mode, cfg]) => (
          <button
            key={mode}
            className={`ew-activity-btn${showSidebar && sidebarMode === mode ? ' ew-activity-btn--active' : ''}`}
            onClick={() => setSidebar(mode)}
            title={cfg.title}
          >
            {cfg.icon}
          </button>
        ))}
        <div className="ew-activity__spacer" />
        {Object.entries(BOTTOM_TABS).map(([id, cfg]) => (
          <button
            key={id}
            className={`ew-activity-btn${showBottom && bottomTab === id ? ' ew-activity-btn--active' : ''}`}
            onClick={() => openBottomTab(id)}
            title={cfg.label}
          >
            {cfg.icon}
          </button>
        ))}
        <button
          className={`ew-activity-btn${showAI ? ' ew-activity-btn--active' : ''}`}
          onClick={() => setShowAI(s => !s)}
          title="AI Overlay"
        >✨</button>
        <button
          className="ew-activity-btn"
          onClick={() => setSearchOpen(true)}
          title="Global Search (Cmd+K)"
        >⌕</button>
      </div>

      {/* Main workspace */}
      <div className="ew-main">
        {/* Left sidebar */}
        {showSidebar && (
          <div className="ew-sidebar">
            <div className="ew-sidebar__header">
              <span className="ew-sidebar__title">{SIDEBAR_MODES[sidebarMode]?.title}</span>
              <button className="ew-sidebar__close" onClick={() => setShowSidebar(false)}>✕</button>
            </div>
            <div className="ew-sidebar__body">
              {sidebarMode === 'explorer' && (
                <FileExplorer cwd={cwd} onFileOpen={p => setOpenFilePath(p)} />
              )}
              {sidebarMode === 'git' && (
                <VisualGit cwd={cwd} />
              )}
              {sidebarMode === 'clipboard' && (
                <ClipboardHistoryPanel onClose={() => setShowSidebar(false)} />
              )}
              {sidebarMode === 'productivity' && (
                <WorkspaceProductivity
                  onProjectSwitch={p => { setCwd(p.path); setSidebar('explorer'); }}
                />
              )}
            </div>
          </div>
        )}

        {/* Center + AI column */}
        <div className="ew-center">
          {/* App content */}
          <div className="ew-content">
            {children}
          </div>

          {/* Bottom panel */}
          {showBottom && (
            <>
              <div className="ew-bottom-resizer" />
              <div className="ew-bottom">
                <div className="ew-bottom__tabs">
                  {Object.entries(BOTTOM_TABS).map(([id, cfg]) => (
                    <button
                      key={id}
                      className={`ew-bottom-tab${bottomTab === id ? ' ew-bottom-tab--active' : ''}`}
                      onClick={() => setBottomTab(id)}
                    >
                      {cfg.icon} {cfg.label}
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button className="ew-bottom-close" onClick={() => setShowBottom(false)}>✕</button>
                </div>
                <div className="ew-bottom__body">
                  {bottomTab === 'terminal' && <TerminalPanel cwd={cwd} />}
                  {bottomTab === 'console'  && <EngineeringConsole />}
                  {bottomTab === 'debugger' && <RuntimeDebugger />}
                  {bottomTab === 'ops'      && <AutonomousOps />}
                  {bottomTab === 'arch'     && <VisualArchitecture />}
                  {bottomTab === 'pair'     && <AIPairProgramming />}
                </div>
              </div>
            </>
          )}
        </div>

        {/* AI sidebar */}
        {showAI && (
          <AIOverlay
            collapsed={aiCollapsed}
            onToggle={() => setAiCollapsed(c => !c)}
            className="ew-ai-sidebar"
          />
        )}
      </div>

      {/* Global search */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onAction={handleAction}
      />
    </div>
  );
}
