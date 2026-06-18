import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { _fetch } from '../_client';
import './SmellsPanel.css';

const PatchPreviewPanel = lazy(() => import('./PatchPreviewPanel'));

async function post(path, body) {
  return _fetch(path, { method: 'POST', body: JSON.stringify(body) });
}
async function get(path) {
  return _fetch(path);
}

// ── Type badge ─────────────────────────────────────────────────────────
const TYPE_META = {
  todo_fixme:         { icon: '📝', label: 'TODO/FIXME',       color: '#6b7280' },
  duplicate_literal:  { icon: '©',  label: 'Dup Literal',      color: '#6b7280' },
  empty_catch:        { icon: '⚠',  label: 'Empty Catch',      color: '#f59e0b' },
  console_log_prod:   { icon: '🖨', label: 'console.log',      color: '#6b7280' },
  sync_fs:            { icon: '⛔', label: 'Sync FS',          color: '#f59e0b' },
  blocking_crypto:    { icon: '🔐', label: 'Blocking Crypto',  color: '#ef4444' },
  long_function:      { icon: '📏', label: 'Long Function',    color: '#f59e0b' },
  stale_feature_flag: { icon: '🚩', label: 'Stale Flag',       color: '#6b7280' },
  stale_mission:      { icon: '⏰', label: 'Stale Mission',    color: '#f59e0b' },
  build_failure:      { icon: '🔴', label: 'Build Failure',    color: '#ef4444' },
  benchmark_decline:  { icon: '📉', label: 'Perf Decline',     color: '#f59e0b' },
};

function TypeBadge({ type }) {
  const meta = TYPE_META[type] || { icon: '◦', label: type, color: '#6b7280' };
  return (
    <span className="smell-type-badge" style={{ borderColor: meta.color, color: meta.color }}>
      {meta.icon} {meta.label}
    </span>
  );
}

function SevBadge({ severity }) {
  return <span className={`smell-sev-badge smell-sev-badge--${severity}`}>{severity}</span>;
}

// ── Summary bar ────────────────────────────────────────────────────────
function SummaryBar({ summary, loading, onRefresh }) {
  if (!summary && !loading) return null;
  return (
    <div className="smells-summary">
      <div className="smells-summary__counts">
        {loading ? (
          <span className="smells-summary__loading">Scanning…</span>
        ) : (
          <>
            <span className="smells-summary__count smells-summary__count--high">{summary?.high || 0} high</span>
            <span className="smells-summary__count smells-summary__count--medium">{summary?.medium || 0} medium</span>
            <span className="smells-summary__count smells-summary__count--low">{summary?.low || 0} low</span>
            <span className="smells-summary__sep">·</span>
            <span className="smells-summary__conf">{summary?.avgConfidence || 0}% avg confidence</span>
            {summary?.estimatedMinutesSaved > 0 && (
              <>
                <span className="smells-summary__sep">·</span>
                <span className="smells-summary__saved">~{summary.estimatedMinutesSaved}min saved if fixed</span>
              </>
            )}
          </>
        )}
      </div>
      <button className="smells-refresh-btn" onClick={onRefresh} disabled={loading} title="Rescan">
        {loading ? '⟳' : '↻'}
      </button>
    </div>
  );
}

