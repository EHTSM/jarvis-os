import React, { useState, useEffect, useCallback } from 'react';
import { getMissions, getMissionStats, getPlanningHorizons } from '../phase27Api';
import { getObserverRecs, getObserverStatus } from '../phase26Api';
import { cycleStats } from '../phase18Api';
import { listPatches, getDLQ } from '../runtimeApi';
import { getHealStatus, getHealHistory, getLessons, getRecommendations } from '../phase19Api';
import { listDeployments, listAlerts } from '../phase25Api';
import './WorkflowStagePanel.css';

// ── Engineering pipeline definition ──────────────────────────────────────────
const PIPELINE = [
  {
    id: 'mission',
    label: 'Mission',
    icon: '🎯',
    tab: 'jarvisbrain',
    desc: 'Define objective and goal',
    fetch: async () => {
      const r = await getMissions();
      const list = Array.isArray(r) ? r : (r?.missions ?? []);
      const active = list.filter(m => m.status === 'active' || m.status === 'running');
      return {
        status: active.length > 0 ? 'active' : list.length > 0 ? 'idle' : 'empty',
        summary: active.length > 0
          ? `${active.length} active mission${active.length > 1 ? 's' : ''}`
          : list.length > 0 ? `${list.length} total, none running` : 'No missions yet',
        items: list.slice(0, 3).map(m => ({
          label: m.title ?? m.name ?? m.goal ?? 'Mission',
          meta: m.status ?? 'unknown',
          statusOk: m.status === 'active' || m.status === 'complete',
        })),
        actions: [{ label: 'View Missions', tab: 'jarvisbrain' }],
        rollback: null,
      };
    },
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: '🗺️',
    tab: 'jarvisbrain',
    desc: 'Horizons and sub-task graph',
    fetch: async () => {
      const r = await getPlanningHorizons();
      const list = Array.isArray(r) ? r : (r?.horizons ?? []);
      const total = list.reduce((s, h) => s + (h.objectives?.length ?? 0), 0);
      const done  = list.reduce((s, h) => s + (h.objectives ?? []).filter(o => o.completed || o.status === 'complete').length, 0);
      const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
      return {
        status: list.length > 0 ? (pct === 100 ? 'complete' : 'active') : 'empty',
        summary: list.length > 0 ? `${list.length} horizons · ${done}/${total} objectives (${pct}%)` : 'No planning horizons',
        items: list.slice(0, 3).map(h => ({
          label: h.label ?? h.name ?? h.horizon ?? 'Horizon',
          meta: `${(h.objectives ?? []).length} objectives`,
          statusOk: (h.objectives ?? []).every(o => o.completed),
        })),
        actions: [{ label: 'Open Planning', tab: 'jarvisbrain' }],
        rollback: null,
      };
    },
  },
  {
    id: 'engineering',
    label: 'Engineering',
    icon: '⬡',
    tab: 'engineering',
    desc: 'Code, patch, refactor',
    fetch: async () => {
      const [patchRes, dlqRes] = await Promise.allSettled([
        listPatches(), getDLQ(),
      ]);
      const patches = patchRes.status === 'fulfilled'
        ? (Array.isArray(patchRes.value) ? patchRes.value : (patchRes.value?.patches ?? []))
        : [];
      const dlq = dlqRes.status === 'fulfilled'
        ? (Array.isArray(dlqRes.value) ? dlqRes.value : (dlqRes.value?.items ?? []))
        : [];
      const pending = patches.filter(p => p.status === 'pending' || p.status === 'draft');
      const failed  = patches.filter(p => p.status === 'failed');
      return {
        status: failed.length > 0 ? 'warning' : pending.length > 0 ? 'active' : 'idle',
        summary: `${pending.length} pending patch${pending.length !== 1 ? 'es' : ''} · ${failed.length} failed · ${dlq.length} in DLQ`,
        items: patches.slice(0, 3).map(p => ({
          label: p.description ?? p.file ?? p.id ?? 'Patch',
          meta: p.status ?? 'unknown',
          statusOk: p.status === 'applied' || p.status === 'success',
        })),
        actions: [
          { label: 'Engineering Center', tab: 'engineering' },
          { label: 'DevOps', tab: 'devops' },
        ],
        rollback: dlq.length > 0 ? `${dlq.length} items in dead letter queue` : null,
      };
    },
  },
  {
    id: 'execution',
    label: 'Execution',
    icon: '⚡',
    tab: 'execution',
    desc: 'Queue and run tasks',
    fetch: async () => {
      const r = await cycleStats();
      const active = r?.activeCycles ?? r?.running ?? 0;
      const total  = r?.totalCycles ?? r?.total ?? 0;
      const failed = r?.failedCycles ?? r?.failed ?? 0;
      return {
        status: active > 0 ? 'active' : failed > 0 ? 'warning' : 'idle',
        summary: `${active} running · ${total} total · ${failed} failed`,
        items: [],
        actions: [{ label: 'Execution Center', tab: 'execution' }],
        rollback: failed > 0 ? `${failed} failed cycles — review in Execution Center` : null,
      };
    },
  },
  {
    id: 'deploy',
    label: 'Deploy',
    icon: '◈',
    tab: 'devops',
    desc: 'Deploy and validate',
    fetch: async () => {
      const [depRes, alertRes] = await Promise.allSettled([
        listDeployments(), listAlerts(),
      ]);
      const deploys = depRes.status === 'fulfilled'
        ? (Array.isArray(depRes.value) ? depRes.value : (depRes.value?.deployments ?? []))
        : [];
      const alerts  = alertRes.status === 'fulfilled'
        ? (Array.isArray(alertRes.value) ? alertRes.value : (alertRes.value?.alerts ?? []))
        : [];
      const active  = deploys.filter(d => d.status === 'running' || d.status === 'deploying');
      const failed  = deploys.filter(d => d.status === 'failed');
      return {
        status: failed.length > 0 ? 'warning' : active.length > 0 ? 'active' : 'idle',
        summary: `${active.length} deploying · ${deploys.length} total · ${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`,
        items: deploys.slice(0, 3).map(d => ({
          label: d.name ?? d.service ?? d.id ?? 'Deployment',
          meta: d.status ?? 'unknown',
          statusOk: d.status === 'success' || d.status === 'healthy',
        })),
        actions: [
          { label: 'DevOps Center', tab: 'devops' },
          { label: 'Reliability', tab: 'reliability' },
        ],
        rollback: failed.length > 0 ? `${failed.length} failed — rollback available in DevOps` : null,
      };
    },
  },
  {
    id: 'reliability',
    label: 'Reliability',
    icon: '◈',
    tab: 'reliability',
    desc: 'Success metrics and trust',
    fetch: async () => {
      const r = await getObserverStatus();
      const ok  = r?.status === 'running' || r?.active;
      const rec = r?.totalRecommendations ?? 0;
      return {
        status: ok ? 'active' : 'warning',
        summary: ok
          ? `Observer running · ${rec} active recommendation${rec !== 1 ? 's' : ''}`
          : 'Observer offline — no live monitoring',
        items: [],
        actions: [
          { label: 'Reliability Center', tab: 'reliability' },
          { label: 'Prediction', tab: 'predict' },
        ],
        rollback: !ok ? 'Observer is offline — check backend connectivity' : null,
      };
    },
  },
  {
    id: 'heal',
    label: 'Heal',
    icon: '✦',
    tab: 'selfhealing',
    desc: 'Auto-remediation and probes',
    fetch: async () => {
      const [statusRes, histRes] = await Promise.allSettled([
        getHealStatus(), getHealHistory({ limit: 5 }),
      ]);
      const st   = statusRes.status === 'fulfilled' ? statusRes.value : {};
      const hist = histRes.status === 'fulfilled'
        ? (Array.isArray(histRes.value) ? histRes.value : (histRes.value?.events ?? histRes.value?.history ?? []))
        : [];
      const active  = st?.activeHeals ?? st?.running ?? 0;
      const success = hist.filter(h => h.status === 'success' || h.resolved).length;
      return {
        status: active > 0 ? 'active' : 'idle',
        summary: `${active} active heal${active !== 1 ? 's' : ''} · ${success}/${hist.length} recent resolved`,
        items: hist.slice(0, 3).map(h => ({
          label: h.task ?? h.target ?? h.id ?? 'Heal event',
          meta: h.status ?? 'unknown',
          statusOk: h.status === 'success' || h.resolved,
        })),
        actions: [{ label: 'Self-Healing', tab: 'selfhealing' }],
        rollback: null,
      };
    },
  },
  {
    id: 'learn',
    label: 'Learn',
    icon: '🧠',
    tab: 'memory',
    desc: 'Memory, lessons, patterns',
    fetch: async () => {
      const [lesRes, recRes] = await Promise.allSettled([
        getLessons({ limit: 5 }), getRecommendations({ limit: 5 }),
      ]);
      const lessons = lesRes.status === 'fulfilled'
        ? (Array.isArray(lesRes.value) ? lesRes.value : (lesRes.value?.lessons ?? []))
        : [];
      const recs = recRes.status === 'fulfilled'
        ? (Array.isArray(recRes.value) ? recRes.value : (recRes.value?.recommendations ?? []))
        : [];
      return {
        status: lessons.length > 0 ? 'active' : 'idle',
        summary: `${lessons.length} lesson${lessons.length !== 1 ? 's' : ''} · ${recs.length} recommendation${recs.length !== 1 ? 's' : ''}`,
        items: lessons.slice(0, 3).map(l => ({
          label: l.title ?? l.lesson ?? l.text?.slice(0, 50) ?? 'Lesson',
          meta: l.source ?? 'learning',
          statusOk: true,
        })),
        actions: [
          { label: 'Memory OS', tab: 'memory' },
          { label: 'Self-Improve', tab: 'selfimprove' },
        ],
        rollback: null,
      };
    },
  },
  {
    id: 'recommend',
    label: 'Recommend',
    icon: '✦',
    tab: 'recommend',
    desc: 'Observer recommendations',
    fetch: async () => {
      const r = await getObserverRecs();
      const list = Array.isArray(r) ? r : (r?.recommendations ?? []);
      const critical = list.filter(x => x.priority === 'critical').length;
      const high     = list.filter(x => x.priority === 'high').length;
      return {
        status: critical > 0 ? 'warning' : list.length > 0 ? 'active' : 'idle',
        summary: `${list.length} recommendation${list.length !== 1 ? 's' : ''} · ${critical} critical · ${high} high`,
        items: list.slice(0, 3).map(r => ({
          label: r.title ?? r.action ?? 'Recommendation',
          meta: r.priority ?? 'normal',
          statusOk: r.priority !== 'critical' && r.priority !== 'high',
        })),
        actions: [{ label: 'Recommendation Center', tab: 'recommend' }],
        rollback: critical > 0 ? `${critical} critical recommendation${critical > 1 ? 's' : ''} require attention` : null,
      };
    },
  },
  {
    id: 'executive',
    label: 'Executive Review',
    icon: '◉',
    tab: 'executivedash',
    desc: 'Sign-off and KPI review',
    fetch: async () => {
      const r = await getMissionStats();
      const total    = r?.total ?? 0;
      const complete = r?.completed ?? r?.complete ?? 0;
      const pct      = total > 0 ? Math.round((complete / total) * 100) : 0;
      return {
        status: pct === 100 && total > 0 ? 'complete' : total > 0 ? 'active' : 'idle',
        summary: `${complete}/${total} missions complete (${pct}%)`,
        items: [],
        actions: [{ label: 'Executive Dashboard', tab: 'executivedash' }],
        rollback: null,
      };
    },
  },
];

