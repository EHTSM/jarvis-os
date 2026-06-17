import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch } from "../_client";

const STATUS_COLOR = {
  running:   "#4caf50", completed: "#8bc34a", failed:    "#f44336",
  cancelled: "#607d8b", pending:   "#ff9800",
};
const VER_COLOR = { passed: "#8bc34a", failed: "#f44336", pending: "#607d8b", no_output: "#ff9800", output_contains_fatal_error: "#f44336" };

function StatusBadge({ status }) {
  return (
    <span style={{ color: STATUS_COLOR[status] || "#888", fontSize: 10, fontWeight: 600,
      padding: "1px 5px", borderRadius: 3, border: `1px solid ${STATUS_COLOR[status] || "#888"}`,
      display: "inline-block", lineHeight: "15px", whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function ExecRow({ e, onRetry, onCancel, onRollback }) {
  const [expanded, setExpanded] = useState(false);
  const ts  = new Date(e.startedAt).toLocaleTimeString("en-US", { hour12: false });
  const dur = e.duration ? `${e.duration}ms` : "…";
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", padding: "5px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
        onClick={() => setExpanded(x => !x)}>
        <span style={{ color: "#444", fontSize: 10, minWidth: 58, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{ts}</span>
        <StatusBadge status={e.status} />
        <span style={{ color: "#607d8b", fontSize: 10, minWidth: 80, flexShrink: 0 }}>{e.capability}</span>
        <span style={{ color: "#bbb", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {e.input}
        </span>
        <span style={{ color: "#555", fontSize: 10, flexShrink: 0 }}>{dur}</span>
        <span style={{ color: VER_COLOR[e.verificationResult] || "#888", fontSize: 10, flexShrink: 0 }}>
          {e.verificationResult === "passed" ? "✓" : e.verificationResult === "failed" ? "✗" : "?"}
        </span>
        {e.status === "failed" && (
          <button onClick={ev => { ev.stopPropagation(); onRetry(e.executionId); }}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#ff9800", borderRadius: 3, padding: "1px 5px", fontSize: 10, cursor: "pointer" }}>retry</button>
        )}
        {e.status === "running" && (
          <button onClick={ev => { ev.stopPropagation(); onCancel(e.executionId); }}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#f44336", borderRadius: 3, padding: "1px 5px", fontSize: 10, cursor: "pointer" }}>cancel</button>
        )}
        {e.rollbackAvailable && e.status === "completed" && (
          <button onClick={ev => { ev.stopPropagation(); onRollback(e.executionId); }}
            style={{ background: "#1a1a1a", border: "1px solid #333", color: "#9c27b0", borderRadius: 3, padding: "1px 5px", fontSize: 10, cursor: "pointer" }}>rollback</button>
        )}
        <span style={{ color: "#333", fontSize: 10, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ margin: "6px 0 2px 64px", padding: 8, background: "#111", borderRadius: 4, fontSize: 11 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "3px 8px", color: "#888", marginBottom: 6 }}>
            {[
              ["Execution ID",   e.executionId],
              ["Mission",        e.missionId || "—"],
              ["Stage",          e.stageId   || "—"],
              ["Agent",          e.assignedAgent || "—"],
              ["Attempts",       `${e.attempts} / ${e.maxAttempts}`],
              ["Verification",   e.verificationResult],
              ["Rollback avail", e.rollbackAvailable ? "yes" : "no"],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <span style={{ color: "#555" }}>{k}</span>
                <span style={{ color: "#aaa", wordBreak: "break-all" }}>{v}</span>
              </React.Fragment>
            ))}
            {e.error && (
              <><span style={{ color: "#f44336" }}>Error</span><span style={{ color: "#f44336" }}>{e.error}</span></>
            )}
            {e.output && (
              <><span style={{ color: "#4caf50" }}>Output</span><span style={{ color: "#aaa" }}>{String(e.output).slice(0, 200)}</span></>
            )}
          </div>
          {e.logs?.length > 0 && (
            <div>
              <div style={{ color: "#444", fontSize: 10, marginBottom: 4 }}>Logs</div>
              {e.logs.map((l, i) => (
                <div key={i} style={{ color: "#555", fontSize: 10, padding: "1px 0" }}>
                  <span style={{ color: "#333" }}>{new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })} </span>
                  {l.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExecutionRuntimePanel() {
  const [tab, setTab]           = useState("executions");
  const [executions, setExecs]  = useState([]);
  const [stats, setStats]       = useState(null);
  const [caps, setCaps]         = useState([]);
  const [filter, setFilter]     = useState({ status: "", capability: "" });
  const [msg, setMsg]           = useState(null);
  const [error, setError]       = useState(null);
  const pollRef                 = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const qs = [
        filter.status     ? `status=${filter.status}`         : "",
        filter.capability ? `capability=${filter.capability}` : "",
        "limit=200",
      ].filter(Boolean).join("&");
      const [ex, st] = await Promise.all([
        _fetch(`/runtime/execution?${qs}`),
        _fetch("/runtime/execution/statistics"),
      ]);
      if (ex?.success)  setExecs(ex.executions || []);
      if (st?.success)  setStats(st);
      setError(null);
    } catch (e) { setError(e.message); }
  }, [filter]);

  const fetchCaps = useCallback(async () => {
    try {
      const r = await _fetch("/runtime/capabilities");
      if (r?.success) setCaps(r.capabilities || []);
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 6_000);
    return () => clearInterval(pollRef.current);
  }, [fetchAll]);

  useEffect(() => { if (tab === "capabilities") fetchCaps(); }, [tab, fetchCaps]);

  const action = useCallback(async (type, executionId) => {
    try {
      const r = await _fetch(`/runtime/execution/${type}`, {
        method: "POST",
        body: JSON.stringify({ executionId }),
        headers: { "Content-Type": "application/json" },
      });
      setMsg(`${type} ${r?.success ? "succeeded" : "failed"}`);
      setTimeout(() => setMsg(null), 3000);
      fetchAll();
    } catch (e) { setError(e.message); }
  }, [fetchAll]);

  const tabStyle = t => ({
    padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500,
    color: tab === t ? "#fff" : "#666", background: "none", border: "none",
    borderBottom: tab === t ? "2px solid #607d8b" : "2px solid transparent",
  });

  if (error) return <div style={{ padding: 16, color: "#f44336", fontSize: 12 }}>Execution runtime unavailable: {error}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d0d0d", color: "#ccc", fontFamily: "monospace" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span style={{ color: "#607d8b", fontWeight: 700, fontSize: 13 }}>⚙ Execution Runtime</span>
        {stats && (
          <span style={{ color: "#555", fontSize: 11 }}>
            {stats.running ? <span style={{ color: "#607d8b" }}>● live</span> : <span style={{ color: "#f44336" }}>● stopped</span>}
            {" "}{stats.activeExecutions} active · {stats.completed} done · {stats.failed} failed
            {" · "}{stats.capabilities} caps
          </span>
        )}
        {msg && <span style={{ color: "#4caf50", fontSize: 11 }}>{msg}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={fetchAll} style={{ background: "#1e1e1e", border: "1px solid #333", color: "#888", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>↻</button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        {["executions", "capabilities", "statistics"].map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {tab === "executions" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {[["status", "Status"], ["capability", "Capability"]].map(([key, label]) => (
                <input key={key} placeholder={label} value={filter[key]}
                  onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}
                  style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ccc", borderRadius: 4, padding: "3px 8px", fontSize: 11, width: 100 }} />
              ))}
              <span style={{ color: "#555", fontSize: 11, lineHeight: "26px" }}>{executions.length} records</span>
            </div>
            {executions.length === 0 && <div style={{ color: "#555", fontSize: 12, padding: "20px 0" }}>No executions yet. Missions will populate this list.</div>}
            {executions.map(e => (
              <ExecRow key={e.executionId} e={e}
                onRetry={id => action("retry", id)}
                onCancel={id => action("cancel", id)}
                onRollback={id => action("rollback", id)} />
            ))}
          </>
        )}

        {tab === "capabilities" && (
          <>
            <div style={{ color: "#555", fontSize: 11, marginBottom: 10 }}>{caps.length} engineering capabilities registered (I5)</div>
            {caps.length === 0 && <div style={{ color: "#555", fontSize: 12 }}>No capabilities loaded yet.</div>}
            {caps.map(c => (
              <div key={c.name} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0", borderBottom: "1px solid #1a1a1a" }}>
                <span style={{ color: "#607d8b", fontSize: 10, minWidth: 16 }}>●</span>
                <span style={{ color: "#aaa", fontSize: 11, minWidth: 130, flexShrink: 0 }}>{c.name}</span>
                <span style={{ color: "#555", fontSize: 10, minWidth: 70, flexShrink: 0 }}>{c.category}</span>
                <span style={{ color: "#444", fontSize: 10, flex: 1 }}>{c.description}</span>
                <span style={{ color: c.registered ? "#8bc34a" : "#f44336", fontSize: 10, flexShrink: 0 }}>{c.registered ? "active" : "inactive"}</span>
              </div>
            ))}
          </>
        )}

        {tab === "statistics" && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ color: "#555", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Throughput</div>
              {[
                ["Started",      stats.started],
                ["Completed",    stats.completed],
                ["Failed",       stats.failed],
                ["Cancelled",    stats.cancelled],
                ["Retries",      stats.retries],
                ["Timeouts",     stats.timeouts],
                ["Rollbacks",    stats.rollbacks],
                ["Avg duration", `${stats.avgDurationMs}ms`],
                ["Active",       stats.activeExecutions],
                ["Capabilities", stats.capabilities],
                ["Ring fill",    `${stats.ringFill}/1000`],
                ["Uptime",       `${Math.floor((stats.uptimeSec || 0) / 60)}m`],
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
