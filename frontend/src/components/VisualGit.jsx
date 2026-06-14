import React, { useState, useEffect, useCallback, useRef } from 'react';
import './VisualGit.css';

const api = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// ── Utilities ──────────────────────────────────────────────────────────
function useGitData(fetcher, interval = 0) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const run = useCallback(async () => {
    try {
      const result = await fetcher();
      if (mounted.current) { setData(result); setError(null); }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    mounted.current = true;
    run();
    if (interval) {
      const id = setInterval(run, interval);
      return () => { mounted.current = false; clearInterval(id); };
    }
    return () => { mounted.current = false; };
  }, [run, interval]);

  return { data, error, loading, refresh: run };
}

// ── Diff view ──────────────────────────────────────────────────────────
function DiffLine({ line }) {
  const isAdd  = line.startsWith('+') && !line.startsWith('+++');
  const isDel  = line.startsWith('-') && !line.startsWith('---');
  const isMeta = line.startsWith('@@');
  const cls = isAdd ? 'vg-diff-add' : isDel ? 'vg-diff-del' : isMeta ? 'vg-diff-meta' : '';
  return (
    <div className={`vg-diff-line ${cls}`}>
      <span className="vg-diff-gutter">{isAdd ? '+' : isDel ? '-' : ' '}</span>
      <span className="vg-diff-text">{line.slice(1)}</span>
    </div>
  );
}

function DiffViewer({ diff, title, sideBySide = false }) {
  const [mode, setMode] = useState(sideBySide ? 'split' : 'unified');
  if (!diff) return <div className="vg-empty">No diff available.</div>;

  const lines = diff.split('\n');

  if (mode === 'split') {
    // Build side-by-side pairs
    const left = [], right = [];
    lines.forEach(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        left.push({ text: '', type: 'empty' });
        right.push({ text: line.slice(1), type: 'add' });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        left.push({ text: line.slice(1), type: 'del' });
        right.push({ text: '', type: 'empty' });
      } else {
        left.push({ text: line, type: '' });
        right.push({ text: line, type: '' });
      }
    });

    return (
      <div className="vg-diff-viewer">
        <div className="vg-diff-toolbar">
          {title && <span className="vg-diff-title">{title}</span>}
          <button className={`vg-btn-xs${mode === 'unified' ? ' active' : ''}`} onClick={() => setMode('unified')}>Unified</button>
          <button className={`vg-btn-xs${mode === 'split' ? ' active' : ''}`}   onClick={() => setMode('split')}>Split</button>
        </div>
        <div className="vg-diff-split">
          <div className="vg-diff-split-pane">
            {left.map((l, i) => <div key={i} className={`vg-diff-split-line vg-diff-split-${l.type}`}>{l.text}</div>)}
          </div>
          <div className="vg-diff-split-divider" />
          <div className="vg-diff-split-pane">
            {right.map((r, i) => <div key={i} className={`vg-diff-split-line vg-diff-split-${r.type}`}>{r.text}</div>)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vg-diff-viewer">
      <div className="vg-diff-toolbar">
        {title && <span className="vg-diff-title">{title}</span>}
        <button className={`vg-btn-xs${mode === 'unified' ? ' active' : ''}`} onClick={() => setMode('unified')}>Unified</button>
        <button className={`vg-btn-xs${mode === 'split' ? ' active' : ''}`}   onClick={() => setMode('split')}>Split</button>
      </div>
      <div className="vg-diff-body">
        {lines.map((line, i) => <DiffLine key={i} line={line} />)}
      </div>
    </div>
  );
}

