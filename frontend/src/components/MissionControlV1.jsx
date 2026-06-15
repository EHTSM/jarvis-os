import React, { useState, useEffect, useCallback, useRef } from "react";
import { checkHealth, getStats, getOpsData, emergencyStop, emergencyResume } from "../api";
import { getRuntimeStatus, getRuntimeHistory } from "../runtimeApi";
import { listAgents, memoryStats, cycleStats } from "../phase18Api";
import { getAutonomyScore } from "../phase20Api";
import { getBillingStatus } from "../billingApi";
import { _fetch } from "../_client";
import "./MissionControlV1.css";

const REFRESH_INTERVAL = 30_000;

function StatusDot({ ok, warn }) {
  const cls = ok ? "mc-dot mc-dot--ok" : warn ? "mc-dot mc-dot--warn" : "mc-dot mc-dot--err";
  return <span className={cls} />;
}

function MetricCard({ icon, label, value, sub, status, onClick, children }) {
  return (
    <div className={`mc-card${onClick ? " mc-card--link" : ""}`} onClick={onClick}>
      <div className="mc-card-head">
        <span className="mc-card-icon">{icon}</span>
        <span className="mc-card-label">{label}</span>
        {status !== undefined && <StatusDot ok={status === "ok"} warn={status === "warn"} />}
      </div>
      <div className="mc-card-value">{value ?? <span className="mc-skeleton" />}</div>
      {sub && <div className="mc-card-sub">{sub}</div>}
      {children}
    </div>
  );
}

function AlertBanner({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <div className="mc-alerts">
      {warnings.map((w, i) => (
        <div key={i} className={`mc-alert mc-alert--${w.level || "warn"}`}>
          <span className="mc-alert-code">{w.code}</span>
          <span className="mc-alert-detail">{w.detail}</span>
        </div>
      ))}
    </div>
  );
}

function ServiceRow({ label, ok }) {
  return (
    <div className="mc-svc-row">
      <StatusDot ok={ok} />
      <span>{label}</span>
    </div>
  );
}

const LC_STAGE_COLOR = {
  observe: '#60a5fa', detect: '#60a5fa', reason: '#a78bfa', recommend: '#a78bfa',
  plan: '#fbbf24', delegate: '#fbbf24', execute: '#34d399', review: '#34d399',
  test: '#34d399', secure: '#f87171', deploy: '#fb923c', verify: '#fb923c',
  heal: '#94a3b8', learn: '#94a3b8',
};

