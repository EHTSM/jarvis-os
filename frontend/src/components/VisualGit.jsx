/**
 * VisualGit — J3 Mission-Aware Git Workspace
 *
 * Extends existing git client with mission awareness:
 * - Mission tab: active mission context, git history, commit timeline
 * - AI-generated commit messages from diff/mission context
 * - Approval-gated commits for missions that require it
 * - Mission branch creation (auto-slugged from objective)
 * - Rollback with mission timeline recording
 * - Review request recorded as mission approval
 * - All git ops emit to executionEventBus → Observer panel
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMissionGit } from '../hooks/useMissionGit';
import './VisualGit.css';

const api        = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// ── Utilities ──────────────────────────────────────────────────────────

function useGitData(fetcher, interval = 0) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
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
          <button className={`vg-btn-xs${mode === 'split'   ? ' active' : ''}`} onClick={() => setMode('split')}>Split</button>
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
        <button className={`vg-btn-xs${mode === 'split'   ? ' active' : ''}`} onClick={() => setMode('split')}>Split</button>
      </div>
      <div className="vg-diff-body">
        {lines.map((line, i) => <DiffLine key={i} line={line} />)}
      </div>
    </div>
  );
}

// ── Commit graph with mission badges ───────────────────────────────────

function CommitGraph({ commits, onSelect, selected, missionHistory = [] }) {
  if (!commits?.length) return <div className="vg-empty">No commits found.</div>;

  // Build a set of mission-linked commit hashes for quick lookup
  const missionHashes = new Set(
    missionHistory.map(h => h.commitHash).filter(Boolean)
  );
  const hashToMission = {};
  for (const h of missionHistory) {
    if (h.commitHash) hashToMission[h.commitHash] = h;
  }

  return (
    <div className="vg-commit-graph">
      {commits.map((c, i) => {
        const isSelected = selected?.hash === c.hash;
        const mCtx       = hashToMission[c.hash] || hashToMission[c.hash?.slice(0, 8)];
        return (
          <div
            key={c.hash}
            className={`vg-commit-row${isSelected ? ' vg-commit-row--selected' : ''}${mCtx ? ' vg-commit-row--mission' : ''}`}
            onClick={() => onSelect(c)}
          >
            <div className="vg-commit-graph__track">
              <div className="vg-commit-line vg-commit-line--top" style={{ opacity: i === 0 ? 0 : 1 }} />
              <div className={`vg-commit-dot${mCtx ? ' vg-commit-dot--mission' : ''}`} />
              <div className="vg-commit-line vg-commit-line--bot" style={{ opacity: i === commits.length - 1 ? 0 : 1 }} />
            </div>
            <div className="vg-commit-info">
              <div className="vg-commit-header">
                <span className="vg-commit-hash" title={c.hash}>{c.hash?.slice(0, 7)}</span>
                {c.refs && c.refs.split(',').map(r => r.trim()).filter(Boolean).map(ref => (
                  <span key={ref} className={`vg-ref-badge${ref.includes('HEAD') ? ' vg-ref-badge--head' : ref.includes('origin') ? ' vg-ref-badge--remote' : ' vg-ref-badge--local'}`}>
                    {ref}
                  </span>
                ))}
                {mCtx && (
                  <span className="vg-ref-badge vg-ref-badge--mission" title={mCtx.objective}>
                    ◎ {mCtx.objective?.slice(0, 30)}
                  </span>
                )}
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

// ── Branch manager with mission branch creation ────────────────────────

function BranchManager({ cwd, onMessage, missionGit }) {
  const { missionContext, missionBranch, activeMission } = missionGit;
  const [creating,      setCreating]      = useState(false);
  const [newBranch,     setNewBranch]     = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const getBranches = useCallback(
    () => isElectron() ? api().gitBranches(cwd) : Promise.resolve({ branches: [], current: '' }),
    [cwd]
  );
  const { data, loading, error, refresh } = useGitData(getBranches);

  const checkout = useCallback(async (branch) => {
    const r = await missionBranch(branch, 'checkout');
    if (r?.error) onMessage?.(`Error: ${r.error}`, 'error');
    else { onMessage?.(`Checked out ${branch}`); refresh(); }
  }, [missionBranch, onMessage, refresh]);

  const createBranch = useCallback(async () => {
    if (!newBranch.trim()) return;
    setCreateLoading(true);
    const r = await missionBranch(newBranch.trim(), 'create');
    setCreateLoading(false);
    if (r?.error) onMessage?.(`Error: ${r.error}`, 'error');
    else {
      onMessage?.(`Created branch ${newBranch.trim()}${activeMission ? ' — recorded in mission' : ''}`);
      setNewBranch('');
      setCreating(false);
      refresh();
    }
  }, [newBranch, missionBranch, activeMission, onMessage, refresh]);

  if (loading) return <div className="vg-empty">Loading branches…</div>;
  if (error)   return <div className="vg-error">{error}</div>;

  const branches = data?.branches || [];
  const current  = data?.current  || '';

  return (
    <div className="vg-branch-list">
      {/* Mission branch suggestion */}
      {missionContext?.suggestedBranch && !branches.includes(missionContext.suggestedBranch) && (
        <div className="vg-mission-branch-hint">
          <span className="vg-mission-branch-hint__label">◎ Mission branch</span>
          <code className="vg-mission-branch-hint__name">{missionContext.suggestedBranch}</code>
          <button
            className="vg-btn-xs vg-btn-xs--purple"
            onClick={() => { setNewBranch(missionContext.suggestedBranch); setCreating(true); }}
          >
            Create
          </button>
        </div>
      )}

      {/* Create branch form */}
      {creating ? (
        <div className="vg-branch-create">
          <input
            className="vg-input"
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            placeholder="branch-name"
            onKeyDown={e => { if (e.key === 'Enter') createBranch(); if (e.key === 'Escape') setCreating(false); }}
            autoFocus
          />
          <button className="vg-btn-sm vg-btn-sm--green" onClick={createBranch} disabled={createLoading}>
            {createLoading ? '…' : 'Create'}
          </button>
          <button className="vg-btn-xs" onClick={() => setCreating(false)}>Cancel</button>
        </div>
      ) : (
        <button className="vg-btn-sm vg-branch-create-btn" onClick={() => setCreating(true)}>
          + New Branch
        </button>
      )}

      {/* Branch list */}
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
      const result = await api().shellExec({ command: 'git stash list --format="%gd|%s|%ci"', cwd });
      const lines  = (result?.stdout || '').split('\n').filter(Boolean);
      setStashes(lines.map(l => { const [ref, subject, date] = l.split('|'); return { ref, subject, date }; }));
    } catch {}
    setLoading(false);
  }, [cwd]);

  useEffect(() => { load(); }, [load]);

  const stashCmd = useCallback(async (cmd) => {
    const result = await api().shellExec({ command: `git ${cmd}`, cwd });
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
      const result = await api().shellExec({ command: 'git diff --name-only --diff-filter=U', cwd });
      setConflicts((result?.stdout || '').split('\n').filter(Boolean));
    } catch {}
    setLoading(false);
  }, [cwd]);

  useEffect(() => { load(); }, [load]);

  const viewConflict = useCallback(async (file) => {
    setSelected(file);
    const result = await api().fsReadFile({ filePath: `${cwd}/${file}` });
    setContent(result?.content || '');
  }, [cwd]);

  const resolve = useCallback(async (strategy) => {
    if (!selected) return;
    const cmd = strategy === 'ours'
      ? `git checkout --ours "${selected}" && git add "${selected}"`
      : `git checkout --theirs "${selected}" && git add "${selected}"`;
    await api().shellExec({ command: cmd, cwd });
    load();
    setSelected(null);
    setContent('');
  }, [selected, cwd, load]);

  if (loading) return <div className="vg-empty">Checking for conflicts…</div>;
  if (!conflicts.length) return <div className="vg-empty vg-empty--ok">No conflicts. Working tree is clean.</div>;

  return (
    <div className="vg-conflict">
      <div className="vg-conflict__list">
        {conflicts.map(f => (
          <div
            key={f}
            className={`vg-conflict__file${selected === f ? ' vg-conflict__file--selected' : ''}`}
            onClick={() => viewConflict(f)}
          >
            <span className="vg-status-badge vg-status-badge--red">!</span>
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

// ── Mission-Aware Commit Dialog ────────────────────────────────────────

function MissionCommitDialog({ cwd, missionGit, onCommit }) {
  const {
    activeMission, missionContext, pendingApproval,
    aiSummary, aiLoading,
    missionCommit, approveCommit, generateSummary,
    gitStatus, refreshStatus,
    setAiSummary,
  } = missionGit;

  const [message,    setMessage]    = useState('');
  const [isFinal,    setIsFinal]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [diffCache,  setDiffCache]  = useState('');
  const [diffLoaded, setDiffLoaded] = useState(false);

  // Pre-load diff for AI summary
  useEffect(() => {
    if (!isElectron() || !cwd || diffLoaded) return;
    api().gitDiff(cwd, null).then(r => {
      setDiffCache(r?.diff || r?.stdout || '');
      setDiffLoaded(true);
    }).catch(() => {});
  }, [cwd, diffLoaded]);

  const staged   = gitStatus?.staged   || [];
  const unstaged = gitStatus?.unstaged || [];

  const handleAI = useCallback(async () => {
    const files = [...staged, ...unstaged].map(f => f.path || f);
    const summary = await generateSummary(diffCache, files);
    if (summary) setMessage(summary);
  }, [staged, unstaged, diffCache, generateSummary]);

  useEffect(() => {
    if (aiSummary && !message) setMessage(aiSummary);
  }, [aiSummary]); // eslint-disable-line

  const commit = useCallback(async () => {
    if (!message.trim()) return;
    setLoading(true);
    const r = await missionCommit(message.trim(), { isFinal });
    setLoading(false);
    if (r?.error) {
      onCommit?.(`Error: ${r.error}`, 'error');
    } else if (r?.pendingApproval) {
      onCommit?.('Approval requested — commit queued for review', 'warn');
    } else {
      setMessage('');
      setIsFinal(false);
      onCommit?.(
        activeMission
          ? isFinal
            ? `Mission complete: ${message.trim()}`
            : `Committed + recorded in mission: ${message.trim()}`
          : `Committed: ${message.trim()}`,
        'ok'
      );
    }
  }, [message, isFinal, missionCommit, activeMission, onCommit]);

  return (
    <div className="vg-commit-dialog">
      {/* Mission context banner */}
      {activeMission && (
        <div className="vg-mission-banner">
          <span className="vg-mission-banner__icon">◎</span>
          <div className="vg-mission-banner__body">
            <div className="vg-mission-banner__label">Active Mission</div>
            <div className="vg-mission-banner__obj">{activeMission.objective}</div>
            {missionContext?.commitCount > 0 && (
              <div className="vg-mission-banner__commits">
                {missionContext.commitCount} commit{missionContext.commitCount !== 1 ? 's' : ''} recorded
              </div>
            )}
          </div>
          <span className={`vg-mission-banner__status vg-mission-banner__status--${activeMission.status}`}>
            {activeMission.status}
          </span>
        </div>
      )}

      {/* Pending approval notice */}
      {pendingApproval && (
        <div className="vg-approval-gate">
          <div className="vg-approval-gate__title">⚠ Approval Required</div>
          <div className="vg-approval-gate__desc">
            This mission requires approval before commits land. The request has been recorded.
          </div>
          <div className="vg-approval-gate__actions">
            <button className="vg-btn-sm vg-btn-sm--green" onClick={() => approveCommit(message)}>
              Approve &amp; Commit
            </button>
            <button className="vg-btn-xs" onClick={() => missionGit.setPendingApproval(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* File status — staged files with unstage button */}
      <div className="vg-commit-dialog__section">
        <div className="vg-commit-dialog__label-row">
          <span>Staged ({staged.length})</span>
          {staged.length > 0 && (
            <button className="vg-btn-xs vg-btn-xs--dim" onClick={async () => {
              await api().shellExec({ command: 'git restore --staged .', cwd });
              refreshStatus?.();
            }} title="Unstage all">Unstage all</button>
          )}
        </div>
        {staged.length
          ? staged.map((f, i) => (
              <div key={i} className="vg-status-file vg-status-file--staged">
                <span className="vg-status-badge vg-status-badge--green">{f.x || 'M'}</span>
                <span className="vg-status-file__name">{f.path || f}</span>
                <button className="vg-status-file__action" onClick={async e => {
                  e.stopPropagation();
                  await api().shellExec({ command: `git restore --staged "${f.path || f}"`, cwd });
                  refreshStatus?.();
                }} title="Unstage">↓</button>
              </div>
            ))
          : <div className="vg-empty">Nothing staged.</div>
        }
      </div>
      <div className="vg-commit-dialog__section">
        <div className="vg-commit-dialog__label-row">
          <span>Changes ({unstaged.length})</span>
          {unstaged.length > 0 && (
            <button className="vg-btn-xs vg-btn-xs--green" onClick={async () => {
              await api().shellExec({ command: 'git add -A', cwd });
              refreshStatus?.();
            }} title="Stage all">Stage all</button>
          )}
        </div>
        {unstaged.length
          ? unstaged.map((f, i) => (
              <div key={i} className="vg-status-file">
                <span className="vg-status-badge">{f.y || 'M'}</span>
                <span className="vg-status-file__name">{f.path || f}</span>
                <button className="vg-status-file__action vg-status-file__action--stage" onClick={async e => {
                  e.stopPropagation();
                  await api().shellExec({ command: `git add "${f.path || f}"`, cwd });
                  refreshStatus?.();
                }} title="Stage this file">↑</button>
              </div>
            ))
          : <div className="vg-empty">No unstaged changes.</div>
        }
      </div>

      {/* Commit message + AI */}
      <div className="vg-commit-dialog__input-area">
        <div className="vg-commit-ai-bar">
          <button
            className="vg-btn-xs vg-btn-xs--ai"
            onClick={handleAI}
            disabled={aiLoading}
            title="Generate commit message with AI"
          >
            {aiLoading ? '⟳ Generating…' : '✨ AI Summary'}
          </button>
          {aiSummary && (
            <span className="vg-commit-ai-badge" title="AI-generated">AI</span>
          )}
        </div>
        <textarea
          className="vg-commit-msg-input"
          placeholder="Commit message… (⌘+Enter to commit)"
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          onKeyDown={e => {
          if (e.metaKey && e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setMessage(''); }
        }}
        />
        <div className="vg-commit-dialog__hint">⌘+Enter to commit · Esc to clear</div>

        {/* Final commit toggle */}
        {activeMission && (
          <label className="vg-final-commit-toggle">
            <input
              type="checkbox"
              checked={isFinal}
              onChange={e => setIsFinal(e.target.checked)}
            />
            <span>Mark mission as complete after this commit</span>
          </label>
        )}

        <button
          className={`vg-btn vg-btn--primary${isFinal ? ' vg-btn--mission-complete' : ''}`}
          onClick={commit}
          disabled={loading || !message.trim() || pendingApproval}
        >
          {loading
            ? 'Committing…'
            : isFinal
            ? '⬡ Commit + Complete Mission'
            : activeMission
            ? '◎ Commit (Mission-Tracked)'
            : 'Commit All (git add -A)'
          }
        </button>
      </div>
    </div>
  );
}

// ── Mission git panel ──────────────────────────────────────────────────

function MissionGitPanel({ cwd, missionGit, onMessage }) {
  const {
    activeMission, missionContext, getMissionHistory, missionRollback, missionReview, refreshMission,
  } = missionGit;

  const [history,        setHistory]        = useState([]);
  const [hLoading,       setHLoading]       = useState(false);
  const [selected,       setSelected]       = useState(null);
  const [diff,           setDiff]           = useState(null);
  const [action,         setAction]         = useState(null); // 'rollback'|'review'
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [rollbackReason, setRollbackReason] = useState('');

  useEffect(() => {
    setHLoading(true);
    getMissionHistory(40).then(h => { setHistory(h); setHLoading(false); });
  }, [getMissionHistory]);

  const viewDiff = useCallback(async (hash) => {
    if (!hash || !isElectron()) return;
    setDiff(null);
    const r = await api().gitDiff(cwd, hash);
    setDiff(r?.diff || r?.stdout || '');
  }, [cwd]);

  const doRollback = useCallback((hash) => {
    setRollbackTarget(hash);
    setRollbackReason('Reverting problematic change');
  }, []);

  const doRollbackConfirm = useCallback(async () => {
    if (!rollbackReason.trim() || !rollbackTarget) return;
    const hash = rollbackTarget;
    setRollbackTarget(null);
    const r = await missionRollback(hash, rollbackReason.trim());
    if (r?.error) onMessage?.(`Rollback failed: ${r.error}`, 'error');
    else { onMessage?.(`Rolled back to ${hash.slice(0, 8)} — recorded in mission`); setAction(null); }
  }, [rollbackTarget, rollbackReason, missionRollback, onMessage]);

  const doReview = useCallback(async () => {
    const files = missionContext?.gitArtifacts?.flatMap(a => a.metadata?.filesChanged || []) || [];
    const r = await missionReview(files, `Review requested for ${activeMission?.objective}`);
    if (r?.error) onMessage?.(`Review request failed: ${r.error}`, 'error');
    else onMessage?.('Review request recorded in mission');
  }, [missionReview, missionContext, activeMission, onMessage]);

  return (
    <div className="vg-mission-panel">
      {rollbackTarget && (
        <div className="vg-rb-overlay" onClick={() => setRollbackTarget(null)}>
          <div className="vg-rb-dialog" onClick={e => e.stopPropagation()}>
            <div className="vg-rb-title">Rollback to {rollbackTarget.slice(0, 8)}</div>
            <input className="vg-rb-input" autoFocus value={rollbackReason} onChange={e => setRollbackReason(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doRollbackConfirm(); if (e.key === 'Escape') setRollbackTarget(null); }} placeholder="Reason for rollback…" />
            <div className="vg-rb-actions">
              <button className="vg-rb-btn vg-rb-btn--cancel" onClick={() => setRollbackTarget(null)}>Cancel</button>
              <button className="vg-rb-btn vg-rb-btn--confirm" onClick={doRollbackConfirm} disabled={!rollbackReason.trim()}>Rollback</button>
            </div>
          </div>
        </div>
      )}
      {/* Active mission header */}
      {activeMission ? (
        <div className="vg-mission-panel__header">
          <div className="vg-mission-panel__title">
            <span className="vg-mission-panel__icon">◎</span>
            <div>
              <div className="vg-mission-panel__objective">{activeMission.objective}</div>
              <div className="vg-mission-panel__meta">
                <span className={`vg-mission-status vg-mission-status--${activeMission.status}`}>
                  {activeMission.status}
                </span>
                {missionContext?.suggestedBranch && (
                  <span className="vg-mission-panel__branch">⎇ {missionContext.suggestedBranch}</span>
                )}
              </div>
            </div>
          </div>
          <div className="vg-mission-panel__actions">
            <button className="vg-btn-xs vg-btn-xs--purple" onClick={doReview} title="Request code review">
              ★ Review
            </button>
            <button className="vg-btn-xs" onClick={refreshMission} title="Refresh">↻</button>
          </div>
        </div>
      ) : (
        <div className="vg-mission-panel__no-mission">
          <span className="vg-mission-panel__no-mission-icon">◻</span>
          <div>No active mission</div>
          <div className="vg-mission-panel__hint">Start a mission to link commits to engineering context</div>
        </div>
      )}

      {/* Git stats for active mission */}
      {missionContext && (
        <div className="vg-mission-panel__stats">
          <div className="vg-mission-stat">
            <span className="vg-mission-stat__val">{missionContext.commitCount}</span>
            <span className="vg-mission-stat__label">Commits</span>
          </div>
          <div className="vg-mission-stat">
            <span className="vg-mission-stat__val">{missionContext.gitDecisions?.length || 0}</span>
            <span className="vg-mission-stat__label">Decisions</span>
          </div>
          <div className="vg-mission-stat">
            <span className="vg-mission-stat__val">{missionContext.gitArtifacts?.length || 0}</span>
            <span className="vg-mission-stat__label">Artifacts</span>
          </div>
          <div className="vg-mission-stat">
            <span className={`vg-mission-stat__val ${missionContext.requiresApproval ? 'vg-mission-stat__val--warn' : 'vg-mission-stat__val--ok'}`}>
              {missionContext.requiresApproval ? 'Yes' : 'No'}
            </span>
            <span className="vg-mission-stat__label">Approval</span>
          </div>
        </div>
      )}

      {/* Mission-linked commit history */}
      <div className="vg-mission-panel__section-label">Mission Commit History</div>
      {hLoading ? (
        <div className="vg-empty">Loading…</div>
      ) : !history.length ? (
        <div className="vg-empty">No mission-linked commits yet.</div>
      ) : history.map((h, i) => (
        <div
          key={i}
          className={`vg-mission-commit${selected === i ? ' vg-mission-commit--selected' : ''}`}
          onClick={() => { setSelected(i); viewDiff(h.commitHash); }}
        >
          <div className="vg-mission-commit__header">
            <span className="vg-mission-commit__hash">{(h.commitHash || '').slice(0, 7)}</span>
            {h.isFinal && <span className="vg-badge vg-badge--green">final</span>}
            <span className={`vg-badge vg-badge--${h.missionStatus === 'completed' ? 'green' : h.missionStatus === 'failed' ? 'red' : 'purple'}`}>
              {h.missionStatus}
            </span>
          </div>
          <div className="vg-mission-commit__msg">{h.commitMessage}</div>
          <div className="vg-mission-commit__meta">
            <span className="vg-mission-commit__obj" title={h.objective}>
              ◎ {h.objective?.slice(0, 40)}
            </span>
            {h.branch && <span className="vg-mission-commit__branch">⎇ {h.branch}</span>}
          </div>
          {selected === i && (
            <div className="vg-mission-commit__actions">
              <button
                className="vg-btn-xs vg-btn-xs--red"
                onClick={e => { e.stopPropagation(); doRollback(h.commitHash); }}
                title="Revert this commit (recorded in mission)"
              >
                ↩ Rollback
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Inline diff for selected history item */}
      {diff && selected !== null && (
        <div className="vg-mission-panel__diff">
          <DiffViewer diff={diff} title="Commit diff" />
        </div>
      )}
    </div>
  );
}

// ── Main VisualGit ─────────────────────────────────────────────────────

const TABS = [
  { id: 'mission',   label: '◎ Mission' },
  { id: 'graph',     label: 'Graph' },
  { id: 'diff',      label: 'Diff' },
  { id: 'branches',  label: 'Branches' },
  { id: 'commit',    label: 'Commit' },
  { id: 'stash',     label: 'Stash' },
  { id: 'conflicts', label: 'Conflicts' },
];

export default function VisualGit({ cwd, className = '' }) {
  const [tab,      setTab]      = useState('mission');
  const [selected, setSelected] = useState(null);
  const [diff,     setDiff]     = useState(null);
  const [diffFile, setDiffFile] = useState(null);
  const [msg,      setMsg]      = useState(null);
  const [history,  setHistory]  = useState([]);
  const [pulling,  setPulling]  = useState(false);
  const [pushing,  setPushing]  = useState(false);

  const workdir  = cwd || process?.env?.HOME || '/';
  const missionGit = useMissionGit(workdir);
  const { activeMission, getMissionHistory } = missionGit;

  const fetchLog = useCallback(
    () => isElectron() ? api().gitLog(workdir, 50) : Promise.resolve({ commits: [] }),
    [workdir]
  );
  const { data: logData, loading: logLoading, error: logError, refresh: refreshLog } = useGitData(fetchLog, 15000);
  const commits = logData?.commits || [];

  // Load mission-linked commit history for the graph badge overlay
  useEffect(() => {
    getMissionHistory(50).then(setHistory);
  }, [getMissionHistory]);

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
    setTimeout(() => setMsg(null), 4500);
  }, []);

  const gitPull = useCallback(async () => {
    setPulling(true);
    const r = await api().shellExec({ command: 'git pull', cwd: workdir });
    setPulling(false);
    onMessage(r?.stdout?.trim() || r?.stderr?.trim() || 'Pull complete');
    refreshLog();
  }, [workdir, onMessage, refreshLog]);

  const gitPush = useCallback(async () => {
    setPushing(true);
    const r = await api().shellExec({ command: 'git push', cwd: workdir });
    setPushing(false);
    const out = r?.stderr?.trim() || r?.stdout?.trim() || 'Push complete';
    const isErr = r?.code !== 0;
    onMessage(out, isErr ? 'error' : 'ok');
  }, [workdir, onMessage]);

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
        {activeMission && (
          <span className="vg-header__mission" title={activeMission.objective}>
            ◎ {activeMission.objective?.slice(0, 24)}
          </span>
        )}
        <span className="vg-header__cwd" title={workdir}>{workdir.split('/').slice(-2).join('/')}</span>
        <button className="vg-header__btn" onClick={refreshLog} title="Refresh">↻</button>
        <button className="vg-header__btn" onClick={gitPull} disabled={pulling} title="git pull">
          {pulling ? '…' : '⇣'}
        </button>
        <button className="vg-header__btn" onClick={gitPush} disabled={pushing} title="git push">
          {pushing ? '…' : '⇡'}
        </button>
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
            className={`vg-tab${tab === t.id ? ' vg-tab--active' : ''}${t.id === 'mission' && activeMission ? ' vg-tab--mission' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="vg-body">
        {tab === 'mission' && (
          <MissionGitPanel cwd={workdir} missionGit={missionGit} onMessage={onMessage} />
        )}

        {tab === 'graph' && (
          logLoading ? <div className="vg-empty">Loading commits…</div>
          : logError  ? <div className="vg-error">{logError}</div>
          : <CommitGraph commits={commits} selected={selected} onSelect={selectCommit} missionHistory={history} />
        )}

        {tab === 'diff' && (
          <DiffViewer diff={diff} title={diffFile || selected?.subject} sideBySide />
        )}

        {tab === 'branches' && (
          <BranchManager cwd={workdir} onMessage={onMessage} missionGit={missionGit} />
        )}

        {tab === 'commit' && (
          <MissionCommitDialog
            cwd={workdir}
            missionGit={missionGit}
            onCommit={(text, type) => { onMessage(text, type); refreshLog(); missionGit.refreshMission(); }}
          />
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