// ── Status colours ────────────────────────────────────────────────────────────
const STATUS = {
  active:   { color: '#22c55e', label: 'Active'   },
  idle:     { color: '#64748b', label: 'Idle'      },
  complete: { color: '#7c6fff', label: 'Complete'  },
  warning:  { color: '#ef4444', label: 'Warning'   },
  empty:    { color: '#374151', label: 'Empty'      },
  loading:  { color: '#374151', label: 'Loading…'  },
};

// ── Stage card ────────────────────────────────────────────────────────────────
function StageCard({ stage, data, active, onNavigate, onSelect, isSelected }) {
  const st = STATUS[data?.status ?? 'loading'];
  const hasRollback = !!data?.rollback;

  return (
    <div
      className={`wsp-card ${isSelected ? 'wsp-card--selected' : ''} ${active ? 'wsp-card--active' : ''}`}
      onClick={() => onSelect(stage.id)}
    >
      <div className="wsp-card-header">
        <span className="wsp-card-icon">{stage.icon}</span>
        <div className="wsp-card-meta">
          <div className="wsp-card-label">{stage.label}</div>
          <div className="wsp-card-desc">{stage.desc}</div>
        </div>
        <span
          className="wsp-card-status"
          style={{ color: st.color, borderColor: st.color + '44', background: st.color + '14' }}
        >
          {data ? st.label : '…'}
        </span>
      </div>

      {isSelected && data && (
        <div className="wsp-card-detail">
          <div className="wsp-card-summary">{data.summary}</div>

          {data.items?.length > 0 && (
            <div className="wsp-card-items">
              {data.items.map((item, i) => (
                <div key={i} className="wsp-card-item">
                  <span style={{ color: item.statusOk ? '#22c55e' : '#ef4444', fontSize: 11 }}>
                    {item.statusOk ? '✓' : '○'}
                  </span>
                  <span className="wsp-card-item-label">{item.label}</span>
                  <span className="wsp-card-item-meta">{item.meta}</span>
                </div>
              ))}
            </div>
          )}

          {hasRollback && (
            <div className="wsp-card-rollback">
              ⚠ {data.rollback}
            </div>
          )}

          <div className="wsp-card-actions">
            {data.actions?.map((a, i) => (
              <button
                key={i}
                className={`wsp-action-btn ${i === 0 ? 'wsp-action-btn--primary' : ''}`}
                onClick={(e) => { e.stopPropagation(); onNavigate?.(a.tab); }}
              >
                {a.label} →
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export default function WorkflowStagePanel({ currentTab, onNavigate, compact = false }) {
  const [stageData,    setStageData]    = useState({});
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(null);
  const [lastRefresh,  setLastRefresh]  = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    const tasks = PIPELINE.map(stage =>
      stage.fetch()
        .then(data => ({ id: stage.id, data }))
        .catch(() => ({ id: stage.id, data: { status: 'warning', summary: 'Failed to load', items: [], actions: [], rollback: null } }))
    );
    Promise.all(tasks).then(results => {
      const map = {};
      results.forEach(r => { map[r.id] = r.data; });
      setStageData(map);
      setLoading(false);
      setLastRefresh(new Date());
    });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  // Highlight the stage matching currentTab
  const activeStageId = PIPELINE.find(s => s.tab === currentTab)?.id ?? null;

  // Overall completion
  const completed = Object.values(stageData).filter(d => d?.status === 'complete' || d?.status === 'active').length;
  const warnings  = Object.values(stageData).filter(d => d?.status === 'warning').length;
  const pct       = PIPELINE.length > 0 ? Math.round((completed / PIPELINE.length) * 100) : 0;

  if (compact) {
    return (
      <div className="wsp-compact">
        <div className="wsp-compact-header">
          <span className="wsp-compact-title">⬡ Engineering Pipeline</span>
          <span className="wsp-compact-pct">{pct}%</span>
          {warnings > 0 && <span className="wsp-compact-warn">{warnings} ⚠</span>}
          <button className="wsp-compact-refresh" onClick={refresh}>↺</button>
        </div>
        <div className="wsp-compact-track">
          {PIPELINE.map((stage, i) => {
            const data  = stageData[stage.id];
            const st    = STATUS[data?.status ?? 'loading'];
            const isAct = stage.id === activeStageId;
            return (
              <React.Fragment key={stage.id}>
                <button
                  className={`wsp-compact-step ${isAct ? 'wsp-compact-step--active' : ''}`}
                  style={{ color: data ? st.color : '#374151' }}
                  onClick={() => stage.tab && onNavigate?.(stage.tab)}
                  title={`${stage.label}: ${data?.summary ?? 'loading'}`}
                >
                  <span className="wsp-compact-step-icon">{stage.icon}</span>
                  <span className="wsp-compact-step-label">{stage.label}</span>
                </button>
                {i < PIPELINE.length - 1 && (
                  <span className="wsp-compact-arrow" style={{ color: data?.status === 'active' || data?.status === 'complete' ? '#7c6fff44' : '#1e2333' }}>›</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="wsp-root">
      <div className="wsp-header">
        <div className="wsp-header-left">
          <span className="wsp-header-title">⬡ Engineering Pipeline</span>
          <span className="wsp-header-meta">
            {completed}/{PIPELINE.length} stages active · {warnings > 0 ? `${warnings} warning${warnings > 1 ? 's' : ''}` : 'no warnings'}
          </span>
        </div>
        <div className="wsp-header-right">
          <div className="wsp-overall-bar">
            <div className="wsp-overall-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="wsp-overall-pct">{pct}%</span>
          <button className="wsp-refresh-btn" onClick={refresh} title="Refresh all stages">↺</button>
        </div>
      </div>

      <div className="wsp-grid">
        {PIPELINE.map(stage => (
          <StageCard
            key={stage.id}
            stage={stage}
            data={stageData[stage.id]}
            active={stage.id === activeStageId}
            isSelected={selected === stage.id}
            onNavigate={onNavigate}
            onSelect={id => setSelected(id === selected ? null : id)}
          />
        ))}
      </div>

      {lastRefresh && (
        <div className="wsp-footer">
          Updated {lastRefresh.toLocaleTimeString()} · Click any stage for details and actions
        </div>
      )}
    </div>
  );
}
