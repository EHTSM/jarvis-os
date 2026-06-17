import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch } from "../_client";

const STATUS_COLOR = {
  created:   "#607d8b", planned:   "#2196f3", queued:    "#00bcd4",
  executing: "#4caf50", waiting:   "#ff9800", retrying:  "#ff5722",
  completed: "#8bc34a", failed:    "#f44336", rolledback:"#9c27b0",
  paused:    "#795548", cancelled: "#444",
};
const PRI_COLOR = { critical: "#9c27b0", high: "#f44336", medium: "#ff9800", low: "#2196f3" };
const STAGE_COLOR = { pending: "#444", running: "#4caf50", completed: "#8bc34a", failed: "#f44336", skipped: "#555" };

function StatusBadge({ status }) {
  return (
    <span style={{ color: STATUS_COLOR[status] || "#888", fontSize: 10, fontWeight: 600,
      padding: "1px 6px", borderRadius: 4, border: `1px solid ${STATUS_COLOR[status] || "#888"}`,
      display: "inline-block", lineHeight: "16px", whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function StageTimeline({ stages = [] }) {
  if (!stages.length) return null;
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        Stage Graph
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {stages.map((stg, i) => (
          <div key={stg.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            {/* Connector line */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 16 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                background: STAGE_COLOR[stg.status] || "#444", border: "2px solid #222" }} />
              {i < stages.length - 1 && (
                <div style={{ width: 2, flex: 1, minHeight: 12, background: "#2a2a2a", margin: "2px 0" }} />
              )}
            </div>
            <div style={{ flex: 1, paddingBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: STAGE_COLOR[stg.status] || "#888", fontSize: 10, minWidth: 60 }}>{stg.status}</span>
                <span style={{ color: "#bbb", fontSize: 11 }}>{stg.description?.slice(0, 70)}</span>
              </div>
              {stg.assignedAgent && (
                <span style={{ color: "#555", fontSize: 10, marginLeft: 0 }}>→ {stg.assignedAgent}</span>
              )}
              {stg.dependsOn?.length > 0 && (
                <span style={{ color: "#333", fontSize: 10 }}> deps: {stg.dependsOn.length}</span>
              )}
              {stg.retries > 0 && (
                <span style={{ color: "#ff5722", fontSize: 10 }}> retries: {stg.retries}/{stg.maxRetries}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissionRow({ m, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const ts  = new Date(m.createdAt).toLocaleTimeString("en-US", { hour12: false });
  const pct = m.progress?.total > 0
    ? Math.round((m.progress.completed / m.progress.total) * 100)
    : 0;
  const isActive = ["executing", "waiting", "retrying", "queued"].includes(m.orchStatus);

  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ color: "#444", fontSize: 10, minWidth: 60, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{ts}</span>
        <StatusBadge status={m.orchStatus} />
        <span style={{ color: PRI_COLOR[m.priority] || "#888", fontSize: 10, minWidth: 50, flexShrink: 0 }}>{m.priority}</span>
        <span style={{ color: "#bbb", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {m.goal}
        </span>
        <span style={{ color: "#555", fontSize: 10, flexShrink: 0 }}>{pct}%</span>
        {isActive && (
          <button onClick={e => { e.stopPropagation(); onAction("pause", m.missionId); }}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#ff9800",
              borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer" }}>pause</button>
        )}
        {m.orchStatus === "paused" && (
          <button onClick={e => { e.stopPropagation(); onAction("resume", m.missionId); }}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#4caf50",
              borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer" }}>resume</button>
        )}
        {!["completed", "cancelled", "rolledback", "failed"].includes(m.orchStatus) && (
          <button onClick={e => { e.stopPropagation(); onAction("cancel", m.missionId); }}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#f44336",
              borderRadius: 3, padding: "1px 6px", fontSize: 10, cursor: "pointer" }}>cancel</button>
        )}
        <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Progress bar */}
      {m.progress?.total > 0 && (
        <div style={{ height: 2, background: "#1a1a1a", marginLeft: 66, marginTop: 3, borderRadius: 1 }}>
          <div style={{ height: "100%", width: `${pct}%`, background: STATUS_COLOR[m.orchStatus] || "#4caf50",
            borderRadius: 1, transition: "width 0.3s" }} />
        </div>
      )}

      {expanded && (
        <div style={{ margin: "8px 0 4px 66px", padding: 8, background: "#111", borderRadius: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "3px 8px", fontSize: 11, marginBottom: 8 }}>
            {[
              ["Mission ID",   m.missionId],
              ["Orch ID",      m.orchId],
              ["Decision",     m.originDecisionId || "—"],
              ["Progress",     `${m.progress?.completed}/${m.progress?.total} stages`],
              ["Est. complete", m.estimatedCompletion ? new Date(m.estimatedCompletion).toLocaleTimeString("en-US", { hour12: false }) : "—"],
              ["Rollback plan", m.rollbackPlan?.slice(0, 60) || "—"],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ color: "#555" }}>{k}</span>
                <span style={{ color: "#aaa", wordBreak: "break-all" }}>{v}</span>
              </React.Fragment>
            ))}
            {m.error && <><span style={{ color: "#f44336" }}>Error</span><span style={{ color: "#f44336" }}>{m.error}</span></>}
          </div>
          <StageTimeline stages={m.stages || []} />
        </div>
      )}
    </div>
  );
}

export default function MissionOrchestratorPanel() {
  const [tab, setTab]         = useState("missions");
  const [missions, setMissions] = useState([]);
  const [stats, setStats]     = useState(null);
  const [filter, setFilter]   = useState({ status: "", priority: "" });
  const [newGoal, setNewGoal] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError]     = useState(null);
  const [msg, setMsg]         = useState(null);
  const pollRef               = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const qs = [
        filter.status   ? `status=${filter.status}`     : "",
        filter.priority ? `priority=${filter.priority}` : "",
        "limit=100",
      ].filter(Boolean).join("&");
      const [ms, st] = await Promise.all([
        _fetch(`/missions/orchestrator?${qs}`),
        _fetch("/missions/orchestrator/statistics"),
      ]);
      if (ms?.success)  setMissions(ms.missions || []);
      if (st?.success)  setStats(st);
      setError(null);
    } catch (e) { setError(e.message); }
  }, [filter]);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 8_000);
    return () => clearInterval(pollRef.current);
  }, [fetchAll]);

  const handleAction = useCallback(async (action, missionId) => {
    try {
      await _fetch(`/missions/orchestrator/${action}`, { method: "POST", body: JSON.stringify({ missionId }), headers: { "Content-Type": "application/json" } });
      setMsg(`Mission ${action} sent`);
      setTimeout(() => setMsg(null), 3000);
      fetchAll();
    } catch (e) { setError(e.message); }
  }, [fetchAll]);

  const handleCreate = useCallback(async () => {
    if (!newGoal.trim()) return;
    setCreating(true);
    try {
      const r = await _fetch("/missions/orchestrator/create", {
        method: "POST",
        body: JSON.stringify({ goal: newGoal.trim(), priority: "medium" }),
        headers: { "Content-Type": "application/json" },
      });
      if (r?.success) {
        setNewGoal("");
        setMsg("Mission created and queued");
        setTimeout(() => setMsg(null), 3000);
        fetchAll();
      }
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  }, [newGoal, fetchAll]);

  const tabStyle = t => ({
    padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500,
    color: tab === t ? "#fff" : "#666", background: "none", border: "none",
    borderBottom: tab === t ? "2px solid #4caf50" : "2px solid transparent",
  });

  if (error) return <div style={{ padding: 16, color: "#f44336", fontSize: 12 }}>Orchestrator unavailable: {error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d0d0d", color: "#ccc", fontFamily: "monospace" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span style={{ color: "#4caf50", fontWeight: 700, fontSize: 13 }}>◎ Mission Orchestrator</span>
        {stats && (
          <span style={{ color: "#555", fontSize: 11 }}>
            {stats.running ? <span style={{ color: "#4caf50" }}>● live</span> : <span style={{ color: "#f44336" }}>● stopped</span>}
            {" "}{stats.liveMissions} live · {stats.activeMissions} active · {stats.completed} done
          </span>
        )}
        {msg && <span style={{ color: "#4caf50", fontSize: 11 }}>{msg}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={fetchAll} style={{ background: "#1e1e1e", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>↻</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        {["missions", "create", "statistics"].map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {tab === "missions" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {[["status", "Status"], ["priority", "Priority"]].map(([key, label]) => (
                <input key={key} placeholder={label} value={filter[key]}
                  onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}
                  style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ccc", borderRadius: 4, padding: "3px 8px", fontSize: 11, width: 90 }} />
              ))}
              <span style={{ color: "#555", fontSize: 11, lineHeight: "26px" }}>{missions.length} missions</span>
            </div>
            {missions.length === 0 && <div style={{ color: "#555", fontSize: 12, padding: "20px 0" }}>No orchestrated missions yet.</div>}
            {missions.map(m => <MissionRow key={m.missionId || m.orchId} m={m} onAction={handleAction} />)}
          </>
        )}

        {tab === "create" && (
          <div style={{ maxWidth: 600 }}>
            <div style={{ color: "#666", fontSize: 11, marginBottom: 8 }}>Create a mission manually. The orchestrator will plan stages and delegate execution to autonomousLoop.</div>
            <textarea value={newGoal} onChange={e => setNewGoal(e.target.value)}
              placeholder="Mission goal…"
              style={{ width: "100%", height: 80, background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ccc",
                borderRadius: 4, padding: 8, fontSize: 12, resize: "vertical", fontFamily: "monospace" }} />
            <button onClick={handleCreate} disabled={creating || !newGoal.trim()}
              style={{ marginTop: 8, background: creating ? "#1a1a1a" : "#1b5e20", border: "1px solid #2e7d32",
                color: creating ? "#555" : "#ccc", borderRadius: 4, padding: "6px 16px", fontSize: 12, cursor: creating ? "default" : "pointer" }}>
              {creating ? "Creating…" : "Create Mission"}
            </button>
          </div>
        )}

        {tab === "statistics" && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ color: "#666", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Throughput</div>
              {[
                ["Created",   stats.created],
                ["Completed", stats.completed],
                ["Failed",    stats.failed],
                ["Cancelled", stats.cancelled],
                ["Retries",   stats.retries],
                ["Live",      stats.liveMissions],
                ["Active",    stats.activeMissions],
                ["Uptime",    `${Math.floor((stats.uptimeSec || 0) / 60)}m`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: "#888" }}>{k}</span>
                  <span style={{ color: "#ccc" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
