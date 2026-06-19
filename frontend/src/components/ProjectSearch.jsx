/**
 * ProjectSearch — J2
 * Project-wide search/replace with regex and case-sensitive options.
 * Calls Electron fs-search IPC for file listing, then reads each file
 * and greps in-process for matched lines.
 */
import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import './ProjectSearch.css';

const api        = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// Highlight matched text in a line
function HighlightMatch({ text, query, isRegex, caseSensitive }) {
  if (!query) return <span>{text}</span>;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    const re    = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>);
      parts.push(<mark key={m.index} className="ps-match">{m[0]}</mark>);
      last = m.index + m[0].length;
      if (m[0].length === 0) { re.lastIndex++; }
    }
    if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);
    return <>{parts}</>;
  } catch {
    return <span>{text}</span>;
  }
}

function ResultGroup({ file, matches, cwd, query, isRegex, caseSensitive, onJump, onReplace, replaceValue }) {
  const [collapsed, setCollapsed] = useState(false);
  const relPath = cwd ? file.replace(cwd + '/', '') : file;

  return (
    <div className="ps-group">
      <div className="ps-group__header" onClick={() => setCollapsed(c => !c)}>
        <span className="ps-group__arrow">{collapsed ? '▸' : '▾'}</span>
        <span className="ps-group__file" title={file}>{relPath}</span>
        <span className="ps-group__count">{matches.length}</span>
      </div>
      {!collapsed && matches.map((m, i) => (
        <div
          key={i}
          className="ps-match-row"
          onClick={() => onJump?.(file, m.line)}
          title={`Line ${m.line}`}
        >
          <span className="ps-match-row__line">{m.line}</span>
          <span className="ps-match-row__text">
            <HighlightMatch
              text={m.text}
              query={query}
              isRegex={isRegex}
              caseSensitive={caseSensitive}
            />
          </span>
          {replaceValue !== null && replaceValue !== undefined && (
            <button
              className="ps-match-row__replace-btn"
              onClick={e => { e.stopPropagation(); onReplace?.(file, m.line, m.text, replaceValue); }}
              title="Replace this occurrence"
            >↬</button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ProjectSearch({ cwd, onJumpToFile, className = '' }) {
  const [query,        setQuery]        = useState('');
  const [replaceVal,   setReplaceVal]   = useState('');
  const [showReplace,  setShowReplace]  = useState(false);
  const [isRegex,      setIsRegex]      = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord,    setWholeWord]    = useState(false);
  const [results,      setResults]      = useState([]); // [{ file, matches: [{line, text}] }]
  const [searching,    setSearching]    = useState(false);
  const [replaceAll,   setReplaceAllMode] = useState(false);
  const [statusMsg,    setStatus]       = useState('');
  const abortRef = useRef(false);
  const queryRef = useRef(null);

  useEffect(() => { queryRef.current?.focus(); }, []);

  const runSearch = useCallback(async () => {
    if (!query.trim() || !cwd || !isElectron()) return;
    setSearching(true);
    setResults([]);
    setStatus('');
    abortRef.current = false;

    try {
      // Use Electron fs-search to get matching file paths first
      const fsResults = await api().fsSearch(cwd, query.trim());
      const filePaths = (fsResults || []).filter(p => !p.match(/node_modules|\.git|dist\//));

      if (!filePaths.length) { setStatus('No files matched.'); setSearching(false); return; }

      let flags;
      try {
        flags = (caseSensitive ? '' : 'i') + 'g';
        if (isRegex) new RegExp(query, flags); // validate
      } catch (e) { setStatus(`Invalid regex: ${e.message}`); setSearching(false); return; }

      const groups = [];

      for (const filePath of filePaths.slice(0, 200)) {
        if (abortRef.current) break;
        try {
          const r = await api().fsReadFile({ filePath, encoding: 'utf8' });
          const content = r?.content ?? r?.data ?? '';
          if (!content) continue;

          const lines = content.split('\n');
          const matches = [];

          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            let pattern;
            try {
              const escaped = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const boundary = wholeWord ? `\\b${escaped}\\b` : escaped;
              pattern = new RegExp(boundary, caseSensitive ? 'g' : 'gi');
            } catch { continue; }

            if (pattern.test(lineText)) {
              matches.push({ line: i + 1, text: lineText.trim().slice(0, 200) });
            }
          }
          if (matches.length > 0) {
            groups.push({ file: filePath, matches });
            setResults(prev => [...prev, { file: filePath, matches }]);
          }
        } catch { /* skip unreadable */ }
      }

      const total = groups.reduce((s, g) => s + g.matches.length, 0);
      setStatus(`${total} result${total !== 1 ? 's' : ''} in ${groups.length} file${groups.length !== 1 ? 's' : ''}`);
    } catch (e) {
      setStatus(`Search error: ${e.message}`);
    } finally {
      setSearching(false);
    }
  }, [query, cwd, isRegex, caseSensitive, wholeWord]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') runSearch();
    if (e.key === 'Escape') { setQuery(''); setResults([]); setStatus(''); }
  }, [runSearch]);

  const handleReplace = useCallback(async (filePath, lineNum, lineText, replacement) => {
    try {
      const r = await api().fsReadFile({ filePath, encoding: 'utf8' });
      const content = r?.content ?? r?.data ?? '';
      const lines = content.split('\n');
      const idx = lineNum - 1;
      if (idx < 0 || idx >= lines.length) return;

      const flags   = (caseSensitive ? '' : 'i') + 'g';
      const escaped = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, flags);
      lines[idx] = lines[idx].replace(pattern, replacement);

      await api().fsWriteFile({ filePath: filePath, data: lines.join('\n') });
      setStatus(`Replaced in ${filePath.split('/').pop()}:${lineNum}`);
      // Re-run search to refresh
      setTimeout(runSearch, 400);
    } catch (e) {
      setStatus(`Replace failed: ${e.message}`);
    }
  }, [query, isRegex, caseSensitive, runSearch]);

  const handleReplaceAll = useCallback(async () => {
    if (!results.length || !replaceVal && replaceVal !== '') return;
    let count = 0;
    for (const group of results) {
      try {
        const r = await api().fsReadFile({ filePath: group.file, encoding: 'utf8' });
        const content = r?.content ?? r?.data ?? '';
        const flags   = (caseSensitive ? '' : 'i') + 'g';
        const escaped = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, flags);
        const newContent = content.replace(pattern, replaceVal);
        if (newContent !== content) {
          await api().fsWriteFile({ filePath: group.file, data: newContent });
          count += group.matches.length;
        }
      } catch { /* skip */ }
    }
    setStatus(`Replaced ${count} occurrence${count !== 1 ? 's' : ''}`);
    setTimeout(runSearch, 600);
  }, [results, replaceVal, query, isRegex, caseSensitive, runSearch]);

  const totalMatches = results.reduce((s, g) => s + g.matches.length, 0);

  return (
    <div className={`ps-shell ${className}`}>
      {/* Search input */}
      <div className="ps-input-row">
        <div className="ps-input-wrap">
          <input
            ref={queryRef}
            className="ps-input"
            placeholder="Search… (Enter)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="ps-input-flags">
            <button
              className={`ps-flag-btn${caseSensitive ? ' ps-flag-btn--on' : ''}`}
              onClick={() => setCaseSensitive(c => !c)}
              title="Match case"
            >Aa</button>
            <button
              className={`ps-flag-btn${wholeWord ? ' ps-flag-btn--on' : ''}`}
              onClick={() => setWholeWord(w => !w)}
              title="Whole word"
            >ab</button>
            <button
              className={`ps-flag-btn${isRegex ? ' ps-flag-btn--on' : ''}`}
              onClick={() => setIsRegex(r => !r)}
              title="Use regex"
            >.*</button>
          </div>
        </div>
        <button
          className="ps-search-btn"
          onClick={runSearch}
          disabled={searching || !query.trim()}
          title="Search"
        >{searching ? '⟳' : '⌕'}</button>
        <button
          className={`ps-replace-toggle${showReplace ? ' ps-replace-toggle--on' : ''}`}
          onClick={() => setShowReplace(s => !s)}
          title="Toggle replace"
        >↬</button>
      </div>

      {/* Replace input */}
      {showReplace && (
        <div className="ps-replace-row">
          <input
            className="ps-input ps-input--replace"
            placeholder="Replace with…"
            value={replaceVal}
            onChange={e => setReplaceVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleReplaceAll()}
          />
          <button
            className="ps-replace-all-btn"
            onClick={handleReplaceAll}
            disabled={!results.length || searching}
            title="Replace all"
          >Replace All</button>
        </div>
      )}

      {/* Status bar */}
      {(statusMsg || searching) && (
        <div className="ps-status">
          {searching
            ? <><span className="ps-spinner">⟳</span> Searching…</>
            : statusMsg}
        </div>
      )}

      {/* Results */}
      <div className="ps-results">
        {results.length === 0 && !searching && !statusMsg && (
          <div className="ps-empty">
            {query ? 'Press Enter to search.' : 'Type to search across the project.'}
          </div>
        )}
        {results.map((group, i) => (
          <ResultGroup
            key={group.file}
            file={group.file}
            matches={group.matches}
            cwd={cwd}
            query={query}
            isRegex={isRegex}
            caseSensitive={caseSensitive}
            onJump={(file, line) => onJumpToFile?.(file, line)}
            onReplace={showReplace ? handleReplace : null}
            replaceValue={showReplace ? replaceVal : null}
          />
        ))}
      </div>

      {/* Summary footer */}
      {totalMatches > 0 && !searching && (
        <div className="ps-footer">
          {totalMatches} match{totalMatches !== 1 ? 'es' : ''} across {results.length} file{results.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
