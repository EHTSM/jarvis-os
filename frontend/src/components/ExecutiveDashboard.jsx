import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { _fetch } from "../_client";
import "./ExecutiveDashboard.css";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";

// ── Animation presets ────────────────────────────────────────────────
const FADE_UP = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };
const fadeUp  = (delay = 0) => ({ ...FADE_UP, transition: { duration: 0.35, delay } });

// ── Fallback / seed data ─────────────────────────────────────────────
const SEED_MISSIONS = [
  { id: "m1", objective: "Grow MRR to $50K via enterprise outreach campaign",  status: "active",   priority: "high",   pct: 62, lastActivity: "2m ago"  },
  { id: "m2", objective: "Close Q3 enterprise pipeline — 10 target accounts",   status: "active",   priority: "high",   pct: 40, lastActivity: "7m ago"  },
  { id: "m3", objective: "Launch SEO content engine — 100 articles by Aug",     status: "active",   priority: "medium", pct: 88, lastActivity: "12m ago" },
  { id: "m4", objective: "Reduce infrastructure spend by 30% via rightsizing",  status: "planning", priority: "medium", pct: 15, lastActivity: "1h ago"  },
  { id: "m5", objective: "Achieve sub-2h customer support SLA at scale",        status: "queued",   priority: "low",    pct: 0,  lastActivity: "3h ago"  },
];

const SEED_RECOMMENDATIONS = [
  { objective: "Accelerate enterprise pipeline outreach",         rationale: "Low pipeline velocity detected — only 3 touches/week avg. Increasing cadence to 7 projected to close 2 additional deals.", confidence: 84 },
  { objective: "Trigger automated SEO content burst",             rationale: "Content velocity stalled at 60% of target. Dispatching Content Agent batch to close gap before quarter end.",            confidence: 79 },
  { objective: "Initiate infra rightsizing for compute clusters", rationale: "CPU utilization consistently below 40%. Rightsizing 4 clusters projected to save $1,200/mo.",                           confidence: 91 },
];

function computeRisks({ errorRate, deploySuccess, missions }) {
  const risks = [];
  if (errorRate !== null && errorRate > 3) {
    risks.push({ level: "high",   desc: `Error rate at ${errorRate.toFixed(1)}% — exceeds 3% threshold. Investigate API layer and agent error handlers.` });
  } else {
    risks.push({ level: "low",    desc: "Error rate within acceptable bounds. No immediate action required." });
  }
  if (deploySuccess !== null && deploySuccess < 90) {
    risks.push({ level: "high",   desc: `Deployment success rate dropped to ${deploySuccess.toFixed(0)}%. Review recent pipeline failures and rollback strategy.` });
  } else {
    risks.push({ level: "medium", desc: "Deployment success rate is healthy but trending slightly downward. Monitor next 3 deployments." });
  }
  const overdue = missions.filter(m => m.status === "active" && m.pct < 20).length;
  if (overdue > 0) {
    risks.push({ level: "medium", desc: `${overdue} active mission${overdue > 1 ? "s" : ""} with under 20% progress. Risk of missing quarterly targets.` });
  } else {
    risks.push({ level: "low",    desc: "All active missions are progressing above 20%. Strategic momentum on track." });
  }
  return risks.slice(0, 3);
}

// ── Sub-components ───────────────────────────────────────────────────

function StatCard({ value, label, sub, colorClass }) {
  return (
    <div className={`ed-stat-card ${colorClass ? `ed-stat-card--${colorClass}` : ""}`}>
      <div className={`ed-stat-value ${colorClass ? `ed-stat-value--${colorClass}` : ""}`}>{value}</div>
      <div className="ed-stat-label">{label}</div>
      {sub && <div className="ed-stat-sub">{sub}</div>}
    </div>
  );
}

function Badge({ status }) {
  const cls = `ed-badge ed-badge--${status}`;
  return <span className={cls}>{status}</span>;
}

function PriorityBadge({ priority }) {
  return <span className={`ed-badge ed-badge--${priority}`}>{priority}</span>;
}

function ProgressBar({ pct }) {
  return (
    <div className="ed-progress-bar">
      <div className="ed-progress-bar__track">
        <div className="ed-progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="ed-progress-bar__pct">{pct}%</div>
    </div>
  );
}

