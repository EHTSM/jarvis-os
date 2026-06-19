import React, { useState, useEffect, useCallback } from 'react';
import { _fetch } from '../_client';
import './TechDebtDashboard.css';

async function api(method, path, body) {
  return _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
}

// ── Mini sparkline (SVG) ───────────────────────────────────────────────
function Sparkline({ data, color, height = 36 }) {
  if (!data || data.length < 2) return <div style={{ height, color: '#374151', fontSize: 11 }}>no data</div>;
  const w    = 120;
  const min  = Math.min(...data);
  const max  = Math.max(...data);
  const range = max - min || 1;
  const pts  = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const last = pts[pts.length - 1];
  const [lx, ly] = last.split(',');
  return (
    <svg width={w} height={height} style={{ overflow: 'visible' }}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color || '#10b981'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r="3" fill={color || '#10b981'} />
    </svg>
  );
}

// ── Debt gauge ─────────────────────────────────────────────────────────
function DebtGauge({ value, max = 100, label, color }) {
  const pct = Math.min(100, (value / (max || 1)) * 100);
  return (
    <div className="tdd-gauge">
      <div className="tdd-gauge__label">{label}</div>
      <div className="tdd-gauge__bar-wrap">
        <div className="tdd-gauge__bar" style={{ width: `${pct}%`, background: color || '#10b981' }} />
      </div>
      <div className="tdd-gauge__val" style={{ color: color || '#10b981' }}>{value}</div>
    </div>
  );
}

// ── Metric tile ────────────────────────────────────────────────────────
function MetricTile({ label, value, sub, color, icon }) {
  return (
    <div className="tdd-tile">
      {icon && <div className="tdd-tile__icon" style={{ color: color || '#10b981' }}>{icon}</div>}
      <div className="tdd-tile__value" style={{ color: color || '#d1d5db' }}>{value ?? '—'}</div>
      <div className="tdd-tile__label">{label}</div>
      {sub && <div className="tdd-tile__sub">{sub}</div>}
    </div>
  );
}