// ── Commit graph ───────────────────────────────────────────────────────
function CommitGraph({ commits, onSelect, selected }) {
  if (!commits?.length) return <div className="vg-empty">No commits found.</div>;

  return (
    <div className="vg-commit-graph">
      {commits.map((c, i) => {
        const isSelected = selected?.hash === c.hash;
        return (
          <div
            key={c.hash}
            className={`vg-commit-row${isSelected ? ' vg-commit-row--selected' : ''}`}
            onClick={() => onSelect(c)}
          >
            {/* Graph column */}
            <div className="vg-commit-graph-col">
              <div className="vg-commit-line vg-commit-line--top" style={{ opacity: i === 0 ? 0 : 1 }} />
              <div className={`vg-commit-dot${isSelected ? ' vg-commit-dot--selected' : ''}`} />
              <div className="vg-commit-line vg-commit-line--bot" style={{ opacity: i === commits.length - 1 ? 0 : 1 }} />
            </div>
            {/* Commit info */}
            <div className="vg-commit-info">
              <div className="vg-commit-header">
                <span className="vg-commit-hash" title={c.hash}>{c.hash?.slice(0, 7)}</span>
                {c.refs && c.refs.split(',').map(r => r.trim()).filter(Boolean).map(ref => (
                  <span key={ref} className={`vg-ref-badge${ref.includes('HEAD') ? ' vg-ref-badge--head' : ref.includes('origin') ? ' vg-ref-badge--remote' : ' vg-ref-badge--local'}`}>
                    {ref}
                  </span>
                ))}
              </div>
              <div className="vg-commit-subject">{c.subject}</div>
              <div className="vg-commit-meta">
                <span className="vg-commit-author">{c.author}</span>
                <span className="vg-commit-date">{c.date}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Branch manager ─────────────────────────────────────────────────────
function BranchManager({ cwd, onMessage }) {
  const getBranches = useCallback(() => isElectron() ? api().gitBranches(cwd) : Promise.resolve({ branches: [], current: '' }), [cwd]);
  const { data, loading, error, refresh } = useGitData(getBranches);

  const checkout = useCallback(async (branch) => {
    try {
      const result = await api().gitCheckout(cwd, branch);
      if (result?.error) throw new Error(result.error);
      onMessage?.(`Checked out ${branch}`);
      refresh();
    } catch (e) {
      onMessage?.(`Error: ${e.message}`, 'error');
    }
  }, [cwd, onMessage, refresh]);

  if (loading) return <div className="vg-empty">Loading branches…</div>;
  if (error)   return <div className="vg-error">{error}</div>;

  const branches = data?.branches || [];
  const current  = data?.current || '';

  return (
    <div className="vg-branch-list">
      {branches.map(b => (
        <div
          key={b}
          className={`vg-branch-row${b === current ? ' vg-branch-row--current' : ''}`}
          onClick={() => b !== current && checkout(b)}
        >
          <span className="vg-branch-icon">{b === current ? '●' : '○'}</span>
          <span className="vg-branch-name">{b}</span>
          {b === current && <span className="vg-badge vg-badge--green">current</span>}
        </div>
      ))}
      {!branches.length && <div className="vg-empty">No branches found.</div>}
    </div>
  );
}

// ── Stash manager ──────────────────────────────────────────────────────
function StashManager({ cwd }) {
  const [stashes, setStashes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg,     setMsg]     = useState('');

  const load = useCallback(async () => {
    if (!isElectron()) return;
    setLoading(true);
    try {
      const result = await api().shellExec({ cmd: 'git stash list --format="%gd|%s|%ci"', cwd });
      const lines  = (result?.stdout || '').split('\n').filter(Boolean);
      setStashes(lines.map(l => { const [ref, subject, date] = l.split('|'); return { ref, subject, date }; }));
    } catch {}
    setLoading(false);
  }, [cwd]);

  useEffect(() => { load(); }, [load]);

  const stashCmd = useCallback(async (cmd) => {
    const result = await api().shellExec({ cmd: `git ${cmd}`, cwd });
    setMsg(result?.stdout?.trim() || result?.stderr?.trim() || 'Done');
    load();
  }, [cwd, load]);

  if (loading) return <div className="vg-empty">Loading stashes…</div>;

  return (
    <div className="vg-stash">
      <div className="vg-stash-toolbar">
        <button className="vg-btn-sm" onClick={() => stashCmd('stash')}>Stash changes</button>
        {msg && <span className="vg-stash-msg">{msg}</span>}
      </div>
      {!stashes.length ? (
        <div className="vg-empty">No stashes.</div>
      ) : stashes.map((s, i) => (
        <div key={i} className="vg-stash-row">
          <div className="vg-stash-ref">{s.ref}</div>
          <div className="vg-stash-subject">{s.subject}</div>
          <div className="vg-stash-actions">
            <button className="vg-btn-xs" onClick={() => stashCmd(`stash pop stash@{${i}}`)}>Pop</button>
            <button className="vg-btn-xs" onClick={() => stashCmd(`stash apply stash@{${i}}`)}>Apply</button>
            <button className="vg-btn-xs vg-btn-xs--red" onClick={() => stashCmd(`stash drop stash@{${i}}`)}>Drop</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Conflict resolution ────────────────────────────────────────────────
function ConflictResolution({ cwd }) {
  const [conflicts, setConflicts] = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [content,   setContent]   = useState('');
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    if (!isElectron()) return;
    setLoading(true);
    try {
      const result = await api().shellExec({ cmd: 'git diff --name-only --diff-filter=U', cwd });
      const files  = (result?.stdout || '').split('\n').filter(Boolean);
      setConflicts(files);
    } catch {}
    setLoading(false);
  }, [cwd]);

  useEffect(() => { load(); }, [load]);

  const viewConflict = useCallback(async (file) => {
    setSelected(file);
    const result = await api().fsReadFile({ path: `${cwd}/${file}` });
    setContent(result?.content || '');
  }, [cwd]);

  const resolve = useCallback(async (strategy) => {
    if (!selected) return;
    const cmd = strategy === 'ours'
      ? `git checkout --ours "${selected}" && git add "${selected}"`
      : `git checkout --theirs "${selected}" && git add "${selected}"`;
    await api().shellExec({ cmd, cwd });
    load();
    setSelected(null);
    setContent('');
  }, [selected, cwd, load]);

  if (loading) return <div className="vg-empty">Checking for conflicts…</div>;
  if (!conflicts.length) return <div className="vg-empty vg-empty--ok">No conflicts. Working tree is clean.</div>;

  return (
    <div className="vg-conflict">
      <div className="vg-conflict__list">
        <div className="vg-conflict__count">{conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}</div>
        {conflicts.map(f => (
          <div
            key={f}
            className={`vg-conflict__file${selected === f ? ' vg-conflict__file--selected' : ''}`}
            onClick={() => viewConflict(f)}
          >
            <span className="vg-conflict__icon">⚠</span>
            {f}
          </div>
        ))}
      </div>
      {selected && (
        <div className="vg-conflict__editor">
          <div className="vg-conflict__toolbar">
            <span className="vg-conflict__filename">{selected}</span>
            <button className="vg-btn-sm vg-btn-sm--green" onClick={() => resolve('ours')}>Accept Ours</button>
            <button className="vg-btn-sm" onClick={() => resolve('theirs')}>Accept Theirs</button>
          </div>
          <pre className="vg-conflict__preview">{content}</pre>
        </div>
      )}
    </div>
  );
}

// ── Commit dialog ──────────────────────────────────────────────────────
function CommitDialog({ cwd, onCommit }) {
  const [message, setMessage] = useState('');
  const [status,  setStatus]  = useState(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!isElectron()) return;
    const result = await api().gitStatus(cwd);
    setStatus(result);
  }, [cwd]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const commit = useCallback(async () => {
    if (!message.trim()) return;
    setLoading(true);
    try {
      await api().shellExec({ cmd: 'git add -A', cwd });
      const result = await api().gitCommit(cwd, message.trim());
      if (result?.error) throw new Error(result.error);
      setMessage('');
      onCommit?.(`Committed: ${message.trim()}`);
      loadStatus();
    } catch (e) {
      onCommit?.(`Error: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [message, cwd, onCommit, loadStatus]);

  const staged   = status?.staged   || [];
  const unstaged = status?.unstaged || [];

  return (
    <div className="vg-commit-dialog">
      <div className="vg-commit-dialog__section">
        <div className="vg-commit-dialog__label">Staged ({staged.length})</div>
        {staged.length ? staged.map((f, i) => (
          <div key={i} className="vg-status-file vg-status-file--staged">
            <span className="vg-status-badge vg-status-badge--green">{f.x || 'M'}</span>
            <span>{f.path || f}</span>
          </div>
        )) : <div className="vg-empty">Nothing staged.</div>}
      </div>
      <div className="vg-commit-dialog__section">
        <div className="vg-commit-dialog__label">Changes ({unstaged.length})</div>
        {unstaged.length ? unstaged.map((f, i) => (
          <div key={i} className="vg-status-file">
            <span className="vg-status-badge">{f.y || 'M'}</span>
            <span>{f.path || f}</span>
          </div>
        )) : <div className="vg-empty">No unstaged changes.</div>}
      </div>
      <div className="vg-commit-dialog__input-area">
        <textarea
          className="vg-commit-msg-input"
          placeholder="Commit message…"
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          onKeyDown={e => { if (e.metaKey && e.key === 'Enter') commit(); }}
        />
        <div className="vg-commit-dialog__hint">Cmd+Enter to commit</div>
        <button
          className="vg-btn vg-btn--primary"
          onClick={commit}
          disabled={loading || !message.trim()}
        >
          {loading ? 'Committing…' : 'Commit All (git add -A)'}
        </button>
      </div>
    </div>
  );
}

// ── Main VisualGit ─────────────────────────────────────────────────────
const TABS = [
  { id: 'graph',     label: 'Graph' },
  { id: 'diff',      label: 'Diff' },
  { id: 'branches',  label: 'Branches' },
  { id: 'commit',    label: 'Commit' },
  { id: 'stash',     label: 'Stash' },
  { id: 'conflicts', label: 'Conflicts' },
];

export default function VisualGit({ cwd, className = '' }) {
  const [tab,       setTab]       = useState('graph');
  const [selected,  setSelected]  = useState(null);
  const [diff,      setDiff]      = useState(null);
  const [diffFile,  setDiffFile]  = useState(null);
  const [msg,       setMsg]       = useState(null);

  const workdir = cwd || process?.env?.HOME || '/';

  const fetchLog = useCallback(
    () => isElectron() ? api().gitLog(workdir, 50) : Promise.resolve({ commits: [] }),
    [workdir]
  );
  const { data: logData, loading: logLoading, error: logError, refresh: refreshLog } = useGitData(fetchLog, 15000);

  const commits = logData?.commits || [];

  const selectCommit = useCallback(async (commit) => {
    setSelected(commit);
    setDiff(null);
    setDiffFile(null);
    if (!isElectron()) return;
    const result = await api().gitDiff(workdir, commit.hash);
    setDiff(result?.diff || result?.stdout || '');
    setTab('diff');
  }, [workdir]);

  const onMessage = useCallback((text, type = 'ok') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  if (!isElectron()) {
    return (
      <div className={`visual-git visual-git--stub ${className}`}>
        <div className="vg-unavailable">Visual Git is only available in the desktop app.</div>
      </div>
    );
  }

  return (
    <div className={`visual-git ${className}`}>
      {/* Header */}
      <div className="vg-header">
        <span className="vg-header__title">Git</span>
        <span className="vg-header__cwd" title={workdir}>{workdir.split('/').slice(-2).join('/')}</span>
        <button className="vg-header__btn" onClick={refreshLog} title="Refresh">↻</button>
      </div>

      {/* Message bar */}
      {msg && (
        <div className={`vg-message-bar vg-message-bar--${msg.type}`}>{msg.text}</div>
      )}

      {/* Tabs */}
      <div className="vg-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`vg-tab${tab === t.id ? ' vg-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="vg-body">
        {tab === 'graph' && (
          logLoading ? <div className="vg-empty">Loading commits…</div>
          : logError  ? <div className="vg-error">{logError}</div>
          : <CommitGraph commits={commits} selected={selected} onSelect={selectCommit} />
        )}

        {tab === 'diff' && (
          <DiffViewer diff={diff} title={diffFile || selected?.subject} sideBySide />
        )}

        {tab === 'branches' && (
          <BranchManager cwd={workdir} onMessage={onMessage} />
        )}

        {tab === 'commit' && (
          <CommitDialog cwd={workdir} onCommit={(text, type) => { onMessage(text, type); refreshLog(); }} />
        )}

        {tab === 'stash' && (
          <StashManager cwd={workdir} />
        )}

        {tab === 'conflicts' && (
          <ConflictResolution cwd={workdir} />
        )}
      </div>
    </div>
  );
}
