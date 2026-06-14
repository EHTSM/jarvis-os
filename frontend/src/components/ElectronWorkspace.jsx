import React, { useState, useCallback, useEffect } from 'react';
import WorkspaceLayout from './WorkspaceLayout';
import TerminalPanel from './TerminalPanel';
import FileExplorer from './FileExplorer';
import EngineeringConsole from './EngineeringConsole';
import AIOverlay from './AIOverlay';
import GlobalSearch, { ClipboardHistoryPanel } from './GlobalSearch';
import './ElectronWorkspace.css';

const api = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

/**
 * ElectronWorkspace — the autonomous engineering desktop shell.
 * Rendered only inside Electron; wraps the existing app inside a workspace frame.
 *
 * Props:
 *   children — the existing web app content (main panel)
 */
export default function ElectronWorkspace({ children }) {
  const [searchOpen,      setSearchOpen]      = useState(false);
  const [aiCollapsed,     setAiCollapsed]     = useState(false);
  const [activePanel,     setActivePanel]     = useState('main'); // 'main' | 'terminal' | 'explorer' | 'console' | 'clipboard'
  const [sidebarMode,     setSidebarMode]     = useState('explorer'); // 'explorer' | 'clipboard'
  const [showSidebar,     setShowSidebar]     = useState(true);
  const [showBottom,      setShowBottom]      = useState(false);
  const [showAI,          setShowAI]          = useState(true);
  const [openFilePath,    setOpenFilePath]    = useState(null);

  // Cmd+K → global search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(s => !s);
      }
      // Cmd+Shift+E → toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        setShowSidebar(s => !s);
      }
      // Cmd+Shift+` → toggle bottom terminal
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '`') {
        e.preventDefault();
        setShowBottom(s => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Listen to native menu actions from Electron
  useEffect(() => {
    if (!isElectron()) return;
    const unsub = api()?.onMenuAction?.((action) => {
      switch (action) {
        case 'open-command-palette': setSearchOpen(true); break;
        case 'toggle-sidebar':       setShowSidebar(s => !s); break;
        case 'toggle-terminal':      setShowBottom(s => !s); break;
        case 'toggle-ai':            setShowAI(s => !s); break;
        default: break;
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  const handleAction = useCallback((action, item) => {
    switch (action) {
      case 'nav:terminal':   setShowBottom(true); break;
      case 'nav:explorer':   setShowSidebar(true); setSidebarMode('explorer'); break;
      case 'nav:console':    setShowBottom(true); setActivePanel('console'); break;
      case 'nav:ai':         setShowAI(true); setAiCollapsed(false); break;
      case 'nav:clipboard':  setShowSidebar(true); setSidebarMode('clipboard'); break;
      case 'open-file':
        if (item?.path) setOpenFilePath(item.path);
        break;
      case 'screenshot':
        api()?.screenshotWindow?.().then(p => {
          if (p) api()?.showNotification?.({ title: 'Screenshot saved', body: p });
        });
        break;
      case 'settings':
        api()?.openSettings?.();
        break;
      case 'update':
        api()?.checkForUpdates?.();
        break;
      default: break;
    }
  }, []);

  if (!isElectron()) {
    return <>{children}</>;
  }

  return (
    <div className="ew-shell">
      {/* Activity bar */}
      <div className="ew-activity">
        <button
          className={`ew-activity-btn${showSidebar && sidebarMode === 'explorer' ? ' ew-activity-btn--active' : ''}`}
          onClick={() => { setSidebarMode('explorer'); setShowSidebar(s => sidebarMode !== 'explorer' ? true : !s); }}
          title="File Explorer (Cmd+Shift+E)"
        >📁</button>
        <button
          className={`ew-activity-btn${showSidebar && sidebarMode === 'clipboard' ? ' ew-activity-btn--active' : ''}`}
          onClick={() => { setSidebarMode('clipboard'); setShowSidebar(s => sidebarMode !== 'clipboard' ? true : !s); }}
          title="Clipboard History"
        >📋</button>
        <div className="ew-activity__spacer" />
        <button
          className={`ew-activity-btn${showBottom ? ' ew-activity-btn--active' : ''}`}
          onClick={() => setShowBottom(s => !s)}
          title="Terminal (Cmd+Shift+`)"
        >🖥</button>
        <button
          className={`ew-activity-btn${showAI ? ' ew-activity-btn--active' : ''}`}
          onClick={() => setShowAI(s => !s)}
          title="AI Overlay"
        >🤖</button>
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
            {sidebarMode === 'explorer' && (
              <FileExplorer
                onFileOpen={(p) => setOpenFilePath(p)}
              />
            )}
            {sidebarMode === 'clipboard' && (
              <ClipboardHistoryPanel onClose={() => setShowSidebar(false)} />
            )}
          </div>
        )}

        {/* Center + AI column */}
        <div className="ew-center">
          {/* Top area: children (app) */}
          <div className="ew-content">
            {children}
          </div>

          {/* Bottom panel: terminal or console */}
          {showBottom && (
            <>
              <div className="ew-bottom-resizer" />
              <div className="ew-bottom">
                <div className="ew-bottom__tabs">
                  <button
                    className={`ew-bottom-tab${activePanel !== 'console' ? ' ew-bottom-tab--active' : ''}`}
                    onClick={() => setActivePanel('main')}
                  >Terminal</button>
                  <button
                    className={`ew-bottom-tab${activePanel === 'console' ? ' ew-bottom-tab--active' : ''}`}
                    onClick={() => setActivePanel('console')}
                  >Console</button>
                  <div style={{ flex: 1 }} />
                  <button className="ew-bottom-close" onClick={() => setShowBottom(false)}>✕</button>
                </div>
                <div className="ew-bottom__body">
                  {activePanel === 'console' ? (
                    <EngineeringConsole />
                  ) : (
                    <TerminalPanel />
                  )}
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

      {/* Global search overlay */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onAction={handleAction}
      />
    </div>
  );
}