// ── By-type breakdown ──────────────────────────────────────────────────
function ByTypeBar({ byType }) {
  if (!byType || !Object.keys(byType).length) return null;
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const total   = entries.reduce((s, [, n]) => s + n, 0);
  const TYPE_COLOR = {
    blocking_crypto:   '#ef4444',
    build_failure:     '#f87171',
    long_function:     '#f59e0b',
    empty_catch:       '#fbbf24',
    sync_fs:           '#fb923c',
    benchmark_decline: '#a78bfa',
    stale_mission:     '#60a5fa',
    console_log_prod:  '#6b7280',
    todo_fixme:        '#4b5563',
    duplicate_literal: '#374151',
    stale_feature_flag:'#374151',
  };
  return (
    <div className="tdd-bytype">
      <div className="tdd-section-title">By Type</div>
      <div className="tdd-bytype__stacked">
        {entries.map(([type, count]) => (
          <div
            key={type}
            className="tdd-bytype__seg"
            style={{ width: `${(count / total) * 100}%`, background: TYPE_COLOR[type] || '#374151' }}
            title={`${type}: ${count}`}
          />
        ))}
      </div>
      <div className="tdd-bytype__legend">
        {entries.slice(0, 8).map(([type, count]) => (
          <div key={type} className="tdd-bytype__leg-item">
            <span className="tdd-bytype__dot" style={{ background: TYPE_COLOR[type] || '#374151' }} />
            <span className="tdd-bytype__leg-label">{type.replace(/_/g, ' ')}</span>
            <span className="tdd-bytype__leg-n">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Burn-down chart (SVG) ──────────────────────────────────────────────
function BurndownChart({ snapshots }) {
  if (!snapshots || snapshots.length < 2) {
    return (
      <div className="tdd-burndown-empty">
        Run at least 2 scans to see the burn-down trend.
      </div>
    );
  }

  const W   = 280;
  const H   = 80;
  const pad = { t: 8, r: 8, b: 20, l: 28 };
  const iW  = W - pad.l - pad.r;
  const iH  = H - pad.t - pad.b;

  const smellVals = snapshots.map(s => s.smellCount || 0);
  const hourVals  = snapshots.map(s => s.totalHours || 0);

  const smellMax  = Math.max(...smellVals, 1);
  const hourMax   = Math.max(...hourVals, 1);

  const smellPts  = smellVals.map((v, i) => {
    const x = pad.l + (i / (snapshots.length - 1)) * iW;
    const y = pad.t + iH - (v / smellMax) * iH;
    return `${x},${y}`;
  });
  const hourPts   = hourVals.map((v, i) => {
    const x = pad.l + (i / (snapshots.length - 1)) * iW;
    const y = pad.t + iH - (v / hourMax) * iH;
    return `${x},${y}`;
  });

  // X-axis labels: first and last date
  const first = snapshots[0]?.ts ? new Date(snapshots[0].ts).toLocaleDateString() : '';
  const last  = snapshots[snapshots.length - 1]?.ts ? new Date(snapshots[snapshots.length - 1].ts).toLocaleDateString() : '';

  return (
    <svg width={W} height={H} style={{ overflow: 'visible' }}>
      {/* Grid line at 50% */}
      <line x1={pad.l} y1={pad.t + iH / 2} x2={pad.l + iW} y2={pad.t + iH / 2}
        stroke="#1f2937" strokeWidth="1" strokeDasharray="3,3" />
      {/* Baseline */}
      <line x1={pad.l} y1={pad.t + iH} x2={pad.l + iW} y2={pad.t + iH}
        stroke="#1f2937" strokeWidth="1" />
      {/* Left axis */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + iH}
        stroke="#1f2937" strokeWidth="1" />

      <polyline points={smellPts.join(' ')} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round" />
      <polyline points={hourPts.join(' ')} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Last point dots */}
      {smellPts.length > 0 && (() => { const [x,y] = smellPts[smellPts.length-1].split(','); return <circle cx={x} cy={y} r="3" fill="#ef4444" />; })()}
      {hourPts.length > 0 && (() => { const [x,y] = hourPts[hourPts.length-1].split(','); return <circle cx={x} cy={y} r="3" fill="#f59e0b" />; })()}

      {/* X labels */}
      <text x={pad.l} y={H - 4} fontSize="8" fill="#4b5563" textAnchor="start">{first}</text>
      <text x={pad.l + iW} y={H - 4} fontSize="8" fill="#4b5563" textAnchor="end">{last}</text>
    </svg>
  );
}

// ── Deliverables scorecard ─────────────────────────────────────────────
function Scorecard({ dm, opps }) {
  if (!dm) return null;

  const approved   = (opps || []).filter(o => o.status === 'approved');
  const hoursSaved = Math.round(approved.reduce((s, o) => s + (o.estimatedHours || 0), 0) * 10) / 10;
  const debtReduced = approved.length ? Math.round(approved.reduce((s, o) => s + o.debtScore, 0) / approved.length) : 0;

  // Heuristic scoring
  const totalOpp   = opps?.length || 0;
  const openCrit   = (opps || []).filter(o => o.status === 'open' && o.debtScore >= 60).length;
  const cursorScore = Math.max(0, Math.min(100, 100 - openCrit * 8 - dm.totalHours * 0.3));
  const ooplixScore = Math.max(0, Math.min(100, (dm.avgConfidence || 0) * 0.6 + (approved.length / (totalOpp || 1)) * 40));

  return (
    <div className="tdd-scorecard">
      <div className="tdd-section-title">ACP-4 Deliverables</div>
      <div className="tdd-scorecard__grid">
        <div className="tdd-sc-row">
          <span className="tdd-sc-label">Hours saved (approved)</span>
          <span className="tdd-sc-val tdd-sc-val--good">{hoursSaved}h</span>
        </div>
        <div className="tdd-sc-row">
          <span className="tdd-sc-label">Avg debt reduced</span>
          <span className="tdd-sc-val tdd-sc-val--good">{debtReduced} pts</span>
        </div>
        <div className="tdd-sc-row">
          <span className="tdd-sc-label">Top 10 opportunities</span>
          <span className="tdd-sc-val">{Math.min(totalOpp, 10)}</span>
        </div>
        <div className="tdd-sc-row">
          <span className="tdd-sc-label">Critical open smells</span>
          <span className={`tdd-sc-val ${openCrit > 0 ? 'tdd-sc-val--bad' : 'tdd-sc-val--good'}`}>{openCrit}</span>
        </div>
        <div className="tdd-sc-row">
          <span className="tdd-sc-label">Replace Cursor score</span>
          <span className="tdd-sc-val tdd-sc-val--score">{Math.round(cursorScore)}/100</span>
        </div>
        <div className="tdd-sc-row">
          <span className="tdd-sc-label">Build Ooplix in Ooplix</span>
          <span className="tdd-sc-val tdd-sc-val--score">{Math.round(ooplixScore)}/100</span>
        </div>
      </div>
    </div>
  );
}

// ── Main TechDebtDashboard ─────────────────────────────────────────────
export default function TechDebtDashboard() {
  const [metrics,   setMetrics]   = useState(null);
  const [history,   setHistory]   = useState([]);
  const [opps,      setOpps]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, hist, oppData] = await Promise.all([
        api('GET', '/coding/decisions/dashboard'),
        api('GET', '/coding/decisions/history?limit=30'),
        api('GET', '/coding/decisions'),
      ]);
      if (dash?.ok && dash.metrics) setMetrics(dash.metrics);
      if (hist?.ok) setHistory(hist.snapshots || []);
      if (oppData?.ok) setOpps(oppData.opportunities || []);
      setLastFetch(new Date());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = metrics?.summary || {};
  const byType   = metrics?.byType || {};
  const top10    = (opps).slice(0, 10);

  const smellTrend = history.map(h => h.smellCount || 0);
  const hoursTrend = history.map(h => h.totalHours || 0);
  const critTrend  = history.map(h => h.criticalCount || 0);

  const trendColor = s.trend === 'improving' ? '#10b981' : s.trend === 'worsening' ? '#ef4444' : '#6b7280';

  return (
    <div className="tdd-root">
      <div className="tdd-header">
        <span className="tdd-header__title">Technical Debt Dashboard</span>
        <div className="tdd-header__right">
          {lastFetch && <span className="tdd-header__ts">{lastFetch.toLocaleTimeString()}</span>}
          <button className="tdd-refresh" onClick={load} disabled={loading}>{loading ? '⟳' : '↻'}</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="tdd-tiles">
        <MetricTile label="Hours to Green"    value={`${s.totalHours || 0}h`}     color="#f59e0b" icon="⏱" />
        <MetricTile label="Critical Smells"   value={s.criticalCount || 0}        color="#ef4444" icon="🔴" />
        <MetricTile label="Avg Confidence"    value={`${s.avgConfidence || 0}%`}  color="#10b981" icon="◎" />
        <MetricTile label="Prod Risk"         value={s.productionRisk || '—'}     color={s.productionRisk === 'high' ? '#ef4444' : s.productionRisk === 'medium' ? '#f59e0b' : '#10b981'} icon="⚠" />
        <MetricTile label="Open Decisions"    value={s.open || 0}                 icon="◐" />
        <MetricTile label="Approved"          value={s.approved || 0}             color="#10b981" icon="✓" />
      </div>

      {/* Trend + burn-down */}
      <div className="tdd-charts">
        <div className="tdd-chart-card">
          <div className="tdd-section-title">Debt Trend <span className={`tdd-trend-arrow ${s.trend === 'improving' ? 'tdd-trend-arrow--good' : s.trend === 'worsening' ? 'tdd-trend-arrow--bad' : ''}`}>{s.trend === 'improving' ? '↓' : s.trend === 'worsening' ? '↑' : '→'}</span></div>
          <div className="tdd-chart-row">
            <div>
              <div className="tdd-chart-sublabel" style={{ color: '#ef4444' }}>Smells</div>
              <Sparkline data={smellTrend} color="#ef4444" />
            </div>
            <div>
              <div className="tdd-chart-sublabel" style={{ color: '#f59e0b' }}>Hours</div>
              <Sparkline data={hoursTrend} color="#f59e0b" />
            </div>
            <div>
              <div className="tdd-chart-sublabel" style={{ color: '#a78bfa' }}>Critical</div>
              <Sparkline data={critTrend} color="#a78bfa" />
            </div>
          </div>
        </div>

        <div className="tdd-chart-card">
          <div className="tdd-section-title">Burn-down</div>
          <BurndownChart snapshots={history} />
          <div className="tdd-burndown-legend">
            <span className="tdd-bd-dot" style={{ background: '#ef4444' }} /> Smells
            <span className="tdd-bd-dot" style={{ background: '#f59e0b', marginLeft: 12 }} /> Hours
          </div>
        </div>
      </div>

      {/* Gauges */}
      <div className="tdd-gauges">
        <DebtGauge label="Avg Debt Score"       value={s.avgDebt || 0}        color="#ef4444" />
        <DebtGauge label="High ROI Count"        value={s.highROICount || 0}   max={s.totalOpportunities || 1} color="#10b981" />
        <DebtGauge label="Total Opportunities"   value={s.totalOpportunities || 0} max={200} color="#6b7280" />
      </div>

      {/* Type breakdown */}
      <ByTypeBar byType={byType} />

      {/* Top 10 table */}
      <div className="tdd-top10">
        <div className="tdd-section-title">Top 10 Engineering Opportunities</div>
        {top10.length === 0 && <div className="tdd-top10-empty">No opportunities yet — run a scan from the Decisions tab.</div>}
        <div className="tdd-top10__table">
          {top10.map((o, i) => (
            <div key={o.id} className={`tdd-top10__row tdd-top10__row--${o.status}`}>
              <span className="tdd-top10__rank">#{i + 1}</span>
              <span className="tdd-top10__type">{o.type?.replace(/_/g, ' ')}</span>
              {o.file && <span className="tdd-top10__file">{o.file?.split('/').slice(-2).join('/')}</span>}
              <span className="tdd-top10__pri" title="Priority">P{o.priority}</span>
              <span className="tdd-top10__roi" title="ROI">ROI {o.roiScore}</span>
              <span className="tdd-top10__debt" title="Debt score">D{o.debtScore}</span>
              <span className="tdd-top10__hours">{o.estimatedHours}h</span>
              <span className={`tdd-top10__status tdd-top10__status--${o.status}`}>{o.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Scorecard */}
      <Scorecard dm={s} opps={opps} />
    </div>
  );
}