function RecItem({ item }) {
  return (
    <div className="ed-rec-item">
      <div className="ed-rec-item__obj">{item.objective}</div>
      <div className="ed-rec-item__rationale">{item.rationale}</div>
      <div className="ed-rec-item__footer">
        <span className="ed-rec-item__confidence">Confidence: {item.confidence}%</span>
      </div>
    </div>
  );
}

function RiskItem({ risk }) {
  const modifier = risk.level === "medium" ? "ed-risk-item--medium" : risk.level === "low" ? "ed-risk-item--low" : "";
  return (
    <div className={`ed-risk-item ${modifier}`}>
      <div className="ed-risk-item__body">
        <PriorityBadge priority={risk.level} />
        <div className="ed-risk-item__desc">{risk.desc}</div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(val, fallback = "—") {
  if (val === null || val === undefined) return fallback;
  return val;
}

function pct(val, fallback = "—") {
  if (val === null || val === undefined) return fallback;
  return `${Number(val).toFixed(0)}%`;
}

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Lifecycle Intelligence widget ─────────────────────────────────────
const LC_COLORS = {
  observe:'#60a5fa', detect:'#60a5fa', reason:'#a78bfa', recommend:'#a78bfa',
  plan:'#fbbf24', delegate:'#fbbf24', execute:'#34d399', review:'#34d399',
  test:'#34d399', secure:'#f87171', deploy:'#fb923c', verify:'#fb923c',
  heal:'#94a3b8', learn:'#94a3b8',
};

function LifecycleIntelligence({ missions }) {
  const [stages, setStages] = useState([]);

  useEffect(() => {
    const running = missions.filter(m =>
      m.status === 'active' || m.status === 'running'
    ).slice(0, 3);
    if (running.length === 0) return;

    let mounted = true;
    Promise.allSettled(
      running.map(m => _fetch(`/runtime/stage/${m.id}`).catch(() => null))
    ).then(results => {
      if (!mounted) return;
      const rows = results
        .map((r, i) => {
          if (r.status !== 'fulfilled' || !r.value?.stage) return null;
          return { mission: running[i], stageData: r.value.stage };
        })
        .filter(Boolean);
      setStages(rows);
    });
    return () => { mounted = false; };
  }, [missions]);

  if (stages.length === 0) return null;

  return (
    <motion.div className="ed-section" {...fadeUp(0.175)}>
      <div className="ed-section__title">Lifecycle Runtime</div>
      <div className="ed-lc-grid">
        {stages.map(({ mission, stageData: s }) => {
          const color = LC_COLORS[s.stage] || '#6b7280';
          return (
            <div key={mission.id} className="ed-lc-card">
              <div className="ed-lc-card__obj" title={mission.objective}>
                {(mission.objective || '').slice(0, 48)}{mission.objective?.length > 48 ? '…' : ''}
              </div>
              <div className="ed-lc-card__stage" style={{ color }}>
                {s.stageLabel || s.stage}
              </div>
              <div className="ed-lc-card__meta">
                {s.agent && <span className="ed-lc-badge">{s.agent}</span>}
                {s.confidence != null && (
                  <span className="ed-lc-badge ed-lc-badge--conf">{s.confidence}% conf</span>
                )}
              </div>
              <div className="ed-lc-card__bar">
                <div
                  className="ed-lc-card__fill"
                  style={{ width: `${s.progressPct || 0}%`, background: color }}
                />
              </div>
              <div className="ed-lc-card__pct">{s.progressPct || 0}% through lifecycle</div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Intelligence Insights widget ─────────────────────────────────────
function IntelligenceInsights() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    _fetch("/intelligence/insights")
      .then(r => { if (mounted) setData(r); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!data?.insights?.length) return null;

  const top = data.insights.slice(0, 3);
  return (
    <motion.div className="ed-section" {...fadeUp(0.18)}>
      <div className="ed-section__title">Cross-Domain Intelligence</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {top.map((ins, i) => {
          const sevColor = ins.severity === "high" ? "#ef4444" : ins.severity === "medium" ? "#eab308" : "#22c55e";
          return (
            <div key={ins.domain ?? i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              background: "#0f1117", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 5, padding: "10px 12px",
            }}>
              <div style={{ width: 3, alignSelf: "stretch", background: sevColor, borderRadius: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
                  {(ins.domain || "").replace(/_/g, " → ")}
                </div>
                <div style={{ fontSize: 12, color: "#e2e8f0" }}>{ins.insight}</div>
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8,
                background: sevColor + "18", color: sevColor, border: `1px solid ${sevColor}44`, flexShrink: 0,
              }}>{ins.strength}%</div>
            </div>
          );
        })}
      </div>
      {data.summary?.avgCorrelationStrength != null && (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
          {data.summary.totalDomains} domains · avg correlation {data.summary.avgCorrelationStrength}%
          {data.summary.highPriorityCount > 0 && ` · ${data.summary.highPriorityCount} high priority`}
        </div>
      )}
    </motion.div>
  );
}

// ── J6: Deployment Feed ──────────────────────────────────────────────
function DeploymentFeed() {
  const [deploys, setDeploys] = useState([]);

  useEffect(() => {
    let mounted = true;
    _fetch("/p22/deploy/history")
      .then(r => { if (mounted) setDeploys((r.history || r.checks || (Array.isArray(r) ? r : [])).slice(0, 8)); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!deploys.length) return null;

  return (
    <motion.div className="ed-section" {...fadeUp(0.19)}>
      <div className="ed-section__title">Deployment Feed</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {deploys.map((d, i) => {
          const ok    = d.status === 'passed' || d.status === 'ok' || d.passed === true || d.overallStatus === 'passed';
          const ts    = d.timestamp || d.checkedAt || d.createdAt;
          const color = ok ? '#22c55e' : '#ef4444';
          return (
            <div key={d.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#0f1117', border: `1px solid ${color}22`, borderRadius: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#e2e8f0' }}>{d.pipeline || d.environment || d.name || `Deployment ${i + 1}`}</div>
                {d.summary && <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{String(d.summary).slice(0, 60)}</div>}
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, color, padding: '1px 6px', borderRadius: 8, background: color + '18' }}>
                {ok ? 'PASSED' : 'FAILED'}
              </span>
              {ts && <span style={{ fontSize: 9, color: '#475569', flexShrink: 0 }}>{new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── J6: Observer Status ───────────────────────────────────────────────
function ObserverStatus() {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let mounted = true;
    _fetch("/p21/obs/snapshot")
      .then(r => { if (mounted) setSnapshot(r); })
      .catch(() => {});
    const t = setInterval(() => {
      if (!document.hidden) {
        _fetch("/p21/obs/snapshot").then(r => { if (mounted) setSnapshot(r); }).catch(() => {});
      }
    }, 30000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  if (!snapshot) return null;

  const alerts    = snapshot.alerts || [];
  const activeAl  = alerts.filter(a => a.firing || a.active);
  const metrics   = snapshot.metrics || {};
  const metricKeys = Object.keys(metrics).slice(0, 6);

  if (!activeAl.length && !metricKeys.length) return null;

  return (
    <motion.div className="ed-section" {...fadeUp(0.21)}>
      <div className="ed-section__title">Observer Status</div>
      {activeAl.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {activeAl.slice(0, 4).map((a, i) => (
            <div key={a.name || i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', background: '#ef444418', padding: '1px 5px', borderRadius: 6 }}>ALERT</span>
              <span style={{ color: '#e2e8f0' }}>{a.name || a.metric}</span>
              {a.value != null && <span style={{ color: '#64748b', marginLeft: 'auto' }}>{a.value}</span>}
            </div>
          ))}
        </div>
      )}
      {metricKeys.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {metricKeys.map(key => {
            const m = metrics[key];
            const last = Array.isArray(m?.values) ? m.values[m.values.length - 1]?.value : m?.last ?? null;
            return (
              <div key={key} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '5px 7px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{key}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{last ?? '—'}</div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ── J5: Recommendation Approval Cards ────────────────────────────────
function RecommendationApprovalCards({ missions }) {
  const [items,    setItems]    = useState([]);
  const [acting,   setActing]   = useState({});
  const [aiReply,  setAiReply]  = useState(null);

  useEffect(() => {
    if (!missions.length) return;
    // Collect the first active mission with a history
    const active = missions.find(m => m.status === 'active' || m.status === 'running' || m.status === 'planned');
    if (!active) return;
    let mounted = true;
    _fetch(`/collaboration/history/${active.id}`)
      .then(r => {
        if (!mounted) return;
        const pending = r.history?.pending || [];
        setItems(pending.slice(0, 4));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [missions]);

  const doAction = useCallback(async (act, missionId, itemId, reason) => {
    const key = `${missionId}_${itemId}_${act}`;
    setActing(a => ({ ...a, [key]: true }));
    try {
      const endpoint = act === 'approve' ? '/collaboration/approve' : '/collaboration/reject';
      await _fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, itemId, reason }),
      });
      setItems(prev => prev.filter(p => p.id !== itemId));
      setAiReply(act === 'approve' ? 'Recommendation accepted and recorded to mission timeline.' : 'Recommendation rejected and recorded to mission timeline.');
    } catch (e) {
      setAiReply(`Error: ${e.message}`);
    } finally {
      setActing(a => { const next = { ...a }; delete next[key]; return next; });
    }
  }, []);

  if (!items.length && !aiReply) return null;

  return (
    <motion.div className="ed-section" {...fadeUp(0.22)}>
      <div className="ed-section__title">Pending Approvals</div>
      {aiReply && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, padding: '6px 10px', background: 'rgba(96,165,250,0.07)', borderRadius: 4 }}>
          {aiReply}
        </div>
      )}
      {items.length === 0 && <div className="ed-empty">No pending recommendations requiring approval.</div>}
      {items.map((item, i) => {
        const mId = item.missionId || missions[0]?.id;
        const approveKey = `${mId}_${item.id}_approve`;
        const rejectKey  = `${mId}_${item.id}_reject`;
        return (
          <div key={item.id || i} style={{
            background: '#0f1117', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5, padding: '10px 12px', marginBottom: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
              {item.title || item.description || `Recommendation ${i + 1}`}
            </div>
            {item.rationale && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{item.rationale}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => doAction('approve', mId, item.id, 'Approved from executive dashboard')}
                disabled={!!acting[approveKey]}
                style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {acting[approveKey] ? '…' : '✓ Accept'}
              </button>
              <button
                onClick={() => doAction('reject', mId, item.id, 'Rejected from executive dashboard')}
                disabled={!!acting[rejectKey]}
                style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {acting[rejectKey] ? '…' : '✕ Reject'}
              </button>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function ExecutiveDashboard({ onNavigate }) {
  const [lastRefresh, setLastRefresh]   = useState(timeStr());
  const [dataError,   setDataError]     = useState(false);

  // Mission status
  const [missions,    setMissions]      = useState(SEED_MISSIONS);
  const [missionsLive, setMissionsLive] = useState(false);

  // Engineering throughput
  const [cycleStats,  setCycleStats]    = useState(null);

  // Runtime health
  const [healthData,  setHealthData]    = useState(null);

  // Recommendations
  const [recs,        setRecs]          = useState(SEED_RECOMMENDATIONS);
  const [recsLive,    setRecsLive]      = useState(false);

  // Improvement metrics
  const [impMetrics,  setImpMetrics]    = useState(null);

  // ── Fetch helpers ──────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    let anyError = false;
    const safe = async (url, setter, transform) => {
      try {
        const data = await _fetch(url);
        setter(transform ? transform(data) : data);
        return true;
      } catch (_) {
        anyError = true;
        return false;
      }
    };

    // Mission status
    const mOk = await safe("/metrics/dashboard", data => {
      if (data?.missions && Array.isArray(data.missions)) {
        setMissions(data.missions.slice(0, 5));
        setMissionsLive(true);
      }
    });

    // Engineering throughput (p18)
    safe("/p18/cycles/stats", data => {
      setCycleStats({
        tasksCompleted:  data?.tasksCompleted  ?? data?.completedToday ?? null,
        deploySuccess:   data?.deploySuccess   ?? data?.deploymentSuccessRate ?? null,
        avgCycleTime:    data?.avgCycleTime    ?? data?.avgDurationSec ?? null,
        agentUtilization:data?.agentUtilization ?? data?.utilization ?? null,
      });
    });

    // Runtime health
    safe("/metrics/errors/rate", data => {
      setHealthData(prev => ({ ...prev, errorRate: data?.rate ?? data?.errorRate ?? null }));
    });

    safe("/metrics/health", data => {
      setHealthData(prev => ({
        ...prev,
        cpu:           data?.cpu            ?? null,
        memory:        data?.memory         ?? null,
        activeAgents:  data?.activeAgents   ?? null,
        lastDeploy:    data?.lastDeploy     ?? null,
        uptime:        data?.uptime         ?? null,
      }));
    });

    // Recommendations (p27 primary, p20 fallback)
    try {
      const d27 = await _fetch("/p27/planning/recommend");
      if (Array.isArray(d27?.recommendations) && d27.recommendations.length > 0) {
        setRecs(d27.recommendations.slice(0, 3).map(r => ({
          objective:  r.nextObjective ?? r.objective ?? "—",
          rationale:  r.rationale     ?? r.reasoning ?? "",
          confidence: r.confidence    ?? r.score     ?? 0,
        })));
      } else {
        throw new Error("empty");
      }
    } catch (_) {
      try {
        const d20 = await _fetch("/p20/improve/recommendations");
        if (Array.isArray(d20) && d20.length > 0) {
          setRecs(d20.slice(0, 3).map(r => ({
            objective:  r.title       ?? r.objective ?? "—",
            rationale:  r.description ?? r.rationale ?? "",
            confidence: r.score       ?? r.confidence ?? 0,
          })));
        }
      } catch (_) {
        // keep seed recs
      }
    }

    // Improvement metrics
    safe("/p27/improvement/metrics", data => {
      setImpMetrics({
        predictionAccuracy:      data?.predictionAccuracy      ?? data?.accuracy      ?? null,
        recommendationAcceptance:data?.recommendationAcceptance ?? data?.acceptance    ?? null,
        missionCompletionRate:   data?.missionCompletionRate   ?? data?.completionRate ?? null,
        selfImprovementScore:    data?.selfImprovementScore    ?? data?.score          ?? null,
      });
    });

    setDataError(anyError);
    setLastRefresh(timeStr());
  }, []);

  // ── Mount + 30s polling ────────────────────────────────────────────

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── Derived values ─────────────────────────────────────────────────

  const activeMissions   = missions.filter(m => m.status === "active").length;
  const completedToday   = missions.filter(m => m.status === "completed").length;
  const failedToday      = missions.filter(m => m.status === "failed").length;
  const pendingApproval  = missions.filter(m => m.status === "pending").length;

  const errorRate      = healthData?.errorRate   ?? null;
  const deploySuccess  = cycleStats?.deploySuccess ?? null;
  const risks          = computeRisks({ errorRate, deploySuccess, missions });

  const fmtCycleTime = v => {
    if (v === null || v === undefined) return "—";
    if (v >= 3600) return `${(v / 3600).toFixed(1)}h`;
    if (v >= 60)   return `${Math.round(v / 60)}m`;
    return `${Math.round(v)}s`;
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="ed-root">
      <PageHeader
        icon="◉"
        title="Executive Dashboard"
        subtitle="CEO-level view of missions, engineering throughput, runtime health and strategic intelligence"
        related={[
          { label: "Missions", tab: "jarvisbrain", icon: "🎯" },
          { label: "Recommendation", tab: "recommend", icon: "✦" },
          { label: "Reliability", tab: "reliability", icon: "◈" },
          { label: "Memory", tab: "memory", icon: "◎" },
          { label: "Self-Improve", tab: "selfimprove", icon: "⬡" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="executivedash" onNavigate={onNavigate} />

      {dataError && !missionsLive && (
        <div className="ac-api-banner ac-api-banner--error" role="alert">
          ⚠ Live data unavailable — showing example data. Check backend connectivity.
        </div>
      )}

      {/* ── Header ── */}
      <motion.div className="ed-header" {...fadeUp(0)}>
        <div>
          <h1 className="ed-header__title">Executive Dashboard</h1>
          <p className="ed-header__subtitle">CEO-level view of missions, engineering throughput, runtime health and strategic intelligence.</p>
        </div>
        <div className="ed-header__right">
          <span className="ed-ts">Refreshed {lastRefresh}</span>
          <div className="ed-live-badge">
            <div className="ed-live-dot" />
            LIVE
          </div>
        </div>
      </motion.div>

      {/* ── Row 1: Mission Status ── */}
      <motion.div className="ed-section" {...fadeUp(0.05)}>
        <div className="ed-section__title">Mission Status</div>
        <div className="ed-stat-row">
          <StatCard
            value={fmt(activeMissions, "—")}
            label="Active Missions"
            colorClass="green"
          />
          <StatCard
            value={fmt(completedToday, "—")}
            label="Completed Today"
            colorClass="teal"
          />
          <StatCard
            value={fmt(failedToday, "—")}
            label="Failed Today"
            colorClass={failedToday > 0 ? "red" : "dim"}
          />
          <StatCard
            value={fmt(pendingApproval, "—")}
            label="Pending Approval"
            colorClass={pendingApproval > 0 ? "amber" : "dim"}
          />
        </div>
      </motion.div>

      {/* ── Row 2: Engineering Throughput ── */}
      <motion.div className="ed-section" {...fadeUp(0.1)}>
        <div className="ed-section__title">Engineering Throughput</div>
        <div className="ed-stat-row">
          <StatCard
            value={fmt(cycleStats?.tasksCompleted, "—")}
            label="Tasks Completed"
            sub="last 24h"
            colorClass="accent"
          />
          <StatCard
            value={deploySuccess !== null ? `${deploySuccess.toFixed(0)}%` : "—"}
            label="Deploy Success Rate"
            colorClass={deploySuccess === null ? "dim" : deploySuccess >= 90 ? "green" : deploySuccess >= 75 ? "amber" : "red"}
          />
          <StatCard
            value={fmtCycleTime(cycleStats?.avgCycleTime)}
            label="Avg Cycle Time"
            colorClass="teal"
          />
          <StatCard
            value={cycleStats?.agentUtilization !== null && cycleStats?.agentUtilization !== undefined
              ? `${Number(cycleStats.agentUtilization).toFixed(0)}%`
              : "—"}
            label="Agent Utilization"
            colorClass="accent"
          />
        </div>
      </motion.div>

      {/* ── Row 3: Runtime Health ── */}
      <motion.div className="ed-section" {...fadeUp(0.15)}>
        <div className="ed-section__title">Runtime Health</div>
        <div className="ed-health-grid">
          <StatCard
            value={healthData?.cpu !== null && healthData?.cpu !== undefined ? `${Number(healthData.cpu).toFixed(0)}%` : "monitoring"}
            label="CPU Usage"
            colorClass={healthData?.cpu > 80 ? "red" : healthData?.cpu > 60 ? "amber" : "green"}
          />
          <StatCard
            value={healthData?.memory !== null && healthData?.memory !== undefined ? `${Number(healthData.memory).toFixed(0)}%` : "monitoring"}
            label="Memory"
            colorClass={healthData?.memory > 85 ? "red" : healthData?.memory > 70 ? "amber" : "teal"}
          />
          <StatCard
            value={errorRate !== null ? `${Number(errorRate).toFixed(2)}%` : "—"}
            label="Error Rate"
            colorClass={errorRate === null ? "dim" : errorRate > 5 ? "red" : errorRate > 2 ? "amber" : "green"}
          />
          <StatCard
            value={healthData?.activeAgents !== null && healthData?.activeAgents !== undefined ? healthData.activeAgents : "—"}
            label="Active Agents"
            colorClass="accent"
          />
          <StatCard
            value={healthData?.lastDeploy ?? "—"}
            label="Last Deployment"
            colorClass="teal"
          />
          <StatCard
            value={healthData?.uptime ?? "—"}
            label="Uptime"
            colorClass="green"
          />
        </div>
      </motion.div>

      {/* ── Lifecycle Runtime Intelligence ── */}
      <LifecycleIntelligence missions={missions} />

      {/* ── Cross-Domain Intelligence ── */}
      <IntelligenceInsights />

      {/* ── J6: Deployment Feed ── */}
      <DeploymentFeed />

      {/* ── J6: Observer Status ── */}
      <ObserverStatus />

      {/* ── Recommendation Approvals (J5) ── */}
      <RecommendationApprovalCards missions={missions} />

      {/* ── Row 4: Active Missions ── */}
      <motion.div className="ed-section" {...fadeUp(0.2)}>
        <div className="ed-section__title">Active Missions</div>
        <div className="ed-mission-list">
          <div className="ed-mission-list__head">
            <span>Objective</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Progress</span>
            <span>Last Activity</span>
          </div>
          {missions.length === 0 && (
            <div className="ed-empty">No missions found.</div>
          )}
          {missions.map(m => (
            <div
              key={m.id ?? m.objective}
              className="ed-mission-row"
              onClick={() => onNavigate && onNavigate("missionMemory")}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === "Enter" && onNavigate && onNavigate("missionMemory")}
              title={m.objective}
            >
              <div className="ed-mission-obj">{m.objective}</div>
              <Badge status={m.status} />
              <PriorityBadge priority={m.priority} />
              <ProgressBar pct={m.pct ?? 0} />
              <span className="ed-mission-ts">{m.lastActivity ?? "—"}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Row 5: Predictions & Recommendations ── */}
      <motion.div className="ed-section" {...fadeUp(0.25)}>
        <div className="ed-section__title">Predictions &amp; Recommendations</div>
        <div className="ed-two-col">
          <div className="ed-panel">
            <div className="ed-panel__title">Strategic Recommendations</div>
            {recs.length === 0 ? (
              <div className="ed-empty">No recommendations available.</div>
            ) : (
              recs.map((r, i) => <RecItem key={i} item={r} />)
            )}
          </div>
          <div className="ed-panel">
            <div className="ed-panel__title">Strategic Risks</div>
            {risks.map((risk, i) => <RiskItem key={i} risk={risk} />)}
          </div>
        </div>
      </motion.div>

      {/* ── Row 6: Improvement Metrics ── */}
      <motion.div className="ed-section" {...fadeUp(0.3)}>
        <div className="ed-section__title">Improvement Metrics</div>
        <div className="ed-improve-row">
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "var(--accent)" }}>
              {pct(impMetrics?.predictionAccuracy)}
            </div>
            <div className="ed-improve-lbl">Prediction Accuracy</div>
          </div>
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "var(--accent2)" }}>
              {pct(impMetrics?.recommendationAcceptance)}
            </div>
            <div className="ed-improve-lbl">Rec. Acceptance Rate</div>
          </div>
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "#22c55e" }}>
              {pct(impMetrics?.missionCompletionRate)}
            </div>
            <div className="ed-improve-lbl">Mission Completion</div>
          </div>
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "#f59e0b" }}>
              {impMetrics?.selfImprovementScore !== null && impMetrics?.selfImprovementScore !== undefined
                ? `${Number(impMetrics.selfImprovementScore).toFixed(1)}`
                : "—"}
            </div>
            <div className="ed-improve-lbl">Self-Improvement Score</div>
          </div>
        </div>
      </motion.div>

      {/* ── Row 7: Graph Reasoning ── */}
      <GraphReasoningSection />

    </div>
  );
}

// ── Graph Reasoning Section (Q2) ─────────────────────────────────────
function GraphReasoningSection() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch('/graph/reasoning/executive')
      .then(r => { if (r?.ok) setData(r); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const FADE_UP = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };
  const fadeUp  = (d = 0) => ({ ...FADE_UP, transition: { duration: 0.35, delay: d } });

  if (loading) return null;
  if (!data)   return null;

  const risks   = data.topRisks || [];
  const ops     = data.topOpportunities || [];
  const recs    = data.topRecommendedMissions || [];
  const health  = data.healthScore;
  const summary = data.summary;

  return (
    <motion.div className="ed-section" {...fadeUp(0.35)}>
      <div className="ed-section__title">
        Graph Reasoning
        {health != null && (
          <span style={{ marginLeft: 8, fontSize: 11, color: health >= 70 ? '#22c55e' : health >= 40 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
            Health {health}/100
          </span>
        )}
      </div>
      {summary && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>{summary}</div>}

      {risks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-dim)' }}>TOP RISKS</div>
          {risks.slice(0, 3).map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ background: r.risk === 'critical' || r.severity === 'critical' ? '#ef4444' : '#f59e0b', borderRadius: 3, padding: '1px 5px', fontSize: 10, color: '#fff', flexShrink: 0 }}>
                {r.type?.replace(/_/g,' ')}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text)' }}>{r.explanation || r.description || r.objective || r.id}</span>
            </div>
          ))}
        </div>
      )}

      {ops.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-dim)' }}>TOP OPPORTUNITIES</div>
          {ops.slice(0, 3).map((o, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--text)', marginBottom: 3 }}>
              <span style={{ color: 'var(--accent)', marginRight: 6 }}>▸</span>{o.title}
            </div>
          ))}
        </div>
      )}

      {recs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-dim)' }}>RECOMMENDED MISSIONS</div>
          {recs.slice(0, 3).map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--text)', marginBottom: 3 }}>
              <span style={{ color: '#22c55e', marginRight: 6 }}>+</span>{r.title}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
