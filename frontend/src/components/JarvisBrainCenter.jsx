import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { cycleStats } from "../phase18Api";
import { getAutonomyStatus } from "../phase20Api";
import { getMissions, getMissionStats, getPlanningHorizons, getAiProviders } from "../phase27Api";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";
import ContextSidebar from "./ContextSidebar";
import JourneyBanner from "./JourneyBanner";
import "./JarvisBrainCenter.css";

const FLOW_NODES = [
  { icon: "🎯", label: "Goal",        key: "goal"       },
  { icon: "🗺️", label: "Planning",    key: "planning"   },
  { icon: "🧠", label: "Memory",      key: "memory"     },
  { icon: "🤖", label: "Agents",      key: "agents"     },
  { icon: "🔧", label: "Tools",       key: "tools"      },
  { icon: "⚡", label: "Execution",   key: "execution"  },
  { icon: "📚", label: "Learning",    key: "learning"   },
  { icon: "🚀", label: "Improvement", key: "improvement"},
];

const STATUS_COLORS = { active: "#22c55e", running: "#22c55e", planning: "#3b82f6", queued: "#64748b", complete: "#94a3b8", failed: "#ef4444" };

const TABS = ["missions", "planning", "providers", "reasoning"];

export default function JarvisBrainCenter({ onNavigate }) {
  const [activeNode,  setActiveNode]  = useState("execution");
  const [tick,        setTick]        = useState(0);
  const [liveStats,   setLiveStats]   = useState(null);
  const [tab,         setTab]         = useState("missions");

  // Live data
  const [missions,    setMissions]    = useState([]);
  const [missionStats,setMissionStats]= useState(null);
  const [horizons,    setHorizons]    = useState([]);
  const [providers,   setProviders]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  // Brain flow animation
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 2800);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setActiveNode(FLOW_NODES[tick % FLOW_NODES.length].key);
  }, [tick]);

  // Base stats
  useEffect(() => {
    let cancelled = false;
    Promise.all([cycleStats(), getAutonomyStatus()])
      .then(([s, st]) => { if (!cancelled) setLiveStats({ ...s, ...st }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Live mission + planning + provider data
  const refresh = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      getMissions(),
      getMissionStats(),
      getPlanningHorizons(),
      getAiProviders(),
    ]).then(([mRes, msRes, hRes, pRes]) => {
      if (mRes.status === "fulfilled") {
        const raw = mRes.value;
        setMissions(Array.isArray(raw) ? raw : (raw?.missions ?? raw?.data ?? []));
      }
      if (msRes.status === "fulfilled") setMissionStats(msRes.value);
      if (hRes.status === "fulfilled") {
        const raw = hRes.value;
        setHorizons(Array.isArray(raw) ? raw : (raw?.horizons ?? []));
      }
      if (pRes.status === "fulfilled") {
        const raw = pRes.value;
        setProviders(Array.isArray(raw) ? raw : (raw?.providers ?? []));
      }
      const anyFailed = [mRes, msRes, hRes, pRes].some(r => r.status === "rejected");
      if (anyFailed && missions.length === 0) setError("Some live data unavailable");
      setLoading(false);
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const totalRuns   = liveStats?.totalCycles ?? liveStats?.totalRuns ?? 0;
  const activeMissions = missions.filter(m => m.status === "active" || m.status === "running").length;
  const loopCycles  = liveStats?.totalCycles ?? (missionStats?.total ?? 0);

  return (
    <div style={{ display: "flex", height: "100%" }}>
    <div className="jbc" style={{ flex: 1, minWidth: 0 }}>
      <JourneyBanner currentTab="jarvisbrain" onNavigate={onNavigate} />
      <PageHeader
        icon="🧠"
        title="Jarvis Brain Center"
        subtitle="Live missions, planning horizons, AI provider routing, and execution loops"
        related={[
          { label: "Execution", tab: "execution", icon: "⚡" },
          { label: "Memory", tab: "memory", icon: "◎" },
          { label: "Intelligence", tab: "intel", icon: "◈" },
          { label: "Prediction", tab: "predict", icon: "◇" },
          { label: "Executive", tab: "executivedash", icon: "◉" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="jarvisbrain" onNavigate={onNavigate} />
      <div className="jbc-header">
        <div>
          <h1 className="jbc-title">Jarvis Brain Center</h1>
          <p className="jbc-subtitle">Live visualization of missions, planning horizons, AI providers, and execution loops.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="jbc-live-badge">
            <div className="jbc-live-dot" />
            LIVE
          </div>
        </div>
      </div>

      <div className="jbc-stats">
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"var(--accent)"}}>{activeMissions}</span><span className="jbc-stat-lbl">Active Missions</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"#00dc82"}}>{totalRuns}</span><span className="jbc-stat-lbl">Total Runs</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"var(--accent2)"}}>{loopCycles}</span><span className="jbc-stat-lbl">Loop Cycles</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"var(--warning)"}}>{horizons.length}</span><span className="jbc-stat-lbl">Plan Horizons</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"#00dc82"}}>{providers.length}</span><span className="jbc-stat-lbl">AI Providers</span></div>
      </div>

      <div className="jbc-flow">
        <div className="jbc-flow-title">Brain Activity Flow</div>
        <div className="jbc-flow-nodes">
          {FLOW_NODES.map((n, i) => (
            <React.Fragment key={n.key}>
              <div className="jbc-flow-node">
                <div className={`jbc-flow-circle ${activeNode === n.key ? "pulsing" : ""}`}>{n.icon}</div>
                <div className="jbc-flow-label">{n.label}</div>
              </div>
              {i < FLOW_NODES.length - 1 && <div className="jbc-flow-arrow">→</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, padding: "10px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)",
            background: tab === t ? "var(--accent)" : "var(--surface-raised)",
            color: tab === t ? "#06080e" : "var(--text-dim)", fontSize: 11, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize", marginBottom: -1,
          }}>{t}</button>
        ))}
        <button onClick={refresh} style={{
          marginLeft: "auto", padding: "5px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)",
          background: "transparent", color: "var(--accent)", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
        }}>↺ Refresh</button>
      </div>

      {error && <div className="ac-api-banner ac-api-banner--error" style={{ flexShrink: 0 }}>⚠ {error} — some panels show cached data</div>}

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>

        {/* MISSIONS tab */}
        {tab === "missions" && (
          <div>
            {loading && missions.length === 0 ? (
              <div className="jbc-empty">Loading missions…</div>
            ) : missions.length === 0 ? (
              <div className="jbc-empty">No missions found. Create a mission from Mission Control.</div>
            ) : (
              missions.map((m, i) => {
                const pct = m.progress ?? (m.completedSubtasks && m.totalSubtasks ? Math.round(m.completedSubtasks / m.totalSubtasks * 100) : 0);
                const statusColor = STATUS_COLORS[m.status] ?? "#64748b";
                return (
                  <div key={m.id ?? i} className="jbc-goal-row" style={{ marginBottom: 8 }}>
                    <span className="jbc-goal-icon">🎯</span>
                    <div className="jbc-goal-info">
                      <div className="jbc-goal-name">{m.title ?? m.name ?? m.goal ?? `Mission ${i + 1}`}</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                        {m.description && <span style={{ marginRight: 8 }}>{m.description.slice(0, 80)}</span>}
                        {m.createdAt && <span>{new Date(m.createdAt).toLocaleDateString()}</span>}
                      </div>
                      <div className="jbc-goal-progress-row">
                        <div className="jbc-goal-bar"><div className="jbc-goal-fill" style={{ width: pct + "%", background: statusColor }} /></div>
                        <span className="jbc-goal-pct">{pct}%</span>
                      </div>
                    </div>
                    <span className="jbc-goal-status" style={{ color: statusColor, borderColor: statusColor + "44", background: statusColor + "11" }}>
                      {m.status ?? "unknown"}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* PLANNING HORIZONS tab */}
        {tab === "planning" && (
          <div>
            {loading && horizons.length === 0 ? (
              <div className="jbc-empty">Loading planning horizons…</div>
            ) : horizons.length === 0 ? (
              <div className="jbc-empty">No planning horizons available. Backend returned empty.</div>
            ) : (
              horizons.map((h, i) => {
                const objectives = Array.isArray(h.objectives) ? h.objectives : [];
                const done = objectives.filter(o => o.status === "complete" || o.completed).length;
                return (
                  <div key={h.id ?? h.horizon ?? i} className="jbc-panel" style={{ marginBottom: 10 }}>
                    <div className="jbc-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>
                        {h.label ?? h.name ?? h.horizon ?? `Horizon ${i + 1}`}
                        {h.timeframe && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>{h.timeframe}</span>}
                      </span>
                      <span style={{ fontSize: 10, color: "#64748b" }}>{done}/{objectives.length} done</span>
                    </div>
                    {h.description && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>{h.description}</div>}
                    {objectives.length === 0 ? (
                      <div style={{ fontSize: 11, color: "#374151", fontStyle: "italic" }}>No objectives</div>
                    ) : (
                      objectives.slice(0, 6).map((o, j) => {
                        const isDone = o.status === "complete" || o.completed;
                        return (
                          <div key={o.id ?? j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 11 }}>
                            <span style={{ color: isDone ? "#22c55e" : "#64748b", fontSize: 13 }}>{isDone ? "✓" : "○"}</span>
                            <span style={{ flex: 1, color: isDone ? "#94a3b8" : "#e2e8f0", textDecoration: isDone ? "line-through" : "none" }}>{o.title ?? o.name ?? o.objective}</span>
                            {o.priority && <span style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{o.priority}</span>}
                          </div>
                        );
                      })
                    )}
                    {objectives.length > 6 && (
                      <div style={{ fontSize: 10, color: "#374151", marginTop: 4 }}>+{objectives.length - 6} more</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* AI PROVIDERS tab */}
        {tab === "providers" && (
          <div>
            {loading && providers.length === 0 ? (
              <div className="jbc-empty">Loading AI providers…</div>
            ) : providers.length === 0 ? (
              <div className="jbc-empty">No AI providers configured.</div>
            ) : (
              providers.map((p, i) => {
                const isOk = p.status === "active" || p.status === "healthy" || p.available === true;
                const statusColor = isOk ? "#22c55e" : p.status === "degraded" ? "#eab308" : "#ef4444";
                return (
                  <div key={p.id ?? p.name ?? i} style={{
                    background: "#0f1117", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 5, padding: "10px 12px", marginBottom: 8,
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0", marginBottom: 2 }}>
                        {p.name ?? p.provider ?? p.id}
                      </div>
                      {p.model && <div style={{ fontSize: 10, color: "#64748b" }}>Model: {p.model}</div>}
                      {p.description && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{p.description}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                        background: statusColor + "18", color: statusColor, border: `1px solid ${statusColor}44`,
                      }}>{p.status ?? (p.available ? "active" : "unknown")}</span>
                      {p.latency != null && <span style={{ fontSize: 10, color: "#64748b" }}>{p.latency}ms</span>}
                      {p.cost != null && <span style={{ fontSize: 10, color: "#64748b" }}>${p.cost}/1k tok</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* REASONING tab — live coordination events from missions */}
        {tab === "reasoning" && (
          <div>
            {missions.length === 0 && (
              <div className="jbc-empty">No mission data for reasoning chains.</div>
            )}
            {missions.flatMap((m, mi) =>
              (m.decisions ?? []).slice(0, 3).map((d, di) => (
                <div key={`${mi}-${di}`} className="jbc-reasoning-row">
                  <span className="jbc-reasoning-ts">{d.createdAt ? new Date(d.createdAt).toLocaleTimeString() : "—"}</span>
                  <span className="jbc-reasoning-text">
                    <strong style={{ color: "#e2e8f0" }}>{m.title ?? "Mission"}:</strong>{" "}
                    {d.rationale ?? d.reason ?? d.text ?? "Decision recorded"}
                  </span>
                </div>
              ))
            )}
            {missions.every(m => !(m.decisions?.length)) && missions.length > 0 && (
              <div style={{ fontSize: 11, color: "#374151", fontStyle: "italic", textAlign: "center", padding: 20 }}>
                No reasoning chains attached to active missions yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    <ContextSidebar onNavigate={onNavigate} context="jarvisbrain" />
    </div>
  );
}
