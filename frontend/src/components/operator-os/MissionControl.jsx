import React, {
  useState, useEffect, useCallback, useRef, memo, useMemo,
} from "react";
import {
  getRuntimeStatus, getRuntimeMetrics, getRuntimeHistory,
  getAgents, getRecommendations, getObserverStatus,
  getDeployHistory, getDeployList, getGraphList, getGraphStats,
  getHealth, getOps, getCoordStatus, getAuditHealth,
  emergencyStop, emergencyResume, recoverQueue, recoverGovernor,
  getCycleStats, getMemoryStats, getActions,
} from "./operatorApi";
import { useIntervalCleanup } from "../../hooks/useResourceManager";
import "./MissionControl.css";

const TICK_MS = 8_000;

// ── Tiny status dot ────────────────────────────────────────────────────
const Dot = memo(({ s }) => (
  <span className={`mc2-dot mc2-dot--${s === "ok" || s === "online" || s === "active" ? "ok" : s === "warn" || s === "degraded" ? "warn" : s === "loading" ? "pulse" : "err"}`} />
));

// ── Section title ──────────────────────────────────────────────────────
const SectionHead = memo(({ label, count, action, onAction }) => (
  <div className="mc2-sec-head">
    <span className="mc2-sec-label">{label}</span>
    {count != null && <span className="mc2-sec-count">{count}</span>}
    {action && <button className="mc2-link" onClick={onAction}>{action}</button>}
  </div>
));

