import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { cycleStats } from "../phase18Api";
import { getAutonomyStatus } from "../phase20Api";
import { getMissions, getMissionStats, getPlanningHorizons, getAiProviders } from "../phase27Api";
import { _fetch } from "../_client";
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

const TABS = ["missions", "planning", "providers", "reasoning", "intelligence"];

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

  // Intelligence tab data
  const [intelCorr,   setIntelCorr]   = useState(null);
  const [intelInsights, setIntelInsights] = useState(null);
  const [intelPatterns, setIntelPatterns] = useState(null);
  const [intelRecConf, setIntelRecConf]   = useState(null);
  const [intelLoading, setIntelLoading]   = useState(false);

  // Brain flow animation
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setTick(x => x + 1); }, 2800);
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
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  // Collaboration state (inside intelligence tab)
  const [collabMission, setCollabMission] = useState('');
  const [collabInput,   setCollabInput]   = useState('');
  const [collabMsg,     setCollabMsg]     = useState('');
  const [collabSending, setCollabSending] = useState(false);
  const [collabReply,   setCollabReply]   = useState(null);
  const [collabHistory, setCollabHistory] = useState(null);
  const [collabAction,  setCollabAction]  = useState('ask_ai');
  const [collabErr,     setCollabErr]     = useState(null);

  const loadCollabHistory = useCallback(async (id) => {
    if (!id) return;
    try {
      const r = await _fetch(`/collaboration/history/${id}`);
      setCollabHistory(r.history || null);
    } catch {}
  }, []);

  const attachCollab = useCallback(async () => {
    if (!collabInput.trim()) return;
    setCollabMission(collabInput.trim());
    await loadCollabHistory(collabInput.trim());
  }, [collabInput, loadCollabHistory]);

  const sendCollabMsg = useCallback(async () => {
    if (!collabMission || !collabMsg.trim()) return;
    setCollabSending(true); setCollabErr(null); setCollabReply(null);
    try {
      if (collabAction === 'ask_ai' || collabAction === 'ask_agent') {
        const r = await _fetch('/collaboration/message', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ missionId: collabMission, from: 'operator', body: collabMsg }),
        });
        setCollabReply(r.result?.reply || null);
      } else {
        const r = await _fetch('/collaboration/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ missionId: collabMission, action: collabAction, payload: { body: collabMsg } }),
        });
        const res = r.result?.result || r.result || {};
        setCollabReply(res.explanation || res.summary || res.reply || JSON.stringify(res).slice(0, 300));
      }
      setCollabMsg('');
      await loadCollabHistory(collabMission);
    } catch (e) { setCollabErr(e.message); }
    finally { setCollabSending(false); }
  }, [collabMission, collabMsg, collabAction, loadCollabHistory]);

  const refreshIntel = useCallback(() => {
    setIntelLoading(true);
    Promise.allSettled([
      _fetch("/intelligence/correlations"),
      _fetch("/intelligence/insights"),
      _fetch("/intelligence/patterns"),
      _fetch("/intelligence/recommendation-confidence"),
    ]).then(([corrRes, insRes, patRes, rcRes]) => {
      if (corrRes.status === "fulfilled") setIntelCorr(corrRes.value?.correlations ?? null);
      if (insRes.status  === "fulfilled") setIntelInsights(insRes.value?.insights   ?? null);
      if (patRes.status  === "fulfilled") setIntelPatterns(patRes.value?.patterns   ?? null);
      if (rcRes.status   === "fulfilled") setIntelRecConf(rcRes.value?.recommendations ?? null);
      setIntelLoading(false);
    });
  }, []);

  useEffect(() => {
    if (tab !== "intelligence") return;
    refreshIntel();
    const t = setInterval(() => { if (!document.hidden) refreshIntel(); }, 30000);
    return () => clearInterval(t);
  }, [tab, refreshIntel]);

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

        {/* INTELLIGENCE tab — J4 Cross-Domain Intelligence */}
        {tab === "intelligence" && (
          <div>
            {intelLoading && !intelCorr && (
              <div className="jbc-empty">Computing cross-domain correlations…</div>
            )}

            {/* Correlation Matrix */}
            {intelCorr && (
              <div className="jbc-panel" style={{ marginBottom: 10 }}>
                <div className="jbc-panel-title">Correlation Matrix</div>
                {Object.entries(intelCorr).map(([key, corr]) => {
                  const strength = corr?.strength ?? 0;
                  const color = strength >= 70 ? "#f87171" : strength >= 40 ? "#fbbf24" : "#22c55e";
                  const label = key.replace(/_/g, " → ");
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#e2e8f0", textTransform: "capitalize", marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>{corr?.insight || corr?.label || ""}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color }}>{strength}%</div>
                        <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase" }}>{corr?.label || ""}</div>
                      </div>
                      <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, flexShrink: 0 }}>
                        <div style={{ width: `${strength}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pattern Timeline */}
            {intelPatterns && intelPatterns.length > 0 && (
              <div className="jbc-panel" style={{ marginBottom: 10 }}>
                <div className="jbc-panel-title">Pattern Timeline</div>
                {intelPatterns.slice(0, 8).map((p, i) => {
                  const typeColor = p.type === "failure" ? "#f87171" : p.type === "success" ? "#22c55e" : "#60a5fa";
                  return (
                    <div key={p.id ?? i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 8, background: typeColor + "22", color: typeColor, flexShrink: 0, marginTop: 1 }}>
                        {p.type}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#e2e8f0" }}>{p.label}</div>
                        {p.rootCause && <div style={{ fontSize: 10, color: "#64748b" }}>Root: {p.rootCause}</div>}
                      </div>
                      <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>×{p.count || 1}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Success Heatmap (recommendation confidence) */}
            {intelRecConf && intelRecConf.length > 0 && (
              <div className="jbc-panel" style={{ marginBottom: 10 }}>
                <div className="jbc-panel-title">Recommendation Confidence</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {intelRecConf.slice(0, 8).map((r, i) => {
                    const conf = r.confidence ?? 0;
                    const color = conf >= 80 ? "#22c55e" : conf >= 60 ? "#fbbf24" : "#f87171";
                    return (
                      <div key={r.id ?? i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "6px 8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 4, lineHeight: 1.3 }}>{r.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
                            <div style={{ width: `${conf}%`, height: "100%", background: color, borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color }}>{conf}%</span>
                        </div>
                        <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{r.source} · {r.priority}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Insights summary */}
            {intelInsights && intelInsights.length > 0 && (
              <div className="jbc-panel">
                <div className="jbc-panel-title">Cross-Domain Insights</div>
                {intelInsights.slice(0, 6).map((ins, i) => {
                  const sevColor = ins.severity === "high" ? "#f87171" : ins.severity === "medium" ? "#fbbf24" : "#22c55e";
                  return (
                    <div key={ins.domain ?? i} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: 8 }}>
                      <div style={{ width: 3, background: sevColor, borderRadius: 2, flexShrink: 0, alignSelf: "stretch" }} />
                      <div>
                        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {(ins.domain || "").replace(/_/g, " → ")}
                        </div>
                        <div style={{ fontSize: 11, color: "#e2e8f0" }}>{ins.insight}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI Collaboration Panel */}
            <div className="jbc-panel" style={{ marginTop: 10 }}>
              <div className="jbc-panel-title">AI Collaboration</div>

              {/* Mission attach */}
              {!collabMission ? (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    style={{ flex: 1, fontSize: 11, background: '#0c0e14', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '4px 8px', fontFamily: 'inherit' }}
                    placeholder="Mission ID to collaborate…"
                    value={collabInput}
                    onChange={e => setCollabInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') attachCollab(); }}
                  />
                  <button
                    onClick={attachCollab}
                    disabled={!collabInput.trim()}
                    style={{ padding: '4px 10px', fontSize: 11, background: 'var(--accent)', color: '#06080e', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
                  >
                    Attach
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
                    Mission: <span style={{ color: 'var(--accent)' }}>{collabMission}</span>
                    <button onClick={() => { setCollabMission(''); setCollabHistory(null); setCollabReply(null); }}
                      style={{ marginLeft: 8, fontSize: 9, color: '#475569', background: 'none', border: 'none', cursor: 'pointer' }}>✕ detach</button>
                  </div>

                  {/* Quick actions */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                    {[
                      ['explain_risk',       'Risk'],
                      ['explain_confidence', 'Confidence'],
                      ['explain_decision',   'Decision'],
                      ['request_replan',     'Re-plan'],
                      ['compare_alternatives', 'Compare'],
                    ].map(([act, lbl]) => (
                      <button key={act} onClick={async () => {
                        setCollabAction(act);
                        const r = await _fetch('/collaboration/action', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ missionId: collabMission, action: act, payload: act === 'request_replan' ? { reason: 'Operator triggered' } : {} }),
                        }).catch(() => null);
                        if (r) {
                          const res = r.result?.result || r.result || {};
                          setCollabReply(res.explanation || res.summary || res.reply || JSON.stringify(res).slice(0, 200));
                          loadCollabHistory(collabMission);
                        }
                      }} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {/* Collaboration timeline */}
                  {collabHistory?.timeline?.length > 0 && (
                    <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8 }}>
                      {collabHistory.timeline.slice(-8).map((item, i) => (
                        <div key={item.id || i} style={{ padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 10 }}>
                          <span style={{ color: '#475569', marginRight: 6 }}>{new Date(item.ts || item.timestamp).toLocaleTimeString()}</span>
                          <span style={{ color: '#60a5fa', fontWeight: 700, marginRight: 6 }}>
                            {item._kind === 'message' ? `${item.from}→${item.to}` : item.action}
                          </span>
                          <span style={{ color: '#94a3b8' }}>
                            {item._kind === 'message' ? item.body?.slice(0, 50) : (item.result?.type || '')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI reply */}
                  {collabReply && (
                    <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 4, padding: '7px 10px', fontSize: 11, color: '#e2e8f0', marginBottom: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 100, overflowY: 'auto' }}>
                      <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700, marginRight: 6 }}>AI</span>
                      {collabReply}
                    </div>
                  )}
                  {collabErr && <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 4 }}>{collabErr}</div>}

                  {/* Input */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select
                      value={collabAction}
                      onChange={e => setCollabAction(e.target.value)}
                      style={{ fontSize: 10, background: '#0c0e14', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 4px', fontFamily: 'inherit' }}
                    >
                      <option value="ask_ai">Ask AI</option>
                      <option value="explain_decision">Explain Decision</option>
                      <option value="explain_risk">Explain Risk</option>
                      <option value="explain_confidence">Confidence</option>
                      <option value="compare_alternatives">Compare</option>
                    </select>
                    <input
                      style={{ flex: 1, fontSize: 11, background: '#0c0e14', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px', fontFamily: 'inherit' }}
                      placeholder="Ask about this mission…"
                      value={collabMsg}
                      onChange={e => setCollabMsg(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCollabMsg(); } }}
                    />
                    <button
                      onClick={sendCollabMsg}
                      disabled={collabSending || !collabMsg.trim()}
                      style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#06080e', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {collabSending ? '…' : 'Ask'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {!intelLoading && !intelCorr && !intelInsights && (
              <div className="jbc-empty">Intelligence data unavailable. Ensure backend services are running.</div>
            )}
          </div>
        )}
      </div>
    </div>
    <ContextSidebar onNavigate={onNavigate} context="jarvisbrain" />
    </div>
  );
}
