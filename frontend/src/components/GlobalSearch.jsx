import React, { useState, useEffect, useCallback, useRef } from 'react';
import './GlobalSearch.css';

const BACKEND = 'http://localhost:5050';
const isElectron = () => !!window.electronAPI?.isElectron;
const api = () => window.electronAPI;

// ── Result categories ─────────────────────────────────────────────────
const CATEGORIES = {
  file:    { icon: '📄', label: 'Files' },
  command: { icon: '⚡', label: 'Commands' },
  contact: { icon: '👤', label: 'Contacts' },
  agent:   { icon: '🤖', label: 'Agents' },
  route:   { icon: '🔗', label: 'Routes' },
};

// Static command registry — these are always available
const STATIC_COMMANDS = [
  { type: 'command', id: 'cmd:terminal',  label: 'Open Terminal',         icon: '🖥', action: 'nav:terminal' },
  { type: 'command', id: 'cmd:explorer',  label: 'Open File Explorer',    icon: '📁', action: 'nav:explorer' },
  { type: 'command', id: 'cmd:console',   label: 'Open Engineering Console', icon: '📊', action: 'nav:console' },
  { type: 'command', id: 'cmd:ai',        label: 'Open AI Overlay',       icon: '🤖', action: 'nav:ai' },
  { type: 'command', id: 'cmd:screenshot',label: 'Take Screenshot',       icon: '📸', action: 'screenshot' },
  { type: 'command', id: 'cmd:clipboard', label: 'Clipboard History',     icon: '📋', action: 'nav:clipboard' },
  { type: 'command', id: 'cmd:settings',  label: 'Open Settings',         icon: '⚙️', action: 'settings' },
  { type: 'command', id: 'cmd:update',    label: 'Check for Updates',     icon: '🔄', action: 'update' },
];

function ResultItem({ item, active, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (active && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const icon = item.icon || (CATEGORIES[item.type]?.icon ?? '•');

  return (
    <div
      ref={ref}
      className={`gs-result${active ? ' gs-result--active' : ''}`}
      onClick={() => onSelect(item)}
    >
      <span className="gs-result__icon">{icon}</span>
      <div className="gs-result__text">
        <div className="gs-result__label">{item.label || item.name || item.title}</div>
        {item.subtitle && <div className="gs-result__sub">{item.subtitle}</div>}
      </div>
      {item.type && (
        <span className="gs-result__type">{CATEGORIES[item.type]?.label || item.type}</span>
      )}
    </div>
  );
}

function ClipboardHistory({ onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isElectron()) {
      api()?.clipboardGetHistory().then(h => {
        setHistory(h || []);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const paste = useCallback((text) => {
    if (isElectron()) api()?.clipboardWrite(text);
    onClose();
  }, [onClose]);

  return (
    <div className="clipboard-history">
      <div className="clipboard-history__header">
        <span>Clipboard History</span>
        <button className="gs-close-btn" onClick={onClose}>✕</button>
      </div>
      {loading ? (
        <div className="gs-status">Loading…</div>
      ) : !history.length ? (
        <div className="gs-status">No clipboard history.</div>
      ) : (
        <div className="clipboard-history__list">
          {history.map((text, i) => (
            <div key={i} className="clipboard-item" onClick={() => paste(text)} title="Click to copy">
              <span className="clipboard-item__text">{text}</span>
              <span className="clipboard-item__idx">#{i + 1}</span>
            </div>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div className="clipboard-history__footer">
          <button className="gs-btn" onClick={() => { if (isElectron()) api()?.clipboardClearHistory(); setHistory([]); }}>
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}

export function ClipboardHistoryPanel({ onClose, className = '' }) {
  return (
    <div className={`clipboard-panel ${className}`}>
      <ClipboardHistory onClose={onClose} />
    </div>
  );
}

// ── Main spotlight overlay ────────────────────────────────────────────
export default function GlobalSearch({ open, onClose, onAction }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [cursor, setCursor]     = useState(0);
  const [loading, setLoading]   = useState(false);
  const inputRef                = useRef(null);
  const debounce                = useRef(null);

  // Focus on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(STATIC_COMMANDS);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  // Global Cmd+K / Ctrl+K to toggle
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open) onClose?.();
        else onAction?.('open-search');
      }
      if (e.key === 'Escape' && open) onClose?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, onAction]);

  const search = useCallback(async (q) => {
    if (!q.trim()) {
      setResults(STATIC_COMMANDS);
      return;
    }

    const term = q.toLowerCase();
    const localMatches = STATIC_COMMANDS.filter(c =>
      c.label.toLowerCase().includes(term)
    );

    setResults(localMatches);
    setLoading(true);

    const tasks = [];

    // File search
    if (isElectron()) {
      tasks.push(
        api()?.fsSearch('', q).then(paths => (paths || []).slice(0, 8).map(p => ({
          type: 'file',
          id: `file:${p}`,
          label: p.split('/').pop(),
          subtitle: p,
          path: p,
        }))).catch(() => [])
      );
    }

    // Backend search
    tasks.push(
      fetch(`${BACKEND}/jarvis/search?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          const items = [];
          (data.contacts || []).forEach(c => items.push({ type: 'contact', id: `contact:${c.phone}`, label: c.name || c.phone, subtitle: c.phone, data: c }));
          (data.agents   || []).forEach(a => items.push({ type: 'agent',   id: `agent:${a.id}`,     label: a.name || a.id, subtitle: a.type }));
          return items.slice(0, 6);
        })
        .catch(() => [])
    );

    const settled = await Promise.allSettled(tasks);
    const all = [
      ...localMatches,
      ...settled.flatMap(s => s.status === 'fulfilled' ? s.value : []),
    ];
    setResults(all);
    setCursor(0);
    setLoading(false);
  }, []);

  const onInput = useCallback((e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(q), 200);
  }, [search]);

  const onKey = useCallback((e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[cursor]) select(results[cursor]); }
    if (e.key === 'Escape')    { onClose?.(); }
  }, [results, cursor]);

  const select = useCallback((item) => {
    onClose?.();
    if (!item) return;

    switch (item.type) {
      case 'command':
        onAction?.(item.action, item);
        break;
      case 'file':
        if (isElectron()) api()?.fsOpenPath(item.path);
        onAction?.('open-file', item);
        break;
      case 'contact':
        onAction?.('nav:crm', item);
        break;
      default:
        onAction?.(item.action || `open:${item.type}`, item);
    }
  }, [onClose, onAction]);

  if (!open) return null;

  return (
    <div className="gs-backdrop" onClick={onClose}>
      <div className="gs-modal" onClick={e => e.stopPropagation()}>
        <div className="gs-input-row">
          <span className="gs-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="gs-input"
            placeholder="Search files, commands, contacts… (Cmd+K)"
            value={query}
            onChange={onInput}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="gs-spinner">⟳</span>}
          <button className="gs-close-btn" onClick={onClose}>Esc</button>
        </div>

        {results.length > 0 && (
          <div className="gs-results">
            {results.map((item, i) => (
              <ResultItem key={item.id} item={item} active={i === cursor} onSelect={select} />
            ))}
          </div>
        )}

        {!loading && query && results.length === 0 && (
          <div className="gs-status">No results for "{query}"</div>
        )}

        <div className="gs-footer">
          <span className="gs-hint">↑↓ navigate</span>
          <span className="gs-hint">↵ select</span>
          <span className="gs-hint">Esc close</span>
        </div>
      </div>
    </div>
  );
}
