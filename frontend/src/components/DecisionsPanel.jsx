import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { _fetch } from '../_client';
import './DecisionsPanel.css';

const PatchPreviewPanel = lazy(() => import('./PatchPreviewPanel'));

async function api(method, path, body) {
  return _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
}

// ── Score ring ─────────────────────────────────────────────────────────
function ScoreRing({ value, label, color }) {
  const r   = 18;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - (value || 0) / 100);
  return (
    <div className="score-ring-wrap">
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#1f2937" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color || '#10b981'}
          strokeWidth="4" strokeDasharray={circ} strokeDashoffset={fill}
          strokeLinecap="round" transform="rotate(-90 22 22)" />
        <text x="22" y="26" textAnchor="middle" fontSize="10" fontWeight="700" fill={color || '#10b981'}>
          {value || 0}
        </text>
      </svg>
      <span className="score-ring-label">{label}</span>
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    open:      ['dec-badge--open',      'Open'],
    approved:  ['dec-badge--approved',  'Approved'],
    scheduled: ['dec-badge--scheduled', 'Scheduled'],
    ignored:   ['dec-badge--ignored',   'Ignored'],
    merged:    ['dec-badge--merged',    'Merged'],
  };
  const [cls, label] = map[status] || ['dec-badge--open', status];
  return <span className={`dec-badge ${cls}`}>{label}</span>;
}

// ── Risk badge ─────────────────────────────────────────────────────────
function RiskBadge({ risk }) {
  const cls = risk >= 60 ? 'risk--high' : risk >= 35 ? 'risk--medium' : 'risk--low';
  return <span className={`dec-risk ${cls}`}>Risk {risk}</span>;
}

