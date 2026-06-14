import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import './TerminalPanel.css';

// xterm + addons — loaded only inside Electron (no-op in browser)
let XTerminal, FitAddon, WebLinksAddon, SearchAddon;
try {
  ({ Terminal: XTerminal } = require('xterm'));
  ({ FitAddon }    = require('xterm-addon-fit'));
  ({ WebLinksAddon } = require('xterm-addon-web-links'));
  ({ SearchAddon } = require('xterm-addon-search'));
} catch {}

const api = () => window.electronAPI;

// Generate a short unique session id
function genId() {
  return `pty-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Single terminal tab.
 * Wraps an xterm.js Terminal instance connected to a PTY session in main.
 */
function TerminalInstance({ sessionId, active, cwd, onTitleChange }) {
  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const fitRef       = useRef(null);
  const searchRef    = useRef(null);
  const unsubData    = useRef(null);
  const unsubExit    = useRef(null);

  useEffect(() => {
    if (!XTerminal || !containerRef.current) return;

    // Create terminal
    const term = new XTerminal({
      cursorBlink:    true,
      fontSize:       13,
      fontFamily:     "'JetBrains Mono', 'Fira Mono', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor:     '#10b981',
        black:      '#1e1e1e', brightBlack:   '#6b7280',
        red:        '#f87171', brightRed:     '#ef4444',
        green:      '#34d399', brightGreen:   '#10b981',
        yellow:     '#fbbf24', brightYellow:  '#f59e0b',
        blue:       '#60a5fa', brightBlue:    '#3b82f6',
        magenta:    '#a78bfa', brightMagenta: '#8b5cf6',
        cyan:       '#22d3ee', brightCyan:    '#06b6d4',
        white:      '#e5e7eb', brightWhite:   '#f9fafb',
      },
      allowProposedApi: true,
    });

    const fit    = new FitAddon();
    const links  = new WebLinksAddon();
    const search = new SearchAddon();

    term.loadAddon(fit);
    term.loadAddon(links);
    term.loadAddon(search);
    term.open(containerRef.current);
    fit.fit();

    termRef.current   = term;
    fitRef.current    = fit;
    searchRef.current = search;

    // Create PTY session
    const { cols, rows } = term;
    api()?.ptyCreate({ id: sessionId, cwd, cols, rows }).then(res => {
      if (!res?.ok) {
        term.write('\r\n\x1b[31mFailed to create terminal session\x1b[0m\r\n');
      }
    });

    // PTY data → terminal
    unsubData.current = api()?.onPtyData(sessionId, (data) => {
      term.write(data);
      // Extract title from OSC sequences (e.g. bash sets window title)
      const match = data.match(/\x1b\]0;([^\x07\x1b]+)/);
      if (match && onTitleChange) onTitleChange(match[1]);
    });

    // Terminal input → PTY
    term.onData((data) => {
      api()?.ptyInput(sessionId, data);
    });

    // PTY exit
    unsubExit.current = api()?.onPtyExit(sessionId, ({ exitCode }) => {
      term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
      const { cols: c, rows: r } = term;
      api()?.ptyResize(sessionId, c, r);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (typeof unsubData.current === 'function') unsubData.current();
      if (typeof unsubExit.current === 'function') unsubExit.current();
      term.dispose();
      api()?.ptyKill(sessionId);
    };
  }, [sessionId]); // eslint-disable-line

  // Fit on active change
  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => { try { fitRef.current.fit(); } catch {} }, 50);
    }
  }, [active]);

  // Focus on click/tab switch
  useEffect(() => {
    if (active) setTimeout(() => termRef.current?.focus(), 60);
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={`terminal-instance${active ? ' terminal-instance--active' : ''}`}
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}

/**
 * Multi-tab terminal panel.
 * Props:
 *   cwd        — initial working directory
 *   className  — extra CSS class
 *   onClose    — called when panel is closed
 */
export default function TerminalPanel({ cwd, className = '', onClose }) {
  const [tabs, setTabs]       = useState(() => [{ id: genId(), title: 'Terminal 1' }]);
  const [active, setActive]   = useState(0);
  const [search, setSearch]   = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef(null);

  const isElectron = !!window.electronAPI?.isElectron;

  const addTab = useCallback(() => {
    const id    = genId();
    const title = `Terminal ${tabs.length + 1}`;
    setTabs(t => [...t, { id, title }]);
    setActive(tabs.length);
  }, [tabs.length]);

  const closeTab = useCallback((idx, e) => {
    e.stopPropagation();
    const id = tabs[idx].id;
    api()?.ptyKill(id);
    setTabs(t => {
      const next = t.filter((_, i) => i !== idx);
      if (next.length === 0 && onClose) onClose();
      return next;
    });
    setActive(i => Math.min(i, Math.max(0, tabs.length - 2)));
  }, [tabs, onClose]);

  // Keyboard: Ctrl+Shift+T = new tab, Ctrl+Shift+W = close tab
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); addTab(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'W') { e.preventDefault(); closeTab(active, { stopPropagation: () => {} }); }
      if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setShowSearch(s => !s); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addTab, closeTab, active]);

  if (!isElectron) {
    return (
      <div className={`terminal-panel terminal-panel--stub ${className}`}>
        <div className="terminal-panel__unavailable">
          Terminal is only available in the desktop app.
        </div>
      </div>
    );
  }

  return (
    <div className={`terminal-panel ${className}`}>
      {/* Tab bar */}
      <div className="terminal-panel__tabs">
        {tabs.map((tab, idx) => (
          <button
            key={tab.id}
            className={`terminal-tab${idx === active ? ' terminal-tab--active' : ''}`}
            onClick={() => setActive(idx)}
          >
            <span className="terminal-tab__dot" />
            <span className="terminal-tab__title">{tab.title}</span>
            <span
              className="terminal-tab__close"
              onClick={(e) => closeTab(idx, e)}
              title="Close (Ctrl+Shift+W)"
            >×</span>
          </button>
        ))}
        <button className="terminal-tab terminal-tab--add" onClick={addTab} title="New terminal (Ctrl+Shift+T)">+</button>
        <div className="terminal-panel__spacer" />
        <button
          className="terminal-panel__action"
          onClick={() => setShowSearch(s => !s)}
          title="Search (Ctrl+Shift+F)"
        >⌕</button>
        {onClose && (
          <button className="terminal-panel__action" onClick={onClose} title="Close panel">✕</button>
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="terminal-panel__search">
          <input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search in terminal…"
            className="terminal-panel__search-input"
          />
          <button className="terminal-panel__action" onClick={() => setShowSearch(false)}>✕</button>
        </div>
      )}

      {/* Terminal instances */}
      <div className="terminal-panel__body">
        {tabs.map((tab, idx) => (
          <TerminalInstance
            key={tab.id}
            sessionId={tab.id}
            active={idx === active}
            cwd={cwd || undefined}
            onTitleChange={(title) => {
              setTabs(t => t.map((tb, i) => i === idx ? { ...tb, title } : tb));
            }}
          />
        ))}
      </div>
    </div>
  );
}
