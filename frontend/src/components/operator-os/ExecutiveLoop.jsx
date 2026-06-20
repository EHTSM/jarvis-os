import React, {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from "react";
import {
  getObserverStatus, triggerObserver, getRecommendations,
  getRuntimeStatus, getHealth, getOps, getAuditHealth,
  getCycleStats, getActions, getAgents, getGraphList,
  getMemoryStats, calcRisk, getAutonomyScore,
  emergencyStop, emergencyResume, recoverQueue, recoverGovernor,
} from "./operatorApi";
import { useIntervalCleanup } from "../../hooks/useResourceManager";
import { useConfirm } from "../ConfirmDialog";
import "./ExecutiveLoop.css";

const TICK_MS = 10_000;

// ── Phase definitions ──────────────────────────────────────────────────
const PHASES = [
  { id: "observe",    label: "Observe",    icon: "◎", color: "blue"   },
  { id: "analyze",    label: "Analyze",    icon: "◈", color: "purple" },
  { id: "recommend",  label: "Recommend",  icon: "✦", color: "yellow" },
  { id: "execute",    label: "Execute",    icon: "▶", color: "green"  },
  { id: "verify",     label: "Verify",     icon: "◉", color: "teal"   },
  { id: "heal",       label: "Heal",       icon: "⬡", color: "orange" },
  { id: "learn",      label: "Learn",      icon: "◷", color: "pink"   },
  { id: "report",     label: "Report",     icon: "▣", color: "gray"   },
];

// ── Helpers ────────────────────────────────────────────────────────────
function ts(t) {
  if (!t) return "—";
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const PhaseDot = memo(({ phase, active, done, err }) => {
  const cfg = PHASES.find(p => p.id === phase) || PHASES[0];
  return (
    <div className={`el-phase-dot el-phase-dot--${cfg.color}${active ? " el-phase-dot--active" : ""}${done ? " el-phase-dot--done" : ""}${err ? " el-phase-dot--err" : ""}`}
      title={cfg.label}>
      <span className="el-phase-icon">{cfg.icon}</span>
      <span className="el-phase-label">{cfg.label}</span>
    </div>
  );
});

const EventRow = memo(({ ev }) => {
  const ok  = ev.status === "ok" || ev.status === "success" || ev.status === "done";
  const err = ev.status === "error" || ev.status === "failed";
  return (
    <div className={`el-event el-event--${ok ? "ok" : err ? "err" : "dim"}`}>
      <span className="el-event-phase">{ev.phase || "—"}</span>
      <span className="el-event-text">{(ev.summary || ev.action || ev.message || ev.text || "—").slice(0, 100)}</span>
      <span className="el-event-status">{ev.status || "—"}</span>
      {ev.ts && <span className="el-event-time">{ts(ev.ts)}</span>}
    </div>
  );
});

const RecCard = memo(({ rec, onExecute }) => (
  <div className={`el-rec el-rec--${rec.priority === "critical" ? "crit" : rec.priority === "high" ? "high" : "med"}`}>
    <div className="el-rec-title">{rec.title || rec.type || "Recommendation"}</div>
    {rec.reason && <div className="el-rec-reason">{rec.reason.slice(0, 100)}</div>}
    <div className="el-rec-foot">
      <span className="el-rec-pri">{rec.priority || "medium"}</span>
      {rec.confidence != null && <span className="el-rec-conf">{Math.round(rec.confidence * 100)}%</span>}
      {onExecute && (
        <button className="el-rec-btn" onClick={() => onExecute(rec)}>Execute →</button>
      )}
    </div>
  </div>
));

// ══════════════════════════════════════════════════════════════════════
// Main ExecutiveLoop
// ══════════════════════════════════════════════════════════════════════
export default function ExecutiveLoop() {
  const [observer,  setObserver]  = useState(null);
  const [recs,      setRecs]      = useState([]);
  const [runtime,   setRuntime]   = useState(null);
  const [ops,       setOps]       = useState(null);
  const [health,    setHealth]    = useState(null);
  const [audit,     setAudit]     = useState(null);
  const [cycles,    setCycles]    = useState(null);
  const [actions,   setActions]   = useState([]);
  const [agents,    setAgents]    = useState([]);
  const [confirm, ConfirmUI] = useConfirm();
  const [graphs,    setGraphs]    = useState([]);
  const [memStat,   setMemStat]   = useState(null);
  const [autonomy,  setAutonomy]  = useState(null);
  const [riskData,  setRiskData]  = useState(null);

  const [eventLog,  setEventLog]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [lastCycle, setLastCycle] = useState(null);
  const [currentPhase, setCurrentPhase] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  const loopRef = useRef(null);

  // ── Single comprehensive fetch ────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      getObserverStatus(),
      getRecommendations(),
      getRuntimeStatus(),
      getOps(),
      getHealth(),
      getAuditHealth(),
      getCycleStats(),
      getActions(),
      getAgents(),
      getGraphList(),
      getMemoryStats(),
      getAutonomyScore(),
    ]);

    const [ob, rc, rt, op, hl, au, cy, ac, ag, gr, ms, as] = results;
    if (ob.status === "fulfilled") setObserver(ob.value);
    if (rc.status === "fulfilled") setRecs(rc.value?.recommendations || rc.value || []);
    if (rt.status === "fulfilled") setRuntime(rt.value);
    if (op.status === "fulfilled") setOps(op.value);
    if (hl.status === "fulfilled") setHealth(hl.value);
    if (au.status === "fulfilled") setAudit(au.value);
    if (cy.status === "fulfilled") setCycles(cy.value);
    if (ac.status === "fulfilled") setActions(ac.value?.actions || ac.value || []);
    if (ag.status === "fulfilled") setAgents(ag.value?.agents || ag.value || []);
    if (gr.status === "fulfilled") setGraphs(gr.value?.graphs || gr.value || []);
    if (ms.status === "fulfilled") setMemStat(ms.value);
    if (as.status === "fulfilled") setAutonomy(as.value);

    setLoading(false);
    setLastCycle(new Date());
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useIntervalCleanup(fetchAll, TICK_MS);

  // ── Derive cycle state ────────────────────────────────────────────
  const runningAgents   = useMemo(() => agents.filter(a => a.status === "running" || a.status === "active"), [agents]);
  const activeMissions  = useMemo(() => graphs.filter(g => g.status === "running" || g.status === "pending"), [graphs]);
  const pendingActions  = useMemo(() => actions.filter(a => a.status === "pending"), [actions]);
  const critRecs        = useMemo(() => recs.filter(r => r.priority === "critical" || r.priority === "high"), [recs]);
  const warnings        = ops?.warnings || health?.warnings || [];
  const sysStatus       = ops?.status || health?.status || runtime?.status || "unknown";
  const isHalted        = runtime?.emergency_stop || runtime?.stopped;
  const autonomyScore   = autonomy?.score ?? autonomy?.autonomy_score ?? null;
  const memNodes        = memStat?.total_nodes ?? memStat?.nodes ?? null;

  // ── Determine current loop phase from system state ────────────────
  useEffect(() => {
    if (loading) return;
    let phase = "observe";
    if (critRecs.length > 0)         phase = "recommend";
    if (runningAgents.length > 0)    phase = "execute";
    if (warnings.length > 0)         phase = "heal";
    if (pendingActions.length > 0)   phase = "verify";
    setCurrentPhase(phase);

    // Add cycle event
    setEventLog(prev => [...prev.slice(-49), {
      phase,
      summary: `Cycle: ${runningAgents.length} agents · ${critRecs.length} recs · ${warnings.length} incidents`,
      status: sysStatus,
      ts: Date.now(),
    }]);
  }, [loading, critRecs.length, runningAgents.length, warnings.length, pendingActions.length, sysStatus]); // eslint-disable-line

  // ── Actions ───────────────────────────────────────────────────────
  async function runObserver() {
    try {
      await triggerObserver("full");
      setActionMsg({ ok: true, text: "Full observer cycle triggered." });
      fetchAll();
    } catch (e) { setActionMsg({ ok: false, text: e.message }); }
  }

  async function doHeal() {
    try {
      await Promise.allSettled([recoverQueue(), recoverGovernor()]);
      setActionMsg({ ok: true, text: "Heal procedures triggered." });
      fetchAll();
    } catch (e) { setActionMsg({ ok: false, text: e.message }); }
  }

  async function execRec(rec) {
    try {
      await triggerObserver(rec.type || "recommendation");
      setActionMsg({ ok: true, text: `Executed: ${rec.title || rec.type}` });
      fetchAll();
    } catch (e) { setActionMsg({ ok: false, text: e.message }); }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="el-root">
      {ConfirmUI}
      {/* Header */}
      <header className="el-header">
        <div className="el-header-left">
          <span className="el-title">Autonomous Executive Loop</span>
          <span className="el-subtitle">
            {lastCycle ? `Last cycle ${lastCycle.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Initializing…"}
          </span>
        </div>
        <div className="el-header-status">
          <span className={`el-sys-status el-sys-status--${isHalted ? "halt" : sysStatus}`}>
            {isHalted ? "HALTED" : sysStatus.toUpperCase()}
          </span>
          {autonomyScore != null && (
            <span className="el-autonomy">Autonomy {Math.round(autonomyScore * 100)}%</span>
          )}
        </div>
        <div className="el-header-actions">
          <button className="el-btn el-btn--trigger" onClick={runObserver}>⟳ Observe</button>
          <button className="el-btn el-btn--heal"    onClick={doHeal}>⬡ Heal</button>
          {isHalted
            ? <button className="el-btn el-btn--resume" onClick={async () => { await emergencyResume(); fetchAll(); }}>▶ Resume</button>
            : <button className="el-btn el-btn--stop"   onClick={async () => { if(await confirm({ title: 'Emergency Stop?', message: 'All running tasks will be halted immediately.', danger: true, confirmLabel: 'Stop Everything' })) { await emergencyStop(); fetchAll(); } }}>⛔ Stop</button>
          }
          <button className="el-btn el-btn--ghost" onClick={fetchAll}>↻</button>
        </div>
      </header>

      {actionMsg && (
        <div className={`el-banner el-banner--${actionMsg.ok ? "ok" : "err"}`}>
          {actionMsg.text}
          <button className="el-banner-close" onClick={() => setActionMsg(null)}>✕</button>
        </div>
      )}

      {/* Phase cycle diagram */}
      <div className="el-phases">
        {PHASES.map((p, i) => (
          <React.Fragment key={p.id}>
            <PhaseDot
              phase={p.id}
              active={currentPhase === p.id}
              done={false}
              err={p.id === "heal" && warnings.length > 0}
            />
            {i < PHASES.length - 1 && (
              <div className={`el-phase-arrow${currentPhase === p.id ? " el-phase-arrow--active" : ""}`}>→</div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Metric strip */}
      <div className="el-metrics">
        <div className="el-metric">
          <span className="el-metric-label">Agents</span>
          <span className="el-metric-val">{runningAgents.length}<span className="el-metric-sub">/{agents.length}</span></span>
        </div>
        <div className="el-metric">
          <span className="el-metric-label">Missions</span>
          <span className="el-metric-val">{activeMissions.length}<span className="el-metric-sub">/{graphs.length}</span></span>
        </div>
        <div className="el-metric">
          <span className="el-metric-label">Recs</span>
          <span className={`el-metric-val${critRecs.length > 0 ? " el-metric-val--warn" : ""}`}>{critRecs.length}</span>
        </div>
        <div className="el-metric">
          <span className="el-metric-label">Incidents</span>
          <span className={`el-metric-val${warnings.length > 0 ? " el-metric-val--err" : ""}`}>{warnings.length}</span>
        </div>
        <div className="el-metric">
          <span className="el-metric-label">Approvals</span>
          <span className={`el-metric-val${pendingActions.length > 0 ? " el-metric-val--warn" : ""}`}>{pendingActions.length}</span>
        </div>
        <div className="el-metric">
          <span className="el-metric-label">Memory</span>
          <span className="el-metric-val">{memNodes ?? "—"}</span>
        </div>
        {cycles?.total_runs != null && (
          <div className="el-metric">
            <span className="el-metric-label">Cycles</span>
            <span className="el-metric-val">{cycles.total_runs}</span>
          </div>
        )}
      </div>

      {/* 2-column body */}
      <div className="el-body">

        {/* Left: cycle event log */}
        <div className="el-col el-col--log">
          <div className="el-col-head">Cycle Event Log</div>
          <div className="el-event-list">
            {eventLog.length === 0 && <div className="el-empty">Waiting for first cycle…</div>}
            {[...eventLog].reverse().map((ev, i) => <EventRow key={i} ev={ev} />)}
          </div>

          {/* Audit */}
          {audit && (
            <div className="el-audit">
              <div className="el-col-head">Audit Health</div>
              <div className="el-audit-row">
                <span>Score</span>
                <span className="el-audit-val">{audit.score ?? "—"}</span>
              </div>
              {audit.issues?.slice(0, 3).map((iss, i) => (
                <div key={i} className="el-audit-issue">{(iss.message || iss.issue || iss).slice(0, 80)}</div>
              ))}
            </div>
          )}
        </div>

        {/* Right: recommendations + incidents */}
        <div className="el-col el-col--recs">
          <div className="el-col-head">
            AI Recommendations
            {critRecs.length > 0 && <span className="el-col-count">{critRecs.length}</span>}
          </div>
          {critRecs.length === 0 && <div className="el-empty">No high-priority recommendations.</div>}
          {critRecs.slice(0, 5).map((r, i) => (
            <RecCard key={i} rec={r} onExecute={execRec} />
          ))}

          {warnings.length > 0 && (
            <>
              <div className="el-col-head el-col-head--warn">
                Active Incidents
                <span className="el-col-count el-col-count--err">{warnings.length}</span>
              </div>
              {warnings.slice(0, 4).map((w, i) => (
                <div key={i} className="el-incident">
                  <span className="el-incident-code">{w.code}</span>
                  <span className="el-incident-detail">{(w.detail || w.message || "—").slice(0, 100)}</span>
                </div>
              ))}
            </>
          )}

          {pendingActions.length > 0 && (
            <>
              <div className="el-col-head el-col-head--warn">
                Pending Approvals
                <span className="el-col-count el-col-count--warn">{pendingActions.length}</span>
              </div>
              {pendingActions.slice(0, 4).map((a, i) => (
                <div key={i} className="el-approval">
                  <span className="el-approval-text">{(a.action || a.type || a.task || "—").slice(0, 60)}</span>
                  <span className="el-approval-time">{ts(a.createdAt)}</span>
                </div>
              ))}
            </>
          )}

          {/* What happened / what will happen summary */}
          <div className="el-summary">
            <div className="el-col-head">Loop Summary</div>
            <div className="el-summary-row">
              <span>What happened</span>
              <span>{runningAgents.length} agents ran · {activeMissions.length} missions active</span>
            </div>
            <div className="el-summary-row">
              <span>Why</span>
              <span>{critRecs.length > 0 ? `${critRecs.length} high-priority recommendations` : "Routine cycle"}</span>
            </div>
            <div className="el-summary-row">
              <span>What's next</span>
              <span>{
                isHalted ? "Resume runtime to continue" :
                critRecs.length > 0 ? "Execute AI recommendations" :
                warnings.length > 0 ? "Heal detected incidents" :
                "Continuous observe cycle"
              }</span>
            </div>
            {autonomyScore != null && (
              <div className="el-summary-row">
                <span>Autonomy</span>
                <span className="el-summary-autonomy">{Math.round(autonomyScore * 100)}% self-directing</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