function RecommendationConfidence() {
  const [recs, setRecs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await _fetch('/intelligence/recommendation-confidence');
      setRecs(r.recommendations || []);
      setSummary(r.summary || null);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && recs.length === 0) return null;
  if (!recs.length) return null;

  return (
    <section className="mc-section">
      <div className="mc-section-head">
        <h2>Recommendation Confidence</h2>
        {summary && (
          <span className="mc-badge" style={{ fontSize: 10, color: '#64748b' }}>
            avg {summary.avgConfidence}% · {summary.total} recs
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
        {recs.slice(0, 6).map((r, i) => {
          const conf = r.confidence ?? 0;
          const color = conf >= 80 ? '#22c55e' : conf >= 60 ? '#eab308' : '#ef4444';
          return (
            <div key={r.id ?? i} style={{
              background: '#0c0e14', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 5, padding: '9px 10px',
            }}>
              <div style={{ fontSize: 11, color: '#e2e8f0', marginBottom: 6, lineHeight: 1.3 }}>
                {r.title}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
                  <div style={{ width: `${conf}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 30, textAlign: 'right' }}>{conf}%</span>
              </div>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {r.source} · {r.priority} · risk: {r.risk}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LifecyclePanel() {
  const [missionId, setMissionId] = useState('');
  const [inputId,   setInputId]   = useState('');
  const [stage,     setStage]     = useState(null);
  const [events,    setEvents]    = useState([]);
  const [err,       setErr]       = useState(null);
  const [pausing,   setPausing]   = useState(false);
  const [resuming,  setResuming]  = useState(false);
  const [retrying,  setRetrying]  = useState(false);
  const eventsRef = useRef(null);

  const loadStage = useCallback(async (id) => {
    try {
      const r = await _fetch(`/runtime/stage/${id}`);
      setStage(r.stage || null);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);

  const loadEvents = useCallback(async (id) => {
    try {
      const r = await _fetch(`/runtime/events/${id}?limit=20`);
      setEvents(r.events || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (!missionId) return;
    loadStage(missionId);
    loadEvents(missionId);
    const t = setInterval(() => {
      if (!document.hidden) { loadStage(missionId); loadEvents(missionId); }
    }, 4000);
    return () => clearInterval(t);
  }, [missionId, loadStage, loadEvents]);

  useEffect(() => {
    if (eventsRef.current) eventsRef.current.scrollTop = eventsRef.current.scrollHeight;
  }, [events.length]);

  const start = useCallback(async () => {
    if (!inputId.trim()) return;
    try {
      await _fetch(`/runtime/lifecycle/start/${inputId.trim()}`, { method: 'POST', body: '{}' });
      setMissionId(inputId.trim());
    } catch (e) { setErr(e.message); }
  }, [inputId]);

  const pause = useCallback(async () => {
    if (!missionId || pausing) return;
    setPausing(true);
    try { await _fetch(`/runtime/pause/${missionId}`, { method: 'POST' }); await loadStage(missionId); }
    catch (e) { setErr(e.message); }
    finally { setPausing(false); }
  }, [missionId, pausing, loadStage]);

  const resume = useCallback(async () => {
    if (!missionId || resuming) return;
    setResuming(true);
    try { await _fetch(`/runtime/resume/${missionId}`, { method: 'POST' }); await loadStage(missionId); }
    catch (e) { setErr(e.message); }
    finally { setResuming(false); }
  }, [missionId, resuming, loadStage]);

  const retry = useCallback(async () => {
    if (!missionId || retrying) return;
    setRetrying(true);
    try { await _fetch(`/runtime/retry/${missionId}`, { method: 'POST' }); await loadStage(missionId); }
    catch (e) { setErr(e.message); }
    finally { setRetrying(false); }
  }, [missionId, retrying, loadStage]);

  const stageColor = stage ? (LC_STAGE_COLOR[stage.stage] || '#6b7280') : '#374151';

  return (
    <section className="mc-section mc-lifecycle">
      <div className="mc-section-head">
        <h2>Lifecycle Runtime</h2>
      </div>

      {/* Mission selector */}
      <div className="mc-lc-toolbar">
        <input
          className="mc-lc-input"
          placeholder="Mission ID (msn_…)"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') start(); }}
        />
        <button className="mc-btn mc-btn--sm" onClick={start} disabled={!inputId.trim()}>
          Attach
        </button>
        {err && <span className="mc-lc-err">{err}</span>}
      </div>

      {missionId && stage && (
        <>
          {/* Current stage */}
          <div className="mc-lc-stage-row">
            <div className="mc-lc-stage-dot" style={{ background: stageColor }} />
            <div className="mc-lc-stage-info">
              <span className="mc-lc-stage-name" style={{ color: stageColor }}>
                {stage.stageLabel || stage.stage || '—'}
              </span>
              <span className="mc-lc-stage-desc">{stage.description}</span>
            </div>
            <div className="mc-lc-stage-meta">
              {stage.agent && <span className="mc-lc-badge">{stage.agent}</span>}
              {stage.confidence != null && (
                <span className="mc-lc-badge mc-lc-badge--conf">{stage.confidence}% conf</span>
              )}
              <span className="mc-lc-badge mc-lc-badge--status">{stage.status}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mc-progress-bar mc-lc-progress">
            <div
              className="mc-progress-fill"
              style={{ width: `${stage.progressPct || 0}%`, background: stageColor }}
            />
          </div>
          <div className="mc-lc-progress-label">
            Stage {(stage.stageIndex || 0) + 1} of {stage.totalStages} — {stage.progressPct || 0}%
          </div>

          {/* Controls */}
          <div className="mc-lc-controls">
            <button className="mc-btn mc-btn--sm mc-btn--ghost" onClick={pause}  disabled={pausing || stage.status === 'paused'}>
              {pausing ? '…' : '⏸ Pause'}
            </button>
            <button className="mc-btn mc-btn--sm mc-btn--ghost" onClick={resume} disabled={resuming || stage.status === 'running'}>
              {resuming ? '…' : '▶ Resume'}
            </button>
            <button className="mc-btn mc-btn--sm mc-btn--ghost" onClick={retry}  disabled={retrying}>
              {retrying ? '…' : '↺ Retry'}
            </button>
          </div>

          {/* Live event stream */}
          {events.length > 0 && (
            <div className="mc-lc-events" ref={eventsRef}>
              {events.slice(-10).map((evt, i) => (
                <div key={i} className="mc-lc-event">
                  <span className="mc-lc-event-ts">{new Date(evt.ts).toLocaleTimeString()}</span>
                  <span className="mc-lc-event-type">{evt.type}</span>
                  {evt.stage && <span className="mc-lc-event-stage">{evt.stage}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function MissionControlV1({ onNavigate }) {
  const [health,    setHealth]    = useState(null);
  const [ops,       setOps]       = useState(null);
  const [stats,     setStats]     = useState(null);
  const [runtime,   setRuntime]   = useState(null);
  const [history,   setHistory]   = useState([]);
  const [agents,    setAgents]    = useState(null);
  const [memStat,   setMemStat]   = useState(null);
  const [cycles,    setCycles]    = useState(null);
  const [autonomy,  setAutonomy]  = useState(null);
  const [billing,   setBilling]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [stopPending,   setStopPending]   = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const [h, o, s, rt, hist, ag, ms, cy, au, bl] = await Promise.allSettled([
        checkHealth(),
        getOpsData(),
        getStats(),
        getRuntimeStatus(),
        getRuntimeHistory(10),
        listAgents(),
        memoryStats(),
        cycleStats(),
        getAutonomyScore(),
        getBillingStatus(),
      ]);
      if (h.status === "fulfilled")    setHealth(h.value);
      if (o.status === "fulfilled")    setOps(o.value);
      if (s.status === "fulfilled")    setStats(s.value);
      if (rt.status === "fulfilled")   setRuntime(rt.value);
      if (hist.status === "fulfilled") setHistory(hist.value?.history || hist.value || []);
      if (ag.status === "fulfilled")   setAgents(ag.value?.agents || ag.value || []);
      if (ms.status === "fulfilled")   setMemStat(ms.value);
      if (cy.status === "fulfilled")   setCycles(cy.value);
      if (au.status === "fulfilled")   setAutonomy(au.value);
      if (bl.status === "fulfilled")   setBilling(bl.value);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [load]);

  async function handleStop() {
    if (!window.confirm("Emergency stop all agents?")) return;
    setStopPending(true);
    try {
      await emergencyStop();
      setActionMsg({ ok: true, text: "Emergency stop issued." });
      load();
    } catch (e) {
      setActionMsg({ ok: false, text: "Stop failed: " + (e?.message || e) });
    } finally {
      setStopPending(false);
    }
  }

  async function handleResume() {
    setResumePending(true);
    try {
      await emergencyResume();
      setActionMsg({ ok: true, text: "Runtime resumed." });
      load();
    } catch (e) {
      setActionMsg({ ok: false, text: "Resume failed: " + (e?.message || e) });
    } finally {
      setResumePending(false);
    }
  }

  const nav = (id) => onNavigate && onNavigate(id);

  // Derived values
  const sysStatus  = ops?.status || health?.status || "unknown";
  const uptime     = ops?.uptime?.human || (health?.uptime_seconds != null ? `${Math.floor(health.uptime_seconds / 3600)}h` : null);
  const warnings   = ops?.warnings || health?.warnings || [];
  const heap       = ops?.memory?.current?.heap_mb;
  const queueCts   = ops?.queue?.counts || {};

  const revenue    = stats?.revenue_inr ?? stats?.revenue ?? null;
  const leadsCount = stats?.total_leads ?? stats?.leads ?? null;
  const msgToday   = stats?.messages_today ?? null;

  const activeAgents = Array.isArray(agents) ? agents.filter(a => a.status === "active" || a.status === "running").length : null;
  const totalAgents  = Array.isArray(agents) ? agents.length : null;

  const memNodes  = memStat?.total_nodes ?? memStat?.nodes ?? null;
  const memHealth = memStat?.health ?? (memNodes != null ? "ok" : null);

  const wfRuns    = cycles?.total_runs ?? cycles?.runs ?? null;
  const wfActive  = cycles?.active ?? null;

  const autoScore = autonomy?.score ?? autonomy?.overall_score ?? null;

  const billingPlan    = billing?.plan ?? "—";
  const billingStatus  = billing?.status ?? null;
  const billingDays    = billing?.daysLeft ?? null;

  const isEmergencyStopped = runtime?.emergency_stop || runtime?.stopped;

  return (
    <div className="mc-root">
      <div className="mc-header">
        <div className="mc-header-left">
          <span className="mc-logo">⬡</span>
          <div>
            <h1 className="mc-title">Mission Control</h1>
            <p className="mc-subtitle">Ooplix AI Operating System</p>
          </div>
        </div>
        <div className="mc-header-right">
          <span className={`mc-sys-badge mc-sys-badge--${sysStatus}`}>
            {sysStatus.toUpperCase()}
          </span>
          {uptime && <span className="mc-uptime">up {uptime}</span>}
          {lastRefresh && (
            <span className="mc-refresh-time">
              refreshed {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button className="mc-btn mc-btn--ghost" onClick={load} title="Refresh">↻</button>
        </div>
      </div>

      <AlertBanner warnings={warnings} />

      {actionMsg && (
        <div className={`mc-action-msg mc-action-msg--${actionMsg.ok ? "ok" : "err"}`}>
          {actionMsg.text}
          <button onClick={() => setActionMsg(null)}>✕</button>
        </div>
      )}

      {/* Emergency Actions */}
      <div className="mc-emergency">
        <button
          className="mc-btn mc-btn--danger"
          disabled={stopPending || isEmergencyStopped}
          onClick={handleStop}
        >
          {stopPending ? "Stopping…" : isEmergencyStopped ? "Stopped" : "⛔ Emergency Stop"}
        </button>
        <button
          className="mc-btn mc-btn--resume"
          disabled={resumePending || !isEmergencyStopped}
          onClick={handleResume}
        >
          {resumePending ? "Resuming…" : "▶ Resume Runtime"}
        </button>
        {isEmergencyStopped && (
          <span className="mc-stopped-badge">RUNTIME HALTED</span>
        )}
      </div>

      {/* Main grid */}
      <div className={`mc-grid${loading ? " mc-grid--loading" : ""}`}>

        {/* Revenue */}
        <MetricCard
          icon="₹"
          label="Revenue"
          value={revenue != null ? `₹${Number(revenue).toLocaleString("en-IN")}` : "—"}
          sub={msgToday != null ? `${msgToday} msgs today` : null}
          status="ok"
          onClick={() => nav("payments")}
        />

        {/* Leads */}
        <MetricCard
          icon="👥"
          label="Leads"
          value={leadsCount != null ? leadsCount.toLocaleString() : "—"}
          sub="CRM pipeline"
          status="ok"
          onClick={() => nav("clients")}
        />

        {/* Active Agents */}
        <MetricCard
          icon="🤖"
          label="Active Agents"
          value={activeAgents != null ? `${activeAgents}${totalAgents != null ? ` / ${totalAgents}` : ""}` : "—"}
          sub="running now"
          status={activeAgents === 0 ? "warn" : "ok"}
          onClick={() => nav("agents")}
        />

        {/* Memory Health */}
        <MetricCard
          icon="🧠"
          label="Memory Health"
          value={memNodes != null ? `${memNodes} nodes` : "—"}
          sub={memHealth ? memHealth.toUpperCase() : null}
          status={memHealth === "ok" || memHealth == null ? "ok" : "warn"}
          onClick={() => nav("memory")}
        />

        {/* Workflow Health */}
        <MetricCard
          icon="⚙️"
          label="Workflow Health"
          value={wfRuns != null ? `${wfRuns} runs` : "—"}
          sub={wfActive != null ? `${wfActive} active` : null}
          status={wfActive === 0 && wfRuns === 0 ? "warn" : "ok"}
          onClick={() => nav("autonomouswf")}
        />

        {/* AI Provider Status */}
        <MetricCard
          icon="✦"
          label="AI Providers"
          value={health?.services?.ai ? "Online" : health ? "Offline" : "—"}
          status={health?.services?.ai ? "ok" : health ? "err" : "ok"}
          onClick={() => nav("aicost")}
        >
          {health?.services && (
            <div className="mc-services">
              <ServiceRow label="AI" ok={health.services.ai} />
              <ServiceRow label="Payments" ok={health.services.payments} />
              <ServiceRow label="WhatsApp" ok={health.services.whatsapp} />
              <ServiceRow label="Telegram" ok={health.services.telegram} />
            </div>
          )}
        </MetricCard>

        {/* System Health */}
        <MetricCard
          icon="💾"
          label="System Health"
          value={heap != null ? `${heap} MB heap` : sysStatus !== "unknown" ? sysStatus : "—"}
          sub={queueCts.pending != null ? `${queueCts.pending} pending / ${queueCts.running || 0} running` : null}
          status={sysStatus === "ok" ? "ok" : sysStatus === "degraded" ? "warn" : "err"}
          onClick={() => nav("operations")}
        />

        {/* Autonomy Score */}
        <MetricCard
          icon="⚡"
          label="Autonomy Score"
          value={autoScore != null ? `${autoScore}%` : "—"}
          sub="self-operation index"
          status={autoScore != null ? (autoScore >= 70 ? "ok" : autoScore >= 40 ? "warn" : "err") : "ok"}
          onClick={() => nav("autonomyscore")}
        >
          {autoScore != null && (
            <div className="mc-progress-bar">
              <div className="mc-progress-fill" style={{ width: `${Math.min(autoScore, 100)}%` }} />
            </div>
          )}
        </MetricCard>

        {/* Deployment Status */}
        <MetricCard
          icon="🚀"
          label="Deployment"
          value={billingStatus ? billingStatus.toUpperCase() : "—"}
          sub={billingDays != null ? `${billingDays}d left · ${billingPlan}` : billingPlan}
          status={billingStatus === "active" ? "ok" : billingStatus === "trial" ? "warn" : "err"}
          onClick={() => nav("billing")}
        />

        {/* Growth Metrics */}
        <MetricCard
          icon="📈"
          label="Growth Metrics"
          value={leadsCount != null && revenue != null ? "Live" : "—"}
          sub={leadsCount != null ? `${leadsCount} leads · ₹${Number(revenue || 0).toLocaleString("en-IN")} rev` : null}
          status="ok"
          onClick={() => nav("seo")}
        />

      </div>

      {/* Lifecycle Runtime */}
      <LifecyclePanel />

      {/* Recommendation Confidence */}
      <RecommendationConfidence />

      {/* Recent Activity */}
      <section className="mc-section">
        <div className="mc-section-head">
          <h2>Recent Activity</h2>
          <button className="mc-btn mc-btn--ghost mc-btn--sm" onClick={() => nav("activity")}>
            View all →
          </button>
        </div>
        {history.length > 0 ? (
          <div className="mc-activity-list">
            {history.slice(0, 8).map((item, i) => {
              const ts  = item.completedAt || item.startedAt || item.createdAt;
              const ok  = item.status === "done" || item.status === "completed" || item.status === "success";
              const err = item.status === "failed" || item.status === "error";
              return (
                <div key={i} className="mc-activity-row">
                  <StatusDot ok={ok} warn={!ok && !err} />
                  <span className="mc-activity-text">
                    {(item.input || item.task || item.name || "task").slice(0, 60)}
                  </span>
                  <span className="mc-activity-status">{item.status}</span>
                  {ts && (
                    <span className="mc-activity-time">
                      {new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mc-empty">No recent activity</p>
        )}
      </section>

      {/* Quick Navigation */}
      <section className="mc-section">
        <h2 className="mc-section-head">Quick Navigate</h2>
        <div className="mc-nav-grid">
          {[
            { id: "home",         label: "Control Center", icon: "⌂" },
            { id: "agents",       label: "Agent OS",       icon: "🤖" },
            { id: "memory",       label: "Memory OS",      icon: "🧠" },
            { id: "autonomouswf", label: "Workflow OS",    icon: "⚙️" },
            { id: "copilot",      label: "Dev Copilot",    icon: "💻" },
            { id: "devops",       label: "DevOps",         icon: "🔧" },
            { id: "clients",      label: "CRM",            icon: "👥" },
            { id: "payments",     label: "Payments",       icon: "₹" },
            { id: "seo",          label: "Growth OS",      icon: "📈" },
            { id: "operations",   label: "Operations",     icon: "📊" },
            { id: "aicost",       label: "AI Costs",       icon: "✦" },
            { id: "autonomyscore",label: "Autonomy",       icon: "⚡" },
          ].map(({ id, label, icon }) => (
            <button key={id} className="mc-nav-btn" onClick={() => nav(id)}>
              <span className="mc-nav-icon">{icon}</span>
              <span className="mc-nav-label">{label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
