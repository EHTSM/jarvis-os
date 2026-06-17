import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch } from "../_client";

const ACTION_COLOR = {
  Ignore:         "#444",
  Monitor:        "#607d8b",
  Notify:         "#2196f3",
  Recommend:      "#00bcd4",
  Retry:          "#ff9800",
  Escalate:       "#f44336",
  CreateMission:  "#9c27b0",
  PauseMission:   "#795548",
  ResumeMission:  "#4caf50",
  RequestApproval:"#ff5722",
  AutoRecover:    "#8bc34a",
};

const PRIORITY_COLOR = { CRITICAL: "#9c27b0", HIGH: "#f44336", MEDIUM: "#ff9800", LOW: "#2196f3", NONE: "#444" };

function ActionBadge({ action }) {
  return (
    <span style={{ color: ACTION_COLOR[action] || "#888", fontWeight: 600, fontSize: 10,
      padding: "1px 6px", borderRadius: 4, border: `1px solid ${ACTION_COLOR[action] || "#888"}`,
      display: "inline-block", lineHeight: "16px", whiteSpace: "nowrap" }}>
      {action}
    </span>
  );
}

function PriorityDot({ priority }) {
  return (
    <span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0,
      background: PRIORITY_COLOR[priority] || "#444", marginRight: 4 }} title={priority} />
  );
}

function DecisionRow({ d }) {
  const [expanded, setExpanded] = useState(false);
  const ts = new Date(d.createdAt).toLocaleTimeString("en-US", { hour12: false });
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", padding: "5px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexWrap: "nowrap" }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ color: "#444", fontSize: 10, minWidth: 60, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{ts}</span>
        <PriorityDot priority={d.priority} />
        <ActionBadge action={d.recommendedAction} />
        <span style={{ color: "#666", fontSize: 10, minWidth: 70, flexShrink: 0 }}>{d.affectedSubsystem}</span>
        <span style={{ color: "#bbb", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.reason.replace(/\[AI:.*?\]/, "").trim()}
        </span>
        {d.requiresApproval && (
          <span style={{ color: "#ff5722", fontSize: 10, flexShrink: 0 }}>⚠ approval</span>
        )}
        <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ margin: "6px 0 2px 66px", padding: 8, background: "#111", borderRadius: 4, fontSize: 11 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "3px 8px", color: "#888" }}>
            {[
              ["Decision ID",  d.decisionId],
              ["Rule",         `${d.ruleId} — ${d.ruleName}`],
              ["Confidence",   `${Math.round(d.confidence * 100)}%`],
              ["Impact",       d.estimatedImpact],
              ["Entity",       d.affectedEntity],
              ["Source Event", d.sourceEventId || "—"],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ color: "#555" }}>{k}</span>
                <span style={{ color: "#ccc", wordBreak: "break-all" }}>{v}</span>
              </React.Fragment>
            ))}
            <span style={{ color: "#555" }}>Reason</span>
            <span style={{ color: "#aaa" }}>{d.reason}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div style={{ display: "flex", gap: 16, padding: "4px 0", fontSize: 11, color: "#666", flexWrap: "wrap" }}>
      <span>total <span style={{ color: "#ccc" }}>{stats.totalDecisions}</span></span>
      <span>avg <span style={{ color: "#ccc" }}>{stats.latency?.avgMs ?? 0}ms</span></span>
      <span>p99 <span style={{ color: "#ccc" }}>{stats.latency?.p99Ms ?? 0}ms</span></span>
      <span>dedup <span style={{ color: "#ccc" }}>{stats.dedupHits}</span></span>
      <span>rules <span style={{ color: "#ccc" }}>{stats.rulesLoaded}</span></span>
      <span>ring <span style={{ color: "#ccc" }}>{stats.ringFill}/2000</span></span>
    </div>
  );
}

