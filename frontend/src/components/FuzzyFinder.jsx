/**
 * FuzzyFinder — ⌘T (file) and ⌘⇧O (symbol) pickers.
 *
 * File picker: lists all files in cwd from Electron fs-search, fuzzy-filters them.
 * Symbol picker: fuzzy-filters the workspace symbol index passed as prop.
 *
 * No new architecture — reuses existing fsSearch IPC + symbol index.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './FuzzyFinder.css';

const api = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

const KIND_ICON = { function: 'ƒ', class: '◈', method: '⬡', variable: '◇' };

function fuzzyMatch(str, query) {
  if (!query) return { match: true, score: 0, ranges: [] };
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  const ranges = [];
  let si = 0, qi = 0, score = 0;
  while (si < s.length && qi < q.length) {
    if (s[si] === q[qi]) {
      ranges.push(si);
      score += si === qi ? 10 : 1; // bonus for positional match
      qi++;
    }
    si++;
  }
  return { match: qi === q.length, score, ranges };
}

function HighlightedName({ name, ranges = [] }) {
  const rangeSet = new Set(ranges);
  return (
    <span>
      {[...name].map((ch, i) => (
        rangeSet.has(i)
          ? <mark key={i} className="ff-highlight">{ch}</mark>
          : <span key={i}>{ch}</span>
      ))}
    </span>
  );
}

export default function FuzzyFinder({ mode, cwd, wsSymbols = [], onSelect, onClose }) {
  const [query, setQuery]     = useState('');
  const [files, setFiles]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive]   = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  // Load file list on mount (file mode only)
  useEffect(() => {
    if (mode !== 'file' || !cwd || !isElectron()) return;
    setLoading(true);
    // Use empty string to get ALL files
    api().fsSearch(cwd, '').then(res => {
      const filtered = (res || [])
        .filter(p => !p.match(/node_modules|\.git|dist\/|build\//))
        .map(p => ({ path: p, name: p.replace(cwd + '/', '') }));
      setFiles(filtered);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [mode, cwd]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  const results = useMemo(() => {
    if (mode === 'file') {
      if (!query) return files.slice(0, 100);
      return files
        .map(f => ({ ...f, ...fuzzyMatch(f.name, query) }))
        .filter(f => f.match)
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);
    } else {
      // symbol mode
      if (!query) return wsSymbols.slice(0, 100);
      return wsSymbols
        .map(s => ({ ...s, ...fuzzyMatch(s.name, query) }))
        .filter(s => s.match)
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);
    }
  }, [mode, files, wsSymbols, query]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) onSelect(results[active]);
    }
  }, [results, active, onClose, onSelect]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[active];
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const title = mode === 'file' ? 'Go to File  ⌘T' : 'Go to Symbol  ⌘⇧O';
  const placeholder = mode === 'file' ? 'Type a filename to search…' : 'Type a symbol name…';

  return (
    <div className="ff-overlay" onClick={onClose}>
      <div className="ff-dialog" onClick={e => e.stopPropagation()}>
        <div className="ff-header">
          <span className="ff-title">{title}</span>
        </div>
        <div className="ff-input-wrap">
          <span className="ff-input-icon">⌕</span>
          <input
            ref={inputRef}
            className="ff-input"
            placeholder={placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="ff-list" ref={listRef}>
          {loading && <div className="ff-empty">Indexing files…</div>}
          {!loading && results.length === 0 && <div className="ff-empty">{query ? 'No match.' : 'No files found.'}</div>}
          {results.map((item, i) => (
            <div
              key={i}
              className={`ff-item${i === active ? ' ff-item--active' : ''}`}
              onClick={() => onSelect(item)}
              onMouseEnter={() => setActive(i)}
            >
              {mode === 'file' ? (
                <>
                  <span className="ff-item__icon">📄</span>
                  <span className="ff-item__name">
                    <HighlightedName name={item.name || item.path} ranges={item.ranges} />
                  </span>
                </>
              ) : (
                <>
                  <span className="ff-item__kind">{KIND_ICON[item.kind] || '◻'}</span>
                  <span className="ff-item__name">
                    <HighlightedName name={item.name} ranges={item.ranges} />
                  </span>
                  <span className="ff-item__file">{item.filePath?.split('/').pop()}</span>
                  <span className="ff-item__line">:{item.line}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="ff-footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
