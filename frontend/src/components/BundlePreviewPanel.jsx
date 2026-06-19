import React, { useState, useEffect, useCallback, useRef } from 'react';
import { _fetch } from '../_client';
import './BundlePreviewPanel.css';

async function api(method, path, body) {
  return _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
}

// ── Role badge ─────────────────────────────────────────────────────────
const ROLE_META = {
  primary:   { color: '#f59e0b', label: 'primary'   },
  affected:  { color: '#60a5fa', label: 'affected'  },
  test:      { color: '#10b981', label: 'test'      },
  docs:      { color: '#a78bfa', label: 'docs'      },
  changelog: { color: '#6b7280', label: 'changelog' },
};

function RoleBadge({ role }) {
  const m = ROLE_META[role] || { color: '#4b5563', label: role || '?' };
  return (
    <span className="bpp-role-badge" style={{ borderColor: m.color, color: m.color }}>
      {m.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    planning:    '#6b7280', planned: '#60a5fa', ready: '#10b981',
    applying:    '#f59e0b', applied: '#10b981',
    failed:      '#ef4444', rolled_back: '#a78bfa',
  };
  return (
    <span className="bpp-status-badge" style={{ color: map[status] || '#6b7280', borderColor: map[status] || '#374151' }}>
      {status?.replace('_', ' ')}
    </span>
  );
}

// ── Dep graph mini visual ──────────────────────────────────────────────
function DepGraph({ files, depGraph }) {
  if (!files?.length) return null;
  const hasEdges = depGraph && Object.values(depGraph).some(d => d.length > 0);
  if (!hasEdges) {
    return <div className="bpp-depgraph-empty">No cross-file dependencies detected</div>;
  }
  return (
    <div className="bpp-depgraph">
      {files.map(f => {
        const deps = depGraph[f.path] || [];
        const relevantDeps = deps.filter(d => files.find(ff => ff.path === d));
        if (!relevantDeps.length) return null;
        return (
          <div key={f.path} className="bpp-depgraph__row">
            <span className="bpp-depgraph__from">{f.path.split('/').pop()}</span>
            <span className="bpp-depgraph__arrow">→</span>
            <span className="bpp-depgraph__to">{relevantDeps.map(d => d.split('/').pop()).join(', ')}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── File patch card ────────────────────────────────────────────────────
function FilePatchCard({ file, index }) {
  const [expanded, setExpanded] = useState(index === 0);

  const validPatches   = (file.patchSpecs || []).filter(s => s.valid);
  const invalidPatches = (file.patchSpecs || []).filter(s => !s.valid);

  return (
    <div className={`bpp-file-card bpp-file-card--${file.valid ? 'valid' : 'invalid'}`}>
      <div className="bpp-file-card__header" onClick={() => setExpanded(e => !e)}>
        <span className="bpp-file-card__idx">#{index + 1}</span>
        <span className={`bpp-file-card__valid-dot ${file.valid ? 'bpp-dot--valid' : 'bpp-dot--invalid'}`} />
        <span className="bpp-file-card__path">{file.path}</span>
        <RoleBadge role={file.role} />
        {file.isNew && <span className="bpp-file-card__new-tag">NEW</span>}
        <span className="bpp-file-card__count">
          {file.isNew ? '1 file' : `${validPatches.length} patch${validPatches.length !== 1 ? 'es' : ''}`}
        </span>
        <span className="bpp-file-card__conf">{Math.round((file.confidence || 0) * 100)}%</span>
        <button className="bpp-file-card__expand">{expanded ? '▾' : '▸'}</button>
      </div>

      {file.error && (
        <div className="bpp-file-card__error">⚠ {file.error}</div>
      )}

      {expanded && (
        <div className="bpp-file-card__body">
          {file.explanation && (
            <div className="bpp-file-card__explanation">{file.explanation}</div>
          )}

          {file.isNew && file.newContent && (
            <div className="bpp-patch-diff">
              <div className="bpp-patch-diff__label">New file content (preview)</div>
              <pre className="bpp-patch-diff__code bpp-patch-diff__add">
                {file.newContent.slice(0, 600)}{file.newContent.length > 600 ? '\n…' : ''}
              </pre>
            </div>
          )}

          {validPatches.map((spec, i) => (
            <div key={i} className="bpp-patch-diff">
              <div className="bpp-patch-diff__label">{spec.description || `Change ${i + 1}`}</div>
              <div className="bpp-patch-diff__hunk">
                <div className="bpp-patch-diff__del">
                  <span className="bpp-patch-diff__marker">−</span>
                  <span className="bpp-patch-diff__code">{spec.patchTarget}</span>
                </div>
                <div className="bpp-patch-diff__add">
                  <span className="bpp-patch-diff__marker">+</span>
                  <span className="bpp-patch-diff__code">{spec.patchReplacement}</span>
                </div>
              </div>
            </div>
          ))}

          {invalidPatches.map((spec, i) => (
            <div key={i} className="bpp-patch-invalid">
              <span className="bpp-patch-invalid__icon">✕</span>
              <span className="bpp-patch-invalid__msg">{spec.error} — "{spec.patchTarget?.slice(0, 60)}"</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pipeline tracker ───────────────────────────────────────────────────
function PipelineStatus({ pipelineId }) {
  const [run, setRun] = useState(null);
  useEffect(() => {
    if (!pipelineId) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api('GET', `/pipeline/${pipelineId}`);
        if (r?.run) { setRun(r.run); if (['completed','failed','cancelled'].includes(r.run.status)) return; }
      } catch {}
      if (active) setTimeout(poll, 2000);
    };
    poll();
    return () => { active = false; };
  }, [pipelineId]);

  if (!run) return null;
  const statusColor = run.status === 'completed' ? '#10b981' : run.status === 'failed' ? '#ef4444' : '#f59e0b';
  return (
    <div className="bpp-pipeline" style={{ borderColor: statusColor }}>
      <span className="bpp-pipeline__label">Pipeline</span>
      <span className="bpp-pipeline__status" style={{ color: statusColor }}>{run.status}</span>
      <span className="bpp-pipeline__id">{pipelineId?.slice(0, 8)}</span>
    </div>
  );
}

// ── Bundle list item ───────────────────────────────────────────────────
function BundleListItem({ bundle, onSelect, active }) {
  return (
    <div
      className={`bpp-list-item ${active ? 'bpp-list-item--active' : ''}`}
      onClick={() => onSelect(bundle.bundleId)}
    >
      <div className="bpp-list-item__head">
        <StatusBadge status={bundle.status} />
        <span className="bpp-list-item__goal">{bundle.goal?.slice(0, 55)}</span>
      </div>
      <div className="bpp-list-item__meta">
        <span>{bundle.fileCount || 0} files</span>
        <span>·</span>
        <span>{bundle.metrics?.depConfidence || 0}% conf</span>
        {bundle.plan?.riskLevel && <span className={`bpp-list-item__risk bpp-risk--${bundle.plan.riskLevel}`}>{bundle.plan.riskLevel}</span>}
        <span className="bpp-list-item__ts">{bundle.createdAt ? new Date(bundle.createdAt).toLocaleTimeString() : ''}</span>
      </div>
    </div>
  );
}

// ── Main BundlePreviewPanel ────────────────────────────────────────────
export default function BundlePreviewPanel({ cwd, onApplied }) {
  const [goal,         setGoal]         = useState('');
  const [planning,     setPlanning]     = useState(false);
  const [applying,     setApplying]     = useState(false);
  const [rolling,      setRolling]      = useState(false);
  const [bundle,       setBundle]       = useState(null);
  const [bundles,      setBundles]      = useState([]);
  const [applyResult,  setApplyResult]  = useState(null);
  const [error,        setError]        = useState(null);
  const [stats,        setStats]        = useState(null);
  const [view,         setView]         = useState('new'); // 'new' | 'history' | 'stats'
  const [requireApproval, setRequireApproval] = useState(false);
  const goalRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await api('GET', '/coding/bundles?limit=15');
      if (r?.ok) setBundles(r.bundles || []);
    } catch {}
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const r = await api('GET', '/coding/bundle/stats');
      if (r?.ok) setStats(r.stats);
    } catch {}
  }, []);

  useEffect(() => { loadHistory(); loadStats(); }, [loadHistory, loadStats]);

  const plan = useCallback(async () => {
    if (!goal.trim()) return;
    setPlanning(true);
    setError(null);
    setBundle(null);
    setApplyResult(null);
    try {
      const r = await api('POST', '/coding/bundle/plan', { goal, cwd });
      if (r?.ok) { setBundle(r.bundle); loadHistory(); }
      else setError(r?.error || 'Planning failed');
    } catch (e) { setError(e.message); }
    finally { setPlanning(false); }
  }, [goal, cwd, loadHistory]);

  const apply = useCallback(async () => {
    if (!bundle?.bundleId) return;
    setApplying(true);
    setError(null);
    try {
      const r = await api('POST', '/coding/bundle/apply', { bundleId: bundle.bundleId, requireApproval });
      if (r?.ok) {
        setApplyResult(r);
        setBundle(b => ({ ...b, status: 'applied' }));
        loadHistory(); loadStats();
        onApplied?.(r);
      } else setError(r?.error || 'Apply failed');
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }, [bundle, requireApproval, loadHistory, loadStats, onApplied]);

  const rollback = useCallback(async () => {
    if (!bundle?.bundleId) return;
    if (!window.confirm('Roll back all changes in this bundle?')) return;
    setRolling(true);
    try {
      const r = await api('POST', `/coding/bundle/${bundle.bundleId}/rollback`);
      if (r?.ok) {
        setBundle(b => ({ ...b, status: 'rolled_back' }));
        loadHistory();
      } else setError(r?.error || 'Rollback failed');
    } catch (e) { setError(e.message); }
    finally { setRolling(false); }
  }, [bundle, loadHistory]);

  const loadBundle = useCallback(async (id) => {
    try {
      const r = await api('GET', `/coding/bundle/${id}`);
      if (r?.ok) { setBundle(r.bundle); setView('new'); }
    } catch {}
  }, []);

  const canApply    = bundle?.status === 'ready'   && (bundle?.metrics?.patchesValid || 0) > 0;
  const canRollback = bundle?.status === 'applied';

  // Stats view
  if (view === 'stats' && stats) {
    return (
      <div className="bpp-root">
        <div className="bpp-header">
          <span className="bpp-header__title">Bundle Stats</span>
          <button className="bpp-hdr-btn" onClick={() => setView('new')}>← Back</button>
        </div>
        <div className="bpp-stats-grid">
          {[
            { label: 'Total Bundles',      val: stats.total,              color: '#d1d5db' },
            { label: 'Applied',            val: stats.applied,            color: '#10b981' },
            { label: 'Rolled Back',        val: stats.rolledBack,         color: '#a78bfa' },
            { label: 'Files Touched',      val: stats.totalFilesTouched,  color: '#60a5fa' },
            { label: 'Patch Success Rate', val: `${stats.patchSuccessRate}%`, color: '#10b981' },
            { label: 'Dep Confidence',     val: `${stats.avgDepConfidence}%`, color: '#f59e0b' },
            { label: 'Replace Cursor',     val: `${stats.replaceCursorScore}/100`, color: '#f59e0b' },
            { label: 'Build Ooplix Score', val: `${stats.buildOoplixScore}/100`,   color: '#10b981' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bpp-stats-tile">
              <div className="bpp-stats-tile__val" style={{ color }}>{val}</div>
              <div className="bpp-stats-tile__label">{label}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bpp-root">
      {/* Header */}
      <div className="bpp-header">
        <span className="bpp-header__title">Repository Bundle Edit</span>
        <div className="bpp-header__tabs">
          <button className={`bpp-hdr-tab ${view === 'new' ? 'bpp-hdr-tab--active' : ''}`} onClick={() => setView('new')}>New</button>
          <button className={`bpp-hdr-tab ${view === 'history' ? 'bpp-hdr-tab--active' : ''}`} onClick={() => { setView('history'); loadHistory(); }}>History</button>
          <button className={`bpp-hdr-tab ${view === 'stats' ? 'bpp-hdr-tab--active' : ''}`} onClick={() => { setView('stats'); loadStats(); }}>Stats</button>
        </div>
      </div>

      {/* History view */}
      {view === 'history' && (
        <div className="bpp-history">
          {bundles.length === 0 && <div className="bpp-empty">No bundles yet.</div>}
          {bundles.map(b => (
            <BundleListItem
              key={b.bundleId}
              bundle={b}
              active={bundle?.bundleId === b.bundleId}
              onSelect={loadBundle}
            />
          ))}
        </div>
      )}

      {/* New / plan view */}
      {view === 'new' && (
        <>
          {/* Goal input */}
          {!bundle && (
            <div className="bpp-goal-area">
              <div className="bpp-goal-examples">
                <span className="bpp-goal-examples__label">Examples:</span>
                {[
                  'Rename UserService to AccountService everywhere',
                  'Migrate all fetch() calls to use apiClient wrapper',
                  'Add JSDoc comments to all exported functions',
                  'Convert all console.log to logger.info in backend',
                  'Update imports after moving utils to /shared',
                ].map(ex => (
                  <button key={ex} className="bpp-goal-example" onClick={() => setGoal(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
              <textarea
                ref={goalRef}
                className="bpp-goal-input"
                placeholder="Describe the repository-wide change you want to make…"
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') plan(); }}
                rows={3}
              />
              <div className="bpp-goal-actions">
                <button
                  className="bpp-plan-btn"
                  disabled={!goal.trim() || planning}
                  onClick={plan}
                >
                  {planning ? '⟳ Analyzing repository…' : '⚡ Plan Multi-File Edit'}
                </button>
              </div>
            </div>
          )}

          {error && <div className="bpp-error">{error}</div>}

          {/* Bundle summary */}
          {bundle && (
            <div className="bpp-bundle">
              {/* Bundle header */}
              <div className="bpp-bundle__head">
                <div className="bpp-bundle__goal">{bundle.goal}</div>
                <StatusBadge status={bundle.status} />
              </div>

              {bundle.plan && (
                <div className="bpp-plan-summary">
                  <div className="bpp-plan-summary__text">{bundle.plan.summary}</div>
                  <div className="bpp-plan-summary__meta">
                    <span className={`bpp-risk-badge bpp-risk--${bundle.plan.riskLevel}`}>{bundle.plan.riskLevel} risk</span>
                    <span className="bpp-plan-summary__conf">{Math.round((bundle.plan.confidence || 0) * 100)}% confidence</span>
                    {bundle.plan.commitMsg && <span className="bpp-plan-summary__commit">{bundle.plan.commitMsg}</span>}
                  </div>
                </div>
              )}

              {/* Metrics bar */}
              {bundle.metrics && (
                <div className="bpp-metrics-bar">
                  <div className="bpp-metric"><span className="bpp-metric__n">{bundle.metrics.filesTouched}</span><span className="bpp-metric__l">files</span></div>
                  <div className="bpp-metric"><span className="bpp-metric__n bpp-metric__n--good">{bundle.metrics.patchesValid}</span><span className="bpp-metric__l">valid</span></div>
                  {bundle.metrics.patchesInvalid > 0 && (
                    <div className="bpp-metric"><span className="bpp-metric__n bpp-metric__n--bad">{bundle.metrics.patchesInvalid}</span><span className="bpp-metric__l">invalid</span></div>
                  )}
                  <div className="bpp-metric"><span className="bpp-metric__n">{bundle.metrics.depConfidence}%</span><span className="bpp-metric__l">dep conf</span></div>
                </div>
              )}

              {/* Apply order */}
              {bundle.applyOrder?.length > 0 && (
                <div className="bpp-apply-order">
                  <span className="bpp-apply-order__label">Apply order:</span>
                  {bundle.applyOrder.map((p, i) => (
                    <span key={p} className="bpp-apply-order__file">
                      {i > 0 && <span className="bpp-apply-order__arrow">→</span>}
                      {p.split('/').pop()}
                    </span>
                  ))}
                </div>
              )}

              {/* Dep graph */}
              {bundle.depGraph && (
                <DepGraph files={bundle.files} depGraph={bundle.depGraph} />
              )}

              {/* File patches */}
              <div className="bpp-files">
                <div className="bpp-files__label">File Changes ({(bundle.files || []).length})</div>
                {(bundle.files || []).map((f, i) => (
                  <FilePatchCard key={f.path} file={f} index={i} />
                ))}
              </div>

              {/* Apply result */}
              {applyResult && (
                <div className="bpp-apply-result">
                  <div className="bpp-apply-result__head">
                    ✓ Applied {applyResult.applied?.length || 0} file{(applyResult.applied?.length || 0) !== 1 ? 's' : ''}
                  </div>
                  {applyResult.changelog && (
                    <div className="bpp-apply-result__changelog">Changelog: {applyResult.changelog}</div>
                  )}
                  {applyResult.pipelineId && (
                    <PipelineStatus pipelineId={applyResult.pipelineId} />
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="bpp-bundle-actions">
                {canApply && (
                  <>
                    <label className="bpp-approval-check">
                      <input
                        type="checkbox"
                        checked={requireApproval}
                        onChange={e => setRequireApproval(e.target.checked)}
                      />
                      Require pipeline approval gate
                    </label>
                    <button
                      className="bpp-apply-btn"
                      disabled={applying}
                      onClick={apply}
                    >
                      {applying ? '⟳ Applying…' : `⚡ Apply ${bundle.metrics?.patchesValid} patch${bundle.metrics?.patchesValid !== 1 ? 'es' : ''} → Pipeline`}
                    </button>
                  </>
                )}
                {canRollback && (
                  <button className="bpp-rollback-btn" disabled={rolling} onClick={rollback}>
                    {rolling ? '⟳ Rolling back…' : '↩ Rollback Bundle'}
                  </button>
                )}
                <button className="bpp-new-btn" onClick={() => { setBundle(null); setGoal(''); setApplyResult(null); setError(null); }}>
                  + New Bundle
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