export default function DecisionQueuePanel() {
  const [tab, setTab]           = useState("queue");
  const [decisions, setDecisions] = useState([]);
  const [stats, setStats]       = useState(null);
  const [rules, setRules]       = useState([]);
  const [filter, setFilter]     = useState({ action: "", priority: "" });
  const [error, setError]       = useState(null);
  const pollRef                 = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const qs = [
        filter.action   ? `action=${filter.action}`   : "",
        filter.priority ? `priority=${filter.priority}` : "",
        "limit=200",
      ].filter(Boolean).join("&");

      const [dec, st, rl] = await Promise.all([
        _fetch(`/runtime/decisions?${qs}`),
        _fetch("/runtime/decisions/statistics"),
        tab === "rules" ? _fetch("/runtime/decisions/rules") : Promise.resolve(null),
      ]);
      if (dec?.success)  setDecisions(dec.decisions || []);
      if (st?.success)   setStats(st);
      if (rl?.success)   setRules(rl.rules || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [filter, tab]);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 8_000);
    return () => clearInterval(pollRef.current);
  }, [fetchAll]);

  const tabStyle = t => ({
    padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500,
    color: tab === t ? "#fff" : "#666", background: "none", border: "none",
    borderBottom: tab === t ? "2px solid #9c27b0" : "2px solid transparent",
  });

  if (error) return (
    <div style={{ padding: 16, color: "#f44336", fontSize: 12 }}>
      Decision Engine unavailable: {error}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d0d0d", color: "#ccc", fontFamily: "monospace" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px",
        borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span style={{ color: "#9c27b0", fontWeight: 700, fontSize: 13 }}>◈ Decision Engine</span>
        {stats && (
          <span style={{ color: "#555", fontSize: 11 }}>
            {stats.running ? <span style={{ color: "#9c27b0" }}>● live</span> : <span style={{ color: "#f44336" }}>● stopped</span>}
            {" "}{stats.totalDecisions} decisions · uptime {Math.floor((stats.uptimeSec || 0) / 60)}m
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={fetchAll} style={{ background: "#1e1e1e", border: "1px solid #333", color: "#888",
          borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>↻</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        {["queue", "statistics", "rules"].map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {tab === "queue" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
              {[["action", "Action"], ["priority", "Priority"]].map(([key, label]) => (
                <input key={key} placeholder={label} value={filter[key]}
                  onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}
                  style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ccc",
                    borderRadius: 4, padding: "3px 8px", fontSize: 11, width: 90 }} />
              ))}
              <StatsBar stats={stats} />
            </div>
            {decisions.length === 0 && (
              <div style={{ color: "#555", fontSize: 12, padding: "20px 0" }}>
                No decisions yet — waiting for observer events…
              </div>
            )}
            {decisions.map(d => <DecisionRow key={d.decisionId} d={d} />)}
          </>
        )}

        {tab === "statistics" && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ color: "#666", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Performance</div>
              {[
                ["Total decisions", stats.totalDecisions],
                ["Avg latency",     `${stats.latency?.avgMs ?? 0}ms`],
                ["p99 latency",     `${stats.latency?.p99Ms ?? 0}ms`],
                ["Dedup hits",      stats.dedupHits],
                ["Ring fill",       `${stats.ringFill} / 2000`],
                ["Rules loaded",    stats.rulesLoaded],
                ["Uptime",          `${Math.floor((stats.uptimeSec || 0) / 60)}m`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0",
                  borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: "#888" }}>{k}</span>
                  <span style={{ color: "#ccc" }}>{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ color: "#666", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>By Action</div>
              {Object.entries(stats.byAction || {}).sort((a, b) => b[1] - a[1]).map(([action, count]) => (
                <div key={action} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0",
                  borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: ACTION_COLOR[action] || "#888" }}>{action}</span>
                  <span style={{ color: "#ccc" }}>{count}</span>
                </div>
              ))}
              <div style={{ color: "#666", fontSize: 11, marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>By Priority</div>
              {Object.entries(stats.byPriority || {}).map(([pri, count]) => (
                <div key={pri} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0",
                  borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: PRIORITY_COLOR[pri] || "#888" }}>{pri}</span>
                  <span style={{ color: "#ccc" }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "rules" && (
          <>
            <div style={{ color: "#555", fontSize: 11, marginBottom: 8 }}>{rules.length} rules active (evaluated in priority order)</div>
            {rules.map(r => (
              <div key={r.id} style={{ padding: "6px 0", borderBottom: "1px solid #1a1a1a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#555", fontSize: 10, minWidth: 40 }}>{r.id}</span>
                  <span style={{ color: "#9c27b0", fontSize: 11, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ color: "#444", fontSize: 10, marginLeft: "auto" }}>pri {r.priority}</span>
                </div>
                <div style={{ color: "#666", fontSize: 11, marginTop: 2, marginLeft: 48 }}>{r.description}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