// ── Live clock ─────────────────────────────────────────────────────────
function LiveClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setT(new Date()); }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="mc2-clock">
      {t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

// ── Health bar strip ───────────────────────────────────────────────────
const HealthBar = memo(({ value, max = 100, warn = 60, crit = 85 }) => {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const cls = pct >= crit ? "crit" : pct >= warn ? "warn" : "ok";
  return (
    <div className="mc2-bar">
      <div className={`mc2-bar-fill mc2-bar-fill--${cls}`} style={{ width: `${pct}%` }} />
    </div>
  );
});

// ── Stat tile ──────────────────────────────────────────────────────────
const Tile = memo(({ label, value, sub, dot, onClick }) => (
  <div className={`mc2-tile${onClick ? " mc2-tile--link" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
    <div className="mc2-tile-head">
      {dot !== undefined && <Dot s={dot} />}
      <span className="mc2-tile-label">{label}</span>
    </div>
    <div className="mc2-tile-value">{value ?? <span className="mc2-shimmer" />}</div>
    {sub && <div className="mc2-tile-sub">{sub}</div>}
  </div>
));

// ── Timeline row ───────────────────────────────────────────────────────
const TimelineRow = memo(({ item }) => {
  const ok  = item.status === "done" || item.status === "completed" || item.status === "success";
  const err = item.status === "failed" || item.status === "error";
  const ts  = item.completedAt || item.startedAt || item.createdAt;
  return (
    <div className="mc2-tl-row">
      <Dot s={ok ? "ok" : err ? "err" : "warn"} />
      <span className="mc2-tl-text">{(item.input || item.task || item.name || "task").slice(0, 70)}</span>
      <span className={`mc2-tl-status mc2-tl-status--${ok ? "ok" : err ? "err" : "warn"}`}>{item.status}</span>
      {ts && <span className="mc2-tl-time">{new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
    </div>
  );
});

// ── Agent row ──────────────────────────────────────────────────────────
const AgentRow = memo(({ a }) => {
  const running = a.status === "running" || a.status === "active";
  return (
    <div className="mc2-agent-row">
      <Dot s={running ? "ok" : a.status === "error" ? "err" : "warn"} />
      <span className="mc2-agent-name">{(a.name || a.agentId || a.id || "—").slice(0, 28)}</span>
      <span className="mc2-agent-type">{a.type || a.kind || "—"}</span>
      <span className={`mc2-agent-status mc2-agent-status--${running ? "ok" : "dim"}`}>{a.status || "idle"}</span>
      {a.lastActive && (
        <span className="mc2-agent-time">{new Date(a.lastActive).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      )}
    </div>
  );
});

// ── Recommendation card ────────────────────────────────────────────────
const RecCard = memo(({ rec, onApprove }) => (
  <div className={`mc2-rec mc2-rec--${rec.priority === "critical" ? "crit" : rec.priority === "high" ? "high" : "med"}`}>
    <div className="mc2-rec-title">{rec.title || rec.type || rec.action || "Recommendation"}</div>
    {rec.reason && <div className="mc2-rec-reason">{rec.reason.slice(0, 120)}</div>}
    <div className="mc2-rec-foot">
      <span className="mc2-rec-priority">{rec.priority || "medium"}</span>
      {rec.confidence != null && <span className="mc2-rec-conf">{Math.round(rec.confidence * 100)}% conf</span>}
      {onApprove && (
        <button className="mc2-rec-approve" onClick={() => onApprove(rec)}>Execute →</button>
      )}
    </div>
  </div>
));

// ── Deploy row ─────────────────────────────────────────────────────────
const DeployRow = memo(({ d }) => {
  const ok = d.status === "deployed" || d.status === "success" || d.status === "completed";
  const ts = d.deployedAt || d.createdAt || d.timestamp;
  return (
    <div className="mc2-deploy-row">
      <Dot s={ok ? "ok" : d.status === "failed" ? "err" : "warn"} />
      <span className="mc2-deploy-name">{(d.name || d.id || "deploy").slice(0, 30)}</span>
      <span className={`mc2-deploy-status mc2-deploy-status--${ok ? "ok" : "warn"}`}>{d.status || "—"}</span>
      {ts && <span className="mc2-deploy-time">{new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
    </div>
  );
});

// ── Mission graph row ──────────────────────────────────────────────────
const GraphRow = memo(({ g, onExecute }) => {
  const done = (g.completedNodes || 0);
  const total = (g.totalNodes || g.nodes?.length || 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mc2-graph-row">
      <div className="mc2-graph-info">
        <span className="mc2-graph-name">{(g.mission || g.name || g.id || "mission").slice(0, 40)}</span>
        <span className={`mc2-graph-status mc2-graph-status--${g.status === "completed" ? "ok" : g.status === "failed" ? "err" : "run"}`}>{g.status || "pending"}</span>
      </div>
      {total > 0 && (
        <div className="mc2-graph-progress">
          <div className="mc2-graph-bar">
            <div className="mc2-graph-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="mc2-graph-pct">{done}/{total}</span>
        </div>
      )}
      {g.status !== "completed" && g.status !== "failed" && (
        <button className="mc2-link mc2-link--sm" onClick={() => onExecute(g.id)}>run →</button>
      )}
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════
// Main MissionControl component
// ══════════════════════════════════════════════════════════════════════
export default function MissionControl({ onNavigate }) {
  const nav = useCallback((id) => onNavigate?.(id), [onNavigate]);

  // ── State buckets ────────────────────────────────────────────────
  const [runtime,   setRuntime]   = useState(null);
  const [metrics,   setMetrics]   = useState(null);
  const [history,   setHistory]   = useState([]);
  const [agents,    setAgents]    = useState([]);
  const [recs,      setRecs]      = useState([]);
  const [deploys,   setDeploys]   = useState([]);
  const [graphs,    setGraphs]    = useState([]);
  const [health,    setHealth]    = useState(null);
  const [ops,       setOps]       = useState(null);
  const [coordSt,   setCoordSt]   = useState(null);
  const [memStat,   setMemStat]   = useState(null);
  const [cycles,    setCycles]    = useState(null);
  const [actions,   setActions]   = useState([]);

  const [loading,    setLoading]    = useState(true);
  const [lastTick,   setLastTick]   = useState(null);
  const [actionMsg,  setActionMsg]  = useState(null);
  const [stopPend,   setStopPend]   = useState(false);
  const [resPend,    setResPend]    = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);

  // ── Parallel fetch ────────────────────────────────────────────────
  const fetch_ = useCallback(async () => {
    const [rt, met, hist, ag, rc, dep, gr, hl, op, cs, ms, cy, ac] =
      await Promise.allSettled([
        getRuntimeStatus(),
        getRuntimeMetrics(),
        getRuntimeHistory(12),
        getAgents(),
        getRecommendations(),
        getDeployHistory(),
        getGraphList(),
        getHealth(),
        getOps(),
        getCoordStatus(),
        getMemoryStats(),
        getCycleStats(),
        getActions(),
      ]);

    if (rt.status  === "fulfilled") setRuntime(rt.value);
    if (met.status === "fulfilled") setMetrics(met.value);
    if (hist.status === "fulfilled") setHistory(hist.value?.history || hist.value || []);
    if (ag.status  === "fulfilled") setAgents(ag.value?.agents || ag.value || []);
    if (rc.status  === "fulfilled") setRecs(rc.value?.recommendations || rc.value || []);
    if (dep.status === "fulfilled") setDeploys(dep.value?.deployments || dep.value || []);
    if (gr.status  === "fulfilled") setGraphs(gr.value?.graphs || gr.value || []);
    if (hl.status  === "fulfilled") setHealth(hl.value);
    if (op.status  === "fulfilled") setOps(op.value);
    if (cs.status  === "fulfilled") setCoordSt(cs.value);
    if (ms.status  === "fulfilled") setMemStat(ms.value);
    if (cy.status  === "fulfilled") setCycles(cy.value);
    if (ac.status  === "fulfilled") setActions(ac.value?.actions || ac.value || []);

    setLoading(false);
    setLastTick(new Date());
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  useIntervalCleanup(fetch_, TICK_MS);

  // ── Derived ───────────────────────────────────────────────────────
  const sysStatus = ops?.status || health?.status || runtime?.status || "unknown";
  const isHalted  = runtime?.emergency_stop || runtime?.stopped;
  const heap      = ops?.memory?.current?.heap_mb || metrics?.memory_mb;
  const qPending  = ops?.queue?.counts?.pending ?? metrics?.queue_pending ?? 0;
  const qRunning  = ops?.queue?.counts?.running ?? metrics?.queue_active  ?? 0;
  const uptime    = ops?.uptime?.human || (health?.uptime_seconds ? `${Math.floor(health.uptime_seconds / 3600)}h ${Math.floor((health.uptime_seconds % 3600) / 60)}m` : null);
  const warnings  = ops?.warnings || health?.warnings || [];

  const runningAgents = useMemo(() => agents.filter(a => a.status === "running" || a.status === "active"), [agents]);
  const pendingActions = useMemo(() => actions.filter(a => a.status === "pending"), [actions]);
  const activeGraphs  = useMemo(() => graphs.filter(g => g.status === "running" || g.status === "pending"), [graphs]);
  const critRecs      = useMemo(() => recs.filter(r => r.priority === "critical" || r.priority === "high").slice(0, 4), [recs]);

  const memNodes  = memStat?.total_nodes ?? memStat?.nodes ?? null;
  const wfRuns    = cycles?.total_runs ?? cycles?.runs ?? null;

  // ── Actions ───────────────────────────────────────────────────────
  async function doStop() {
    setStopConfirm(true);
  }

  async function doStopConfirmed() {
    setStopConfirm(false);
    setStopPend(true);
    try {
      await emergencyStop();
      setActionMsg({ ok: true, text: "Emergency stop issued." });
      fetch_();
    } catch (e) {
      setActionMsg({ ok: false, text: "Stop failed: " + e.message });
    } finally { setStopPend(false); }
  }

  async function doResume() {
    setResPend(true);
    try {
      await emergencyResume();
      setActionMsg({ ok: true, text: "Runtime resumed." });
      fetch_();
    } catch (e) {
      setActionMsg({ ok: false, text: "Resume failed: " + e.message });
    } finally { setResPend(false); }
  }

  async function doRecovery() {
    try {
      await Promise.allSettled([recoverQueue(), recoverGovernor()]);
      setActionMsg({ ok: true, text: "Recovery procedures triggered." });
      fetch_();
    } catch (e) {
      setActionMsg({ ok: false, text: "Recovery failed: " + e.message });
    }
  }

  async function executeGraph(id) {
    try {
      const { executeGraph: execFn } = await import("./operatorApi");
      await execFn(id);
      setActionMsg({ ok: true, text: `Graph ${id} execution triggered.` });
      fetch_();
    } catch (e) {
      setActionMsg({ ok: false, text: "Execute failed: " + e.message });
    }
  }

  async function approveRec(rec) {
    try {
      const { triggerObserver } = await import("./operatorApi");
      await triggerObserver(rec.type || "recommendation");
      setActionMsg({ ok: true, text: `Triggered: ${rec.title || rec.type}` });
      fetch_();
    } catch (e) {
      setActionMsg({ ok: false, text: "Approval failed: " + e.message });
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="mc2-root">

      {/* ── Emergency stop confirmation modal ── */}
      {stopConfirm && (
        <div className="mc2-stop-overlay" onClick={() => setStopConfirm(false)}>
          <div className="mc2-stop-panel" onClick={e => e.stopPropagation()}>
            <div className="mc2-stop-icon">⛔</div>
            <div className="mc2-stop-title">Emergency Stop</div>
            <div className="mc2-stop-body">Halt all in-flight and queued agents immediately. Active missions will be paused.</div>
            <div className="mc2-stop-actions">
              <button className="mc2-stop-btn mc2-stop-btn--cancel" onClick={() => setStopConfirm(false)}>Cancel</button>
              <button className="mc2-stop-btn mc2-stop-btn--confirm" onClick={doStopConfirmed}>Stop All Agents</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <header className="mc2-header">
        <div className="mc2-header-brand">
          <span className="mc2-logo">⬡</span>
          <div>
            <div className="mc2-title">OPERATOR OS</div>
            <div className="mc2-subtitle">Autonomous Engineering Control</div>
          </div>
        </div>
        <div className="mc2-header-status">
          <Dot s={isHalted ? "err" : sysStatus} />
          <span className="mc2-sys-label">{isHalted ? "HALTED" : sysStatus.toUpperCase()}</span>
          {uptime && <span className="mc2-uptime">↑ {uptime}</span>}
          <LiveClock />
          {lastTick && <span className="mc2-tick">synced {lastTick.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          <button className="mc2-icon-btn" onClick={fetch_} title="Refresh">↻</button>
        </div>
        <div className="mc2-header-actions">
          <button className="mc2-btn mc2-btn--danger" onClick={doStop}
            disabled={stopPend || isHalted}>
            {stopPend ? "…" : "⛔ Stop"}
          </button>
          <button className="mc2-btn mc2-btn--resume" onClick={doResume}
            disabled={resPend || !isHalted}>
            {resPend ? "…" : "▶ Resume"}
          </button>
          <button className="mc2-btn mc2-btn--ghost" onClick={doRecovery} title="Trigger queue + governor recovery">
            ⟳ Recover
          </button>
        </div>
      </header>

      {/* ── Warning banners ── */}
      {isHalted && (
        <div className="mc2-banner mc2-banner--halt">
          ⛔ RUNTIME HALTED — All agents paused. Resume when ready.
        </div>
      )}
      {warnings.slice(0, 2).map((w, i) => (
        <div key={i} className="mc2-banner mc2-banner--warn">
          [{w.code}] {w.detail}
        </div>
      ))}
      {actionMsg && (
        <div className={`mc2-banner mc2-banner--${actionMsg.ok ? "ok" : "err"}`}>
          {actionMsg.text}
          <button className="mc2-banner-close" onClick={() => setActionMsg(null)}>✕</button>
        </div>
      )}

      {/* ── Metric strip ── */}
      <div className="mc2-metric-strip">
        <Tile label="System"  value={sysStatus.toUpperCase()} dot={sysStatus} onClick={() => nav("operations")} />
        <Tile label="Agents"  value={runningAgents.length > 0 ? `${runningAgents.length} / ${agents.length}` : agents.length || "—"}
          sub="active / total" dot={runningAgents.length > 0 ? "ok" : "warn"} onClick={() => nav("agents")} />
        <Tile label="Queue"   value={`${qRunning} / ${qPending}`} sub="running / pending"
          dot={qPending > 20 ? "warn" : "ok"} />
        <Tile label="Heap"    value={heap != null ? `${heap} MB` : "—"} sub="main process"
          dot={heap > 400 ? "crit" : heap > 250 ? "warn" : "ok"} />
        <Tile label="Memory"  value={memNodes != null ? `${memNodes} nodes` : "—"} sub="knowledge graph"
          dot="ok" onClick={() => nav("memory")} />
        <Tile label="Cycles"  value={wfRuns != null ? wfRuns : "—"} sub="total runs"
          dot="ok" />
        <Tile label="Missions" value={activeGraphs.length > 0 ? `${activeGraphs.length} active` : graphs.length || "—"}
          sub="task graphs" dot={activeGraphs.length > 0 ? "ok" : "warn"} onClick={() => nav("mission")} />
        <Tile label="Approvals" value={pendingActions.length || 0} sub="pending"
          dot={pendingActions.length > 0 ? "warn" : "ok"} />
      </div>

      {/* ── First-run guide: shown when system is empty ── */}
      {!loading && graphs.length === 0 && agents.length === 0 && history.length === 0 && (
        <div className="mc2-welcome">
          <div className="mc2-welcome-title">Welcome to Ooplix</div>
          <div className="mc2-welcome-steps">
            <div className="mc2-welcome-step">
              <span className="mc2-welcome-num">1</span>
              <div>
                <strong>Open a project</strong> — Press <kbd>⌘⇧E</kbd> or click 📁 in the sidebar to browse files. Click <strong>Open Folder…</strong> to select your project.
              </div>
            </div>
            <div className="mc2-welcome-step">
              <span className="mc2-welcome-num">2</span>
              <div>
                <strong>Create a mission</strong> — Click <button className="mc2-welcome-inline-btn" onClick={() => nav("missions")}>Missions ↗</button> in the bottom panel, then describe a goal (e.g. "Add JWT authentication").
              </div>
            </div>
            <div className="mc2-welcome-step">
              <span className="mc2-welcome-num">3</span>
              <div>
                <strong>Use AI on your code</strong> — Open any file, right-click selected code → <em>Explain code</em> or <em>Generate patch</em>. AI Pair opens automatically.
              </div>
            </div>
            <div className="mc2-welcome-step">
              <span className="mc2-welcome-num">4</span>
              <div>
                <strong>Explore shortcuts</strong> — Press <kbd>⌘K</kbd> to search everything, <kbd>⌘P</kbd> to switch projects, <kbd>?</kbd> for full shortcut list.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main 3-column grid ── */}
      <div className="mc2-grid">

        {/* ── LEFT: Agents + Approvals ── */}
        <section className="mc2-col">

          <SectionHead label="Running Agents" count={runningAgents.length} action="All →" onAction={() => nav("agents")} />
          <div className="mc2-agent-list">
            {loading && <div className="mc2-placeholder">Loading…</div>}
            {!loading && runningAgents.length === 0 && (
              <div className="mc2-empty">No agents currently running.</div>
            )}
            {runningAgents.slice(0, 8).map((a, i) => <AgentRow key={a.id || i} a={a} />)}
          </div>

          <SectionHead label="Pending Approvals" count={pendingActions.length} />
          <div className="mc2-approval-list">
            {pendingActions.length === 0 && <div className="mc2-empty">No pending approvals.</div>}
            {pendingActions.slice(0, 5).map((a, i) => (
              <div key={a.id || i} className="mc2-approval-row">
                <Dot s="warn" />
                <span className="mc2-approval-text">{(a.action || a.type || a.task || "action").slice(0, 50)}</span>
                <span className="mc2-approval-time">{a.createdAt ? new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
              </div>
            ))}
          </div>

          <SectionHead label="Active Incidents" count={warnings.length} />
          <div className="mc2-incident-list">
            {warnings.length === 0 && <div className="mc2-empty">No active incidents.</div>}
            {warnings.slice(0, 4).map((w, i) => (
              <div key={i} className={`mc2-incident mc2-incident--${w.level || "warn"}`}>
                <span className="mc2-incident-code">{w.code}</span>
                <span className="mc2-incident-detail">{w.detail}</span>
              </div>
            ))}
          </div>

        </section>

        {/* ── CENTER: Timeline + Recommendations ── */}
        <section className="mc2-col mc2-col--center">

          <SectionHead label="System Timeline" count={history.length} action="Full log →" onAction={() => nav("activity")} />
          <div className="mc2-timeline">
            {loading && <div className="mc2-placeholder">Loading…</div>}
            {!loading && history.length === 0 && <div className="mc2-empty">No recent activity.</div>}
            {history.slice(0, 12).map((item, i) => <TimelineRow key={i} item={item} />)}
          </div>

          <SectionHead label="AI Recommendations" count={critRecs.length} action="All →" onAction={() => nav("recommendation")} />
          <div className="mc2-rec-list">
            {critRecs.length === 0 && <div className="mc2-empty">No high-priority recommendations.</div>}
            {critRecs.map((r, i) => <RecCard key={i} rec={r} onApprove={approveRec} />)}
          </div>

        </section>

        {/* ── RIGHT: Deployments + Missions + Runtime Health ── */}
        <section className="mc2-col">

          <SectionHead label="Deployments" count={deploys.length} action="History →" onAction={() => nav("devops")} />
          <div className="mc2-deploy-list">
            {loading && <div className="mc2-placeholder">Loading…</div>}
            {!loading && deploys.length === 0 && <div className="mc2-empty">No deployments recorded.</div>}
            {deploys.slice(0, 6).map((d, i) => <DeployRow key={d.id || i} d={d} />)}
          </div>

          <SectionHead label="Active Missions" count={activeGraphs.length} action="New →" onAction={() => nav("missions")} />
          <div className="mc2-graph-list">
            {activeGraphs.length === 0 && <div className="mc2-empty">No missions in progress.</div>}
            {activeGraphs.slice(0, 4).map((g, i) => (
              <GraphRow key={g.id || i} g={g} onExecute={executeGraph} />
            ))}
          </div>

          <SectionHead label="Runtime Health" />
          <div className="mc2-health-panel">
            <div className="mc2-health-row">
              <span>Coordinator</span>
              <Dot s={coordSt?.status === "active" ? "ok" : "warn"} />
              <span className="mc2-health-val">{coordSt?.status || "—"}</span>
            </div>
            <div className="mc2-health-row">
              <span>Queue</span>
              <Dot s={qPending < 50 ? "ok" : "warn"} />
              <span className="mc2-health-val">{qRunning} running / {qPending} pending</span>
            </div>
            {heap != null && (
              <div className="mc2-health-row">
                <span>Heap</span>
                <Dot s={heap < 250 ? "ok" : heap < 400 ? "warn" : "err"} />
                <HealthBar value={heap} max={600} warn={250} crit={400} />
                <span className="mc2-health-val">{heap} MB</span>
              </div>
            )}
            <div className="mc2-health-row">
              <span>AI Provider</span>
              <Dot s={health?.services?.ai ? "ok" : "err"} />
              <span className="mc2-health-val">{health?.services?.ai ? "online" : "offline"}</span>
            </div>
            <div className="mc2-health-row">
              <span>DB</span>
              <Dot s={health?.services?.db !== false ? "ok" : "err"} />
              <span className="mc2-health-val">{health?.services?.db !== false ? "online" : "offline"}</span>
            </div>
          </div>

          <SectionHead label="Quick Nav" />
          <div className="mc2-quicknav">
            {[
              { id: "missions",      label: "Missions",     icon: "◎" },
              { id: "agents",        label: "Agents",       icon: "⬡" },
              { id: "copilot",       label: "Dev Copilot",  icon: "◈" },
              { id: "devops",        label: "DevOps",       icon: "⬟" },
              { id: "memory",        label: "Memory",       icon: "◉" },
              { id: "operations",    label: "Operations",   icon: "▣" },
              { id: "activity",      label: "Timeline",     icon: "≡" },
              { id: "recommendation",label: "AI Intel",     icon: "✦" },
            ].map(({ id, label, icon }) => (
              <button key={id} className="mc2-nav-btn" onClick={() => nav(id)}>
                <span className="mc2-nav-icon">{icon}</span>
                <span className="mc2-nav-label">{label}</span>
              </button>
            ))}
          </div>

        </section>
      </div>
    </div>
  );
}