// ── Single opportunity card ────────────────────────────────────────────
function OpportunityCard({ opp, onApprove, onSchedule, onIgnore, onConvert, onPatch, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(null);

  const act = useCallback(async (fn, label) => {
    setBusy(label);
    try { await fn(); } finally { setBusy(null); }
  }, []);

  const hasPatch = opp.smells?.some(s => s.aiPatchSpec);

  return (
    <div
      className={`dec-card dec-card--${opp.status} ${selected ? 'dec-card--selected' : ''}`}
      onClick={() => onSelect(opp.id)}
    >
      {/* Rank + type */}
      <div className="dec-card__head">
        <input
          type="checkbox"
          className="dec-card__check"
          checked={selected}
          onChange={() => onSelect(opp.id)}
          onClick={e => e.stopPropagation()}
        />
        <span className="dec-card__type">{opp.type?.replace(/_/g, ' ')}</span>
        <StatusBadge status={opp.status} />
        {opp.businessImpact === 'high' && <span className="dec-card__biz-tag">biz impact</span>}
        <button className="dec-card__expand" onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}>
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {/* Location */}
      {opp.file && (
        <div className="dec-card__file">
          {opp.file} · {opp.smellCount} smell{opp.smellCount > 1 ? 's' : ''}
        </div>
      )}

      {/* Score bar */}
      <div className="dec-card__scores">
        <ScoreRing value={opp.priority}    label="Priority" color="#f59e0b" />
        <ScoreRing value={opp.roiScore}    label="ROI"      color="#10b981" />
        <ScoreRing value={opp.debtScore}   label="Debt"     color="#ef4444" />
        <ScoreRing value={opp.userImpact}  label="Users"    color="#60a5fa" />
        <RiskBadge risk={opp.regressionRisk} />
        <div className="dec-card__meta-col">
          <span className="dec-card__hours">⏱ {opp.estimatedHours}h</span>
          <span className="dec-card__owner">{opp.suggestedOwner}</span>
          <span className="dec-card__conf">{opp.confidence}% conf</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="dec-card__body">
          {/* Smells list */}
          <div className="dec-card__smells-label">Smells ({opp.smells?.length})</div>
          {opp.smells?.slice(0, 6).map((s, i) => (
            <div key={i} className="dec-card__smell-item">
              <span className={`dec-card__smell-sev dec-card__smell-sev--${s.severity}`}>{s.severity}</span>
              <span className="dec-card__smell-detail">{s.detail?.slice(0, 90)}</span>
              {s.line && <span className="dec-card__smell-line">:{s.line}</span>}
            </div>
          ))}

          {/* Context */}
          <div className="dec-card__ctx-row">
            <span className="dec-card__ctx-label">Affected users</span>
            <span className="dec-card__ctx-val">{opp.affectedUsers}</span>
          </div>
          <div className="dec-card__ctx-row">
            <span className="dec-card__ctx-label">Business impact</span>
            <span className={`dec-card__ctx-val dec-biz--${opp.businessImpact}`}>{opp.businessImpact}</span>
          </div>
          {opp.rcaLinks?.length > 0 && (
            <div className="dec-card__ctx-row">
              <span className="dec-card__ctx-label">RCA links</span>
              <span className="dec-card__ctx-val">{opp.rcaLinks.map(r => r.title?.slice(0, 40)).join(', ')}</span>
            </div>
          )}
          {opp.missionLink && (
            <div className="dec-card__ctx-row">
              <span className="dec-card__ctx-label">Mission</span>
              <span className="dec-card__ctx-val dec-card__mission-link">{opp.missionLink.objective?.slice(0, 50)} ({opp.missionLink.status})</span>
            </div>
          )}
          {opp.dependencies?.length > 0 && (
            <div className="dec-card__ctx-row">
              <span className="dec-card__ctx-label">Dependencies</span>
              <span className="dec-card__ctx-val">{opp.dependencies.slice(0, 3).join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {opp.status === 'open' && (
        <div className="dec-card__actions" onClick={e => e.stopPropagation()}>
          <button className="dec-act dec-act--approve" disabled={!!busy}
            onClick={() => act(() => onApprove(opp.id), 'approve')}>
            {busy === 'approve' ? '…' : '✓ Approve'}
          </button>
          <button className="dec-act dec-act--schedule" disabled={!!busy}
            onClick={() => act(() => onSchedule(opp.id), 'schedule')}>
            {busy === 'schedule' ? '…' : '⏰ Later'}
          </button>
          {!opp.missionLink && (
            <button className="dec-act dec-act--mission" disabled={!!busy}
              onClick={() => act(() => onConvert(opp.id), 'convert')}>
              {busy === 'convert' ? '…' : '→ Mission'}
            </button>
          )}
          {hasPatch && (
            <button className="dec-act dec-act--patch" disabled={!!busy}
              onClick={() => onPatch(opp)}>
              ⚡ Patch
            </button>
          )}
          <button className="dec-act dec-act--ignore" disabled={!!busy}
            onClick={() => act(() => onIgnore(opp.id), 'ignore')}>
            {busy === 'ignore' ? '…' : 'Ignore'}
          </button>
        </div>
      )}
      {opp.status === 'approved' && (
        <div className="dec-card__actions" onClick={e => e.stopPropagation()}>
          {!opp.missionLink && (
            <button className="dec-act dec-act--mission"
              onClick={() => onConvert(opp.id)}>→ Mission</button>
          )}
          {hasPatch && (
            <button className="dec-act dec-act--patch" onClick={() => onPatch(opp)}>⚡ Patch</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Top-5 quick panel ──────────────────────────────────────────────────
function Top5Panel({ opps, onApproveAll, busy }) {
  const top5 = opps.filter(o => o.status === 'open').slice(0, 5);
  if (!top5.length) return null;
  return (
    <div className="dec-top5">
      <div className="dec-top5__header">
        <span className="dec-top5__title">Top 5 Engineering Opportunities</span>
        <button className="dec-top5__approve-all" disabled={busy} onClick={onApproveAll}>
          {busy ? 'Approving…' : '✓ Approve All Top 5'}
        </button>
      </div>
      <div className="dec-top5__list">
        {top5.map((o, i) => (
          <div key={o.id} className="dec-top5__item">
            <span className="dec-top5__rank">#{i + 1}</span>
            <span className="dec-top5__type">{o.type?.replace(/_/g, ' ')}</span>
            {o.file && <span className="dec-top5__file">{o.file}</span>}
            <span className="dec-top5__pri">P{o.priority}</span>
            <span className="dec-top5__roi">ROI {o.roiScore}</span>
            <span className="dec-top5__hours">{o.estimatedHours}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Summary bar ────────────────────────────────────────────────────────
function DecisionSummary({ dm, trend }) {
  if (!dm) return null;
  const trendIcon = trend === 'improving' ? '↓' : trend === 'worsening' ? '↑' : '→';
  const trendCls  = trend === 'improving' ? 'trend--good' : trend === 'worsening' ? 'trend--bad' : 'trend--stable';
  return (
    <div className="dec-summary">
      <div className="dec-summary__stat"><span className="dec-summary__n">{dm.totalOpportunities}</span><span className="dec-summary__l">total</span></div>
      <div className="dec-summary__stat"><span className="dec-summary__n dec-summary__n--crit">{dm.criticalCount}</span><span className="dec-summary__l">critical</span></div>
      <div className="dec-summary__stat"><span className="dec-summary__n dec-summary__n--hours">{dm.totalHours}h</span><span className="dec-summary__l">to green</span></div>
      <div className="dec-summary__stat"><span className="dec-summary__n">{dm.avgConfidence}%</span><span className="dec-summary__l">confidence</span></div>
      <div className="dec-summary__stat"><span className={`dec-summary__n ${trendCls}`}>{trendIcon} {trend}</span><span className="dec-summary__l">trend</span></div>
      <div className="dec-summary__stat">
        <span className={`dec-summary__n dec-risk-label--${dm.productionRisk}`}>{dm.productionRisk}</span>
        <span className="dec-summary__l">prod risk</span>
      </div>
    </div>
  );
}

// ── Main DecisionsPanel ────────────────────────────────────────────────
export default function DecisionsPanel({ cwd }) {
  const [opps,       setOpps]       = useState([]);
  const [dm,         setDm]         = useState(null);
  const [trend,      setTrend]      = useState('stable');
  const [loading,    setLoading]    = useState(false);
  const [computing,  setComputing]  = useState(false);
  const [error,      setError]      = useState(null);
  const [filter,     setFilter]     = useState('all');
  const [selected,   setSelected]   = useState(new Set());
  const [patchOpp,   setPatchOpp]   = useState(null);
  const [approveAllBusy, setApproveAllBusy] = useState(false);

  const loadCache = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('GET', '/coding/decisions');
      if (r?.ok) {
        setOpps(r.opportunities || []);
      }
      // Also load dashboard
      const d = await api('GET', '/coding/decisions/dashboard');
      if (d?.ok && d.metrics) {
        setDm(d.metrics.summary);
        setTrend(d.metrics.summary?.trend || 'stable');
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const compute = useCallback(async () => {
    setComputing(true);
    setError(null);
    try {
      const r = await api('POST', '/coding/decisions/compute', { cwd });
      if (r?.ok) {
        setOpps(r.opportunities || []);
        setDm(r.debtMetrics);
      } else { setError(r?.error || 'Compute failed'); }
    } catch (e) { setError(e.message); }
    finally { setComputing(false); }
  }, [cwd]);

  useEffect(() => { loadCache(); }, [loadCache]);

  const mutateOpp = (id, patch) =>
    setOpps(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));

  const onApprove = useCallback(async (id) => {
    const r = await api('POST', '/coding/decisions/approve', { id });
    if (r?.ok) mutateOpp(id, { status: 'approved' });
  }, []);

  const onSchedule = useCallback(async (id) => {
    const r = await api('POST', '/coding/decisions/schedule', { id });
    if (r?.ok) mutateOpp(id, { status: 'scheduled' });
  }, []);

  const onIgnore = useCallback(async (id) => {
    const r = await api('POST', '/coding/decisions/ignore', { id });
    if (r?.ok) mutateOpp(id, { status: 'ignored' });
  }, []);

  const onConvert = useCallback(async (id) => {
    const r = await api('POST', '/coding/decisions/convert', { id });
    if (r?.ok) mutateOpp(id, { missionLink: r.mission });
  }, []);

  const onApproveAll = useCallback(async () => {
    setApproveAllBusy(true);
    try {
      const r = await api('POST', '/coding/decisions/approve-top', { n: 5 });
      if (r?.ok) {
        const ids = new Set((r.approved || []).map(a => a.id));
        setOpps(prev => prev.map(o => ids.has(o.id) ? { ...o, status: 'approved' } : o));
      }
    } finally { setApproveAllBusy(false); }
  }, []);

  const onMerge = useCallback(async () => {
    if (selected.size < 2) return;
    const ids = [...selected];
    const r   = await api('POST', '/coding/decisions/merge', { ids });
    if (r?.ok) {
      await loadCache();
      setSelected(new Set());
    }
  }, [selected, loadCache]);

  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Filter
  const STATUS_TABS = ['all', 'open', 'approved', 'scheduled', 'ignored'];
  const filtered = opps.filter(o => filter === 'all' || o.status === filter);

  if (patchOpp) {
    const bestSmell = patchOpp.smells?.find(s => s.aiPatchSpec);
    return (
      <div className="dec-patch-view">
        <div className="dec-patch-view__back">
          <button className="dec-back-btn" onClick={() => setPatchOpp(null)}>← Back</button>
          <span className="dec-patch-view__title">{patchOpp.type?.replace(/_/g, ' ')} — {patchOpp.file}</span>
        </div>
        <Suspense fallback={<div style={{ padding: 16, color: '#4b5563' }}>Loading…</div>}>
          <PatchPreviewPanel
            goal={`Fix ${patchOpp.type?.replace(/_/g, ' ')} in ${patchOpp.file || 'runtime'}`}
            proposal={{
              explanation:  `ACP-4 Decision: ${patchOpp.smellCount} smell(s), ROI ${patchOpp.roiScore}, debt ${patchOpp.debtScore}`,
              reasoning:    bestSmell?.patchHint || '',
              affectedFiles: patchOpp.file ? [patchOpp.file] : [],
              confidence:   patchOpp.confidence / 100,
              riskLevel:    patchOpp.regressionRisk >= 60 ? 'high' : patchOpp.regressionRisk >= 35 ? 'medium' : 'low',
              riskReason:   `Regression risk score: ${patchOpp.regressionRisk}`,
              patchSpecs:   (patchOpp.smells || [])
                              .filter(s => s.aiPatchSpec)
                              .map(s => ({ ...s.aiPatchSpec, valid: true }))
                              .slice(0, 1),
              unifiedDiff:  '',
              commitMsg:    `fix(${patchOpp.type}): [acp4] ${patchOpp.smellCount} smell(s) in ${patchOpp.file || 'runtime'}`,
            }}
            canApply={!!bestSmell}
            cwd={cwd}
            onApplied={() => { setPatchOpp(null); loadCache(); }}
            onRejected={() => setPatchOpp(null)}
            onConvertToMission={() => { onConvert(patchOpp.id); setPatchOpp(null); }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="dec-panel">
      <div className="dec-panel__header">
        <span className="dec-panel__title">Engineering Decisions</span>
        <div className="dec-panel__actions">
          {selected.size >= 2 && (
            <button className="dec-hdr-btn dec-hdr-btn--merge" onClick={onMerge}>
              Merge {selected.size}
            </button>
          )}
          <button className="dec-hdr-btn dec-hdr-btn--scan" disabled={computing} onClick={compute}>
            {computing ? 'Scanning…' : '⟳ Rescan & Rank'}
          </button>
        </div>
      </div>

      <DecisionSummary dm={dm} trend={trend} />

      {!loading && !computing && opps.length > 0 && (
        <Top5Panel opps={opps} onApproveAll={onApproveAll} busy={approveAllBusy} />
      )}

      {error && <div className="dec-error">{error}</div>}

      <div className="dec-tabs">
        {STATUS_TABS.map(t => (
          <button key={t}
            className={`dec-tab ${filter === t ? 'dec-tab--active' : ''}`}
            onClick={() => setFilter(t)}>
            {t} {t !== 'all' && <span className="dec-tab__n">{opps.filter(o => o.status === t).length}</span>}
          </button>
        ))}
      </div>

      <div className="dec-list">
        {(loading || computing) && opps.length === 0 && (
          <div className="dec-empty">
            <div className="dec-empty__icon">⟳</div>
            <div className="dec-empty__text">{computing ? 'Ranking engineering opportunities…' : 'Loading…'}</div>
          </div>
        )}
        {!loading && !computing && filtered.length === 0 && opps.length === 0 && (
          <div className="dec-empty">
            <div className="dec-empty__icon">◎</div>
            <div className="dec-empty__text">No decisions yet — click Rescan &amp; Rank</div>
          </div>
        )}
        {!loading && !computing && filtered.length === 0 && opps.length > 0 && (
          <div className="dec-empty">
            <div className="dec-empty__text">No {filter} opportunities</div>
          </div>
        )}
        {filtered.map(opp => (
          <OpportunityCard
            key={opp.id}
            opp={opp}
            onApprove={onApprove}
            onSchedule={onSchedule}
            onIgnore={onIgnore}
            onConvert={onConvert}
            onPatch={setPatchOpp}
            selected={selected.has(opp.id)}
            onSelect={toggleSelect}
          />
        ))}
      </div>
    </div>
  );
}