// ── Single Recommendation Card ─────────────────────────────────────────
function SmellCard({ smell, cwd, onDismiss, onPatch, onConvertToMission }) {
  const [expanded, setExpanded] = useState(false);
  const [converting, setConverting] = useState(false);

  const convertToMission = useCallback(async () => {
    if (converting) return;
    setConverting(true);
    try {
      const r = await post('/coding/convert-to-mission', {
        goal: smell.detail,
        patchSpecs: smell.aiPatchSpec ? [smell.aiPatchSpec] : [],
        affectedFiles: smell.affectedFiles || [],
        confidence: smell.confidence,
        riskLevel: smell.severity === 'high' ? 'high' : smell.severity === 'medium' ? 'medium' : 'low',
      });
      if (r?.ok) onConvertToMission?.(r.mission);
    } catch {} finally { setConverting(false); }
  }, [converting, smell, onConvertToMission]);

  return (
    <div className={`smell-card smell-card--${smell.severity}`}>
      <div className="smell-card__header" onClick={() => setExpanded(e => !e)}>
        <div className="smell-card__badges">
          <SevBadge severity={smell.severity} />
          <TypeBadge type={smell.type} />
        </div>
        <div className="smell-card__arrow">{expanded ? '▾' : '▸'}</div>
      </div>

      <div className="smell-card__detail">{smell.detail}</div>

      {smell.file && (
        <div className="smell-card__location">
          <span className="smell-card__file">{smell.file}</span>
          {smell.line && <span className="smell-card__line">:{smell.line}</span>}
        </div>
      )}

      <div className="smell-card__meta">
        <div className="smell-card__conf-bar">
          <div
            className="smell-card__conf-fill"
            style={{ width: `${Math.round((smell.confidence || 0) * 100)}%` }}
          />
        </div>
        <span className="smell-card__conf-label">{Math.round((smell.confidence || 0) * 100)}%</span>
        {smell.estimatedMinutesSaved > 0 && (
          <span className="smell-card__time">~{smell.estimatedMinutesSaved}min</span>
        )}
      </div>

      {expanded && (
        <div className="smell-card__body">
          {smell.patchHint && (
            <div className="smell-card__hint">
              <span className="smell-card__hint-label">Hint</span>
              {smell.patchHint}
            </div>
          )}
          {smell.aiPatchSpec && (
            <div className="smell-card__ai-patch">
              <span className="smell-card__ai-label">AI Patch Ready</span>
              <div className="smell-card__patch-target">
                <span className="diff-del">- {smell.aiPatchSpec.patchTarget?.slice(0, 80)}</span>
                <span className="diff-add">+ {smell.aiPatchSpec.patchReplacement?.slice(0, 80)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="smell-card__actions">
        {smell.aiPatchSpec && (
          <button className="smell-action-btn smell-action-btn--patch" onClick={() => onPatch(smell)}>
            ⚡ Preview Patch
          </button>
        )}
        <button className="smell-action-btn smell-action-btn--mission" onClick={convertToMission} disabled={converting}>
          {converting ? '…' : '→ Mission'}
        </button>
        <button className="smell-action-btn smell-action-btn--dismiss" onClick={() => onDismiss(smell.id)}>
          Ignore
        </button>
      </div>
    </div>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────
function FilterBar({ filter, setFilter, typeFilter, setTypeFilter, types }) {
  return (
    <div className="smells-filter-bar">
      <div className="smells-filter-sev">
        {['all', 'high', 'medium', 'low'].map(s => (
          <button
            key={s}
            className={`smells-filter-btn ${filter === s ? 'smells-filter-btn--active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <select
        className="smells-type-select"
        value={typeFilter}
        onChange={e => setTypeFilter(e.target.value)}
      >
        <option value="">All types</option>
        {types.map(t => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
      </select>
    </div>
  );
}

// ── Main SmellsPanel ───────────────────────────────────────────────────
export default function SmellsPanel({ cwd }) {
  const [smells,     setSmells]     = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [filter,     setFilter]     = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [patchSmell, setPatchSmell] = useState(null); // smell with aiPatchSpec to preview
  const [lastScan,   setLastScan]   = useState(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = cwd ? `?cwd=${encodeURIComponent(cwd)}&enrichAI=true` : '?enrichAI=true';
      const r = await get(`/coding/smells${params}`);
      if (r?.ok) {
        setSmells(r.smells || []);
        setSummary(r.summary);
        setLastScan(new Date());
      } else {
        setError(r?.error || 'Scan failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // Auto-scan on mount and every 5 minutes
  useEffect(() => { scan(); }, [scan]);
  useEffect(() => {
    const id = setInterval(scan, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [scan]);

  const dismiss = useCallback(async (id) => {
    try {
      const r = await post('/coding/smells/dismiss', { smellId: id });
      if (r?.ok) setSmells(s => s.filter(x => x.id !== id));
    } catch {}
  }, []);

  const openPatch = useCallback((smell) => {
    setPatchSmell(smell);
  }, []);

  const handlePatchApplied = useCallback(() => {
    setPatchSmell(null);
    setTimeout(scan, 1000);
  }, [scan]);

  const handleConvertToMission = useCallback(() => {
    // No-op here — mission was created, just give feedback
  }, []);

  // Filtered smells
  const allTypes = [...new Set(smells.map(s => s.type))].sort();
  const filtered = smells.filter(s => {
    if (filter !== 'all' && s.severity !== filter) return false;
    if (typeFilter && s.type !== typeFilter) return false;
    return true;
  });

  if (patchSmell) {
    return (
      <div className="smells-patch-view">
        <div className="smells-patch-view__back">
          <button className="smells-back-btn" onClick={() => setPatchSmell(null)}>← Back to smells</button>
          <span className="smells-patch-view__title">{patchSmell.type} in {patchSmell.file}</span>
        </div>
        <Suspense fallback={<div style={{ padding: 12, color: '#4b5563' }}>Loading…</div>}>
          <PatchPreviewPanel
            goal={patchSmell.detail}
            proposal={{
              explanation: patchSmell.detail,
              reasoning: patchSmell.patchHint || "",
              affectedFiles: patchSmell.affectedFiles || [],
              confidence: patchSmell.confidence,
              riskLevel: patchSmell.severity === 'high' ? 'high' : patchSmell.severity === 'medium' ? 'medium' : 'low',
              riskReason: `Detected by engineering smell scanner (${patchSmell.type})`,
              patchSpecs: patchSmell.aiPatchSpec ? [{ ...patchSmell.aiPatchSpec, valid: true }] : [],
              unifiedDiff: "",
              commitMsg: `fix(${patchSmell.type}): ${patchSmell.detail.slice(0, 60)} [ai-smell]`,
            }}
            canApply={!!patchSmell.aiPatchSpec}
            cwd={cwd}
            onApplied={handlePatchApplied}
            onRejected={() => setPatchSmell(null)}
            onConvertToMission={handleConvertToMission}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="smells-panel">
      <div className="smells-panel__header">
        <span className="smells-panel__title">Engineering Smells</span>
        {lastScan && (
          <span className="smells-panel__last-scan">
            Last scan {lastScan.toLocaleTimeString()}
          </span>
        )}
      </div>

      <SummaryBar summary={summary} loading={loading} onRefresh={scan} />

      {error && <div className="smells-error">{error}</div>}

      {!loading && !error && smells.length > 0 && (
        <FilterBar
          filter={filter} setFilter={setFilter}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          types={allTypes}
        />
      )}

      <div className="smells-list">
        {loading && smells.length === 0 && (
          <div className="smells-empty">
            <div className="smells-empty__icon">⟳</div>
            <div className="smells-empty__text">Scanning repository…</div>
          </div>
        )}

        {!loading && filtered.length === 0 && smells.length === 0 && !error && (
          <div className="smells-empty">
            <div className="smells-empty__icon">✓</div>
            <div className="smells-empty__text">No engineering smells detected</div>
            <div className="smells-empty__sub">Repository looks clean. Auto-scans every 5 minutes.</div>
          </div>
        )}

        {!loading && filtered.length === 0 && smells.length > 0 && (
          <div className="smells-empty">
            <div className="smells-empty__text">No smells match current filter</div>
          </div>
        )}

        {filtered.map(smell => (
          <SmellCard
            key={smell.id}
            smell={smell}
            cwd={cwd}
            onDismiss={dismiss}
            onPatch={openPatch}
            onConvertToMission={handleConvertToMission}
          />
        ))}
      </div>
    </div>
  );
}
