import React, { useState, useEffect, useCallback } from 'react';
import { getMissions, getMissionStats, getPlanningRecommend } from '../phase27Api';
import { getObserverRecs, getObserverStatus, getMemoryDecisions } from '../phase26Api';
import './ContextSidebar.css';

// ── Section component ────────────────────────────────────────────────
function Section({ title, icon, children, empty, loading, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ctx-section">
      <button className="ctx-section__header" onClick={() => setOpen(o => !o)}>
        <span className="ctx-section__icon">{icon}</span>
        <span className="ctx-section__title">{title}</span>
        <span className="ctx-section__arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="ctx-section__body">
          {loading ? <div className="ctx-loading">Loading…</div>
          : empty   ? <div className="ctx-empty">{empty}</div>
          : children}
        </div>
      )}
    </div>
  );
}

// ── Metric pill ───────────────────────────────────────────────────────
function Metric({ label, value, color }) {
  return (
    <div className="ctx-metric">
      <span className="ctx-metric__val" style={{ color: color || 'var(--accent)' }}>{value}</span>
      <span className="ctx-metric__lbl">{label}</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────
export default function ContextSidebar({ context = 'default', onNavigate }) {
  const [missions,    setMissions]    = useState([]);
  const [mStats,      setMStats]      = useState(null);
  const [recs,        setRecs]        = useState([]);
  const [obsStatus,   setObsStatus]   = useState(null);
  const [decisions,   setDecisions]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      getMissions(),
      getMissionStats(),
      getObserverRecs(),
      getObserverStatus(),
      getMemoryDecisions(),
    ]).then(([mR, msR, recR, obsR, decR]) => {
      if (mR.status === 'fulfilled') {
        const raw = mR.value;
        setMissions(Array.isArray(raw) ? raw : (raw?.missions ?? []));
      }
      if (msR.status === 'fulfilled') setMStats(msR.value);
      if (recR.status === 'fulfilled') {
        const raw = recR.value;
        setRecs(Array.isArray(raw) ? raw : (raw?.recommendations ?? []));
      }
      if (obsR.status === 'fulfilled') setObsStatus(obsR.value);
      if (decR.status === 'fulfilled') {
        const raw = decR.value;
        setDecisions(Array.isArray(raw) ? raw : (raw?.decisions ?? []));
      }
      setLoading(false);
      setLastRefresh(new Date());
    });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const active   = missions.filter(m => m.status === 'active' || m.status === 'running');
  const topRecs  = recs.slice(0, 4);
  const topDecs  = decisions.slice(0, 3);

  const obsOk    = obsStatus?.status === 'running' || obsStatus?.active;
  const riskLevel = recs.find(r => r.priority === 'critical') ? 'high'
                  : recs.find(r => r.priority === 'high')     ? 'medium'
                  : 'low';
  const riskColor = riskLevel === 'high' ? '#ef4444' : riskLevel === 'medium' ? '#eab308' : '#22c55e';

  return (
    <aside className="ctx-sidebar">
      {/* Header */}
      <div className="ctx-sidebar__header">
        <span className="ctx-sidebar__title">Context</span>
        <button className="ctx-refresh-btn" onClick={refresh} title="Refresh">↺</button>
      </div>

      {/* System pulse */}
      <div className="ctx-pulse">
        <div className="ctx-pulse__row">
          <Metric label="Active" value={active.length} color="#22c55e" />
          <Metric label="Total"  value={mStats?.total ?? missions.length} />
          <Metric label="Risk"   value={riskLevel.toUpperCase()} color={riskColor} />
        </div>
        <div className="ctx-pulse__observer">
          <span className={`ctx-dot ${obsOk ? 'ctx-dot--green' : 'ctx-dot--red'}`} />
          <span className="ctx-pulse__label">Observer {obsOk ? 'running' : 'offline'}</span>
        </div>
      </div>

      {/* Active missions */}
      <Section icon="🎯" title="Active Missions" loading={loading && !missions.length}
        empty={missions.length === 0 ? 'No active missions' : null}>
        {active.length === 0 && missions.length > 0 && (
          <div className="ctx-empty">No running missions right now</div>
        )}
        {active.slice(0, 5).map((m, i) => {
          const pct = m.progress ?? 0;
          return (
            <div key={m.id ?? i} className="ctx-mission-row"
              onClick={() => onNavigate?.('jarvisbrain')} title="Open Brain Center">
              <div className="ctx-mission-name">
                {m.title ?? m.name ?? m.goal ?? `Mission ${i + 1}`}
              </div>
              <div className="ctx-mission-bar-wrap">
                <div className="ctx-mission-bar">
                  <div className="ctx-mission-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="ctx-mission-pct">{pct}%</span>
              </div>
            </div>
          );
        })}
        {active.length > 5 && (
          <div className="ctx-more" onClick={() => onNavigate?.('jarvisbrain')}>
            +{active.length - 5} more →
          </div>
        )}
      </Section>

      {/* Recommendations */}
      <Section icon="✦" title="Recommendations" loading={loading && !recs.length}
        empty={recs.length === 0 ? 'No recommendations' : null} defaultOpen>
        {topRecs.map((r, i) => {
          const pri = r.priority ?? 'normal';
          const priColor = pri === 'critical' ? '#ef4444' : pri === 'high' ? '#eab308' : 'var(--accent)';
          return (
            <div key={r.id ?? i} className="ctx-rec-row"
              onClick={() => onNavigate?.('recommend')} title="Open Recommendations">
              <span className="ctx-rec-badge" style={{ background: priColor + '22', color: priColor, borderColor: priColor + '44' }}>
                {pri}
              </span>
              <span className="ctx-rec-text">{r.title ?? r.action ?? r.text ?? 'Recommendation'}</span>
            </div>
          );
        })}
      </Section>

      {/* Recent decisions from memory */}
      <Section icon="🧠" title="Memory Decisions" loading={loading && !decisions.length}
        empty={decisions.length === 0 ? 'No recent decisions' : null} defaultOpen={false}>
        {topDecs.map((d, i) => (
          <div key={d.id ?? i} className="ctx-dec-row"
            onClick={() => onNavigate?.('memory')}>
            <div className="ctx-dec-text">{d.content ?? d.text ?? d.decision ?? 'Decision record'}</div>
            {d.confidence != null && (
              <div className="ctx-dec-conf">{Math.round(d.confidence * 100)}% confidence</div>
            )}
          </div>
        ))}
      </Section>

      {/* Quick nav */}
      <Section icon="⚡" title="Quick Navigate" defaultOpen={false}>
        <div className="ctx-quicknav">
          {[
            { tab: 'jarvisbrain',   icon: '🎯', label: 'Missions'    },
            { tab: 'execution',     icon: '⚡', label: 'Execution'   },
            { tab: 'reliability',   icon: '◈',  label: 'Reliability' },
            { tab: 'predict',       icon: '◇',  label: 'Prediction'  },
            { tab: 'recommend',     icon: '✦',  label: 'Recs'        },
            { tab: 'memory',        icon: '🧠', label: 'Memory'      },
            { tab: 'guardrails',    icon: '◻',  label: 'Guardrails'  },
            { tab: 'executivedash', icon: '◉',  label: 'Executive'   },
          ].map(n => (
            <button key={n.tab} className="ctx-qnav-btn" onClick={() => onNavigate?.(n.tab)}>
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {lastRefresh && (
        <div className="ctx-footer">Updated {lastRefresh.toLocaleTimeString()}</div>
      )}
    </aside>
  );
}
