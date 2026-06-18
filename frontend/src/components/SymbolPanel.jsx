/**
 * SymbolPanel — File Outline + Workspace Symbol Search
 *
 * Shows the symbol tree for the active file (like VS Code's OUTLINE panel).
 * Also hosts the workspace symbol search results when triggered by ⌘⇧O.
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import './SymbolPanel.css';

const KIND_ICON = {
  function: 'ƒ',
  class:    '◈',
  method:   '⬡',
  variable: '◇',
};

function SymbolRow({ sym, onJump, active }) {
  return (
    <div
      className={`sp-row${active ? ' sp-row--active' : ''} sp-row--${sym.kind}`}
      onClick={() => onJump(sym)}
      title={`${sym.kind} — line ${sym.line}`}
    >
      <span className="sp-row__icon">{KIND_ICON[sym.kind] || '◻'}</span>
      <span className="sp-row__name">{sym.name}</span>
      <span className="sp-row__line">{sym.line}</span>
    </div>
  );
}

export default function SymbolPanel({ symbols = [], filePath, activeLine, onJump, wsSymbols = [], wsQuery, onWsQuery, className = '' }) {
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('outline'); // 'outline' | 'workspace'
  const inputRef = useRef(null);

  useEffect(() => { if (wsQuery !== undefined) { setTab('workspace'); } }, [wsQuery]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return symbols.filter(s => !q || s.name.toLowerCase().includes(q));
  }, [symbols, filter]);

  const wsFiltered = useMemo(() => {
    if (!wsQuery) return wsSymbols;
    const q = wsQuery.toLowerCase();
    return wsSymbols.filter(s => s.name.toLowerCase().includes(q));
  }, [wsSymbols, wsQuery]);

  return (
    <div className={`symbol-panel ${className}`}>
      <div className="sp-tabs">
        <button className={`sp-tab${tab === 'outline' ? ' sp-tab--active' : ''}`} onClick={() => setTab('outline')}>Outline</button>
        <button className={`sp-tab${tab === 'workspace' ? ' sp-tab--active' : ''}`} onClick={() => setTab('workspace')}>Workspace</button>
      </div>

      {tab === 'outline' && (
        <>
          <div className="sp-search">
            <input
              ref={inputRef}
              className="sp-search__input"
              placeholder="Filter symbols…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setFilter(''); }}
            />
          </div>
          <div className="sp-body">
            {filtered.length === 0 ? (
              <div className="sp-empty">
                {symbols.length === 0 ? 'No symbols found.\nOpen a JS/JSX/TS/TSX file.' : 'No match.'}
              </div>
            ) : (
              filtered.map((s, i) => (
                <SymbolRow
                  key={i}
                  sym={s}
                  onJump={onJump}
                  active={activeLine != null && activeLine >= s.line && activeLine <= (s.endLine ?? s.line)}
                />
              ))
            )}
          </div>
        </>
      )}

      {tab === 'workspace' && (
        <>
          <div className="sp-search">
            <input
              className="sp-search__input"
              placeholder="Search workspace symbols…"
              value={wsQuery || ''}
              onChange={e => onWsQuery?.(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onWsQuery?.(''); }}
              autoFocus
            />
          </div>
          <div className="sp-body">
            {wsFiltered.length === 0 ? (
              <div className="sp-empty">{wsQuery ? 'No symbols matched.' : 'Type to search across all indexed files.'}</div>
            ) : (
              wsFiltered.map((s, i) => (
                <div key={i} className={`sp-row sp-row--${s.kind}`} onClick={() => onJump(s)}>
                  <span className="sp-row__icon">{KIND_ICON[s.kind] || '◻'}</span>
                  <span className="sp-row__name">{s.name}</span>
                  <span className="sp-row__file">{s.filePath?.split('/').pop()}</span>
                  <span className="sp-row__line">{s.line}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
