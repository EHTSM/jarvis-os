import React, { useEffect, useRef, useState, useMemo } from "react";
import TelemetryPanel from "./TelemetryPanel";

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDur(ms) {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function getRecoveryHint(error) {
  if (!error) return null;
  const err = error.toLowerCase();
  if (err.includes("timeout")) return "Try increasing the timeout or checking if the process is stuck.";
  if (err.includes("not found")) return "Verify the file path or command name.";
  if (err.includes("permission")) return "Check file permissions or sudo requirements.";
  if (err.includes("pm2")) return "Ensure PM2 is running and the process name is correct.";
  if (err.includes("git")) return "Check repository state and network connection.";
  return "Review the logs for specific error details.";
}

function EntryRow({ entry, onPopulateInput, lastCheck }) {
  const [expanded, setExpanded] = React.useState(false);
  const [elapsed,  setElapsed]  = React.useState(0);
  
  const ok     = entry.status === "success" || entry.status === "completed";
  const failed = entry.status === "failed"  || entry.status === "error";
  const running = entry.status === "running" || entry.status === "pending";
  
  const icon   = ok ? "✓" : failed ? "✗" : running ? "▶" : "·";
  const cls    = ok ? "ok" : failed ? "fail" : running ? "run" : "idle";

  const isStalled = running && elapsed > 60000;
  const isAbandoned = running && elapsed > (entry.timeoutMs || 30000) + 120000; // Timeout + 2min buffer
  const isNew     = (entry.timestamp || entry.ts || 0) > lastCheck;

  React.useEffect(() => {
    let timer;
    if (running) {
      timer = setInterval(() => {
        const start = entry.timestamp || entry.ts || Date.now();
        setElapsed(Date.now() - start);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [running, entry.timestamp, entry.ts]);

  const rawOut = entry.output || entry.result || entry.reply || "";
  const outStr = typeof rawOut === "string" ? rawOut : JSON.stringify(rawOut, null, 2);
  const isLong = outStr.length > 200 || (entry.input && entry.input.length > 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div 
        className={`op-exec-entry${entry._new || isNew ? " new-entry" : ""}`}
        onClick={() => isLong && setExpanded(!expanded)}
        style={{ cursor: isLong ? "pointer" : "default" }}
      >
        <span className="op-exec-ts">
          {fmtTime(entry.timestamp || entry.ts)}
          {isNew && <span style={{ marginLeft: 4, color: "var(--op-blue)", fontWeight: "bold", fontSize: 7 }}>NEW</span>}
        </span>
        <span className={`op-exec-icon ${cls}${failed ? " pulse-fail" : ""}`}>{icon}</span>
        <span className="op-exec-agent" title={`${entry.agentId || entry.agent || "system"} · source:${entry.source || "user"}`}>
          {(entry.agentId || entry.agent || "system").slice(0, 10)}
          <span style={{ opacity: 0.4, fontSize: 8, marginLeft: 2 }}>[{entry.source || "usr"}]</span>
        </span>
        <span className="op-exec-input" title={entry.input || entry.task || ""}>
          {entry._groupCount && (
            <span style={{ 
              background: "var(--op-border)", 
              padding: "0 4px", 
              borderRadius: 2, 
              fontSize: 7, 
              marginRight: 6, 
              verticalAlign: "middle",
              fontWeight: "bold"
            }}>
              {entry._groupCount}×
            </span>
          )}
          {expanded 
            ? (entry.input || entry.task || "—") 
            : (entry.input || entry.task || "—").slice(0, 60) + ((entry.input?.length > 60) ? "…" : "")
          }
          {((entry.input || "").includes("rm ") || (entry.input || "").includes("drop ")) && (
            <span style={{ marginLeft: 6, color: "var(--op-red)", fontWeight: "bold", fontSize: 8 }}>⚠️ DANGEROUS</span>
          )}
        </span>
        <span className="op-exec-dur" style={{ color: isAbandoned ? "var(--op-red)" : undefined }}>
          {running ? fmtDur(elapsed) : fmtDur(entry.durationMs)}
          {isStalled && !isAbandoned && <span style={{ marginLeft: 4, color: "var(--op-amber)", fontWeight: "bold" }}>⚠ STALLED</span>}
          {isAbandoned && <span style={{ marginLeft: 4, color: "var(--op-red)", fontWeight: "bold" }}>☠ ABANDONED</span>}
        </span>
        <button 
          className="op-btn secondary" 
          style={{ padding: "0 4px", fontSize: 8, height: 14, marginLeft: 6, opacity: 0.6 }}
          onClick={(e) => { e.stopPropagation(); onPopulateInput?.(entry.input || entry.task); }}
          title="Populate into Input"
        >
          ⤴
        </button>
        {isLong && <span style={{ fontSize: 8, opacity: 0.5, marginLeft: 4 }}>{expanded ? "▴" : "▾"}</span>}
      </div>
      
      {expanded && (
        <div style={{
          padding: "8px 12px",
          fontSize: "10px",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid var(--op-border)",
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: "var(--op-text2)"
        }}>
          {outStr}
        </div>
      )}
      {failed && (entry.error || entry.result?.error) && (
        <div style={{
          padding: "4px 8px 4px 76px",
          fontSize: "10px",
          color: "var(--op-red)",
          background: "rgba(255, 68, 68, 0.05)",
          borderBottom: "1px solid rgba(26,40,64,0.5)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap"
        }}>
          <div>↳ {entry.error || entry.result?.error}</div>
          <div style={{ marginTop: 4, fontStyle: "italic", opacity: 0.8, color: "var(--op-amber)" }}>
            💡 Hint: {getRecoveryHint(entry.error || entry.result?.error)}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }) {
  const cbClass = agent.cbState === "open" ? "open" : agent.cbState === "halfOpen" ? "half" : "closed";
  return (
    <div className="op-exec-entry">
      <span className="op-exec-ts" style={{ color: "var(--op-accent)" }}>{agent.id}</span>
      <span className={`op-exec-icon ${agent.active > 0 ? "run" : "ok"}`}>
        {agent.active > 0 ? "▶" : "●"}
      </span>
      <span className="op-exec-agent">{agent.capabilities?.[0] ?? "—"}</span>
      <span className="op-exec-input">
        active:{agent.active}/{agent.maxConcurrent}  ok:{agent.stats?.success}  fail:{agent.stats?.failure}
      </span>
      <span className={`op-adapter-cb ${cbClass}`}>{agent.cbState}</span>
    </div>
  );
}

export default function ExecLogPanel({ history, rtStatus, ops, onPopulateInput, lastCheck }) {
  const logRef  = useRef(null);
  const prevLen = useRef(0);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filteredHistory = useMemo(() => {
    let list = history.filter(e => {
        if (search && !(e.input?.toLowerCase().includes(search.toLowerCase()) || e.task?.toLowerCase().includes(search.toLowerCase()))) return false;
      if (filter === "all") return true;
      if (filter === "running") return e.status === "running" || e.status === "pending";
      if (filter === "failed")  return e.status === "failed"  || e.status === "error";
      if (filter === "success") return e.status === "success" || e.status === "completed";
      return true;
    });

    // ── History Compression Logic ──────────────────────────────────────────
    // Group consecutive identical successful tasks to reduce entropy.
    const compressed = [];
    let group = null;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const isRepeatable = (e.status === "success" || e.status === "completed") && !e._new;
      
      if (isRepeatable && group && group.input === e.input && group.agentId === e.agentId) {
        group.count++;
        group.ids.push(e.id || e.ts);
      } else {
        if (group && group.count > 1) {
          compressed.push({ ...group.lead, _groupCount: group.count, _groupIds: group.ids });
        } else if (group) {
          compressed.push(group.lead);
        }
        
        if (isRepeatable) {
          group = { input: e.input, agentId: e.agentId, lead: e, count: 1, ids: [e.id || e.ts] };
        } else {
          compressed.push(e);
          group = null;
        }
      }
    }
    if (group && group.count > 1) {
      compressed.push({ ...group.lead, _groupCount: group.count, _groupIds: group.ids });
    } else if (group) {
      compressed.push(group.lead);
    }

    return compressed;
  }, [history, filter, search]);

  useEffect(() => {
    if (!logRef.current) return;
    if (filteredHistory.length > prevLen.current && logRef.current.scrollTop < 80) {
      logRef.current.scrollTop = 0;
    }
    prevLen.current = filteredHistory.length;
  }, [filteredHistory]);

  const stats = useMemo(() => {
    const last20 = history.slice(0, 20);
    const failed = last20.filter(e => e.status === "failed" || e.status === "error");
    const success = last20.filter(e => e.status === "success" || e.status === "completed");
    
    // Find most failing command
    const counts = {};
    failed.forEach(e => {
      const cmd = (e.input || e.task || "unknown").slice(0, 20);
      counts[cmd] = (counts[cmd] || 0) + 1;
    });
    const topFail = Object.entries(counts).sort((a,b) => b[1] - a[1])[0]?.[0];

    return {
      rate: last20.length ? Math.round((success.length / last20.length) * 100) : 100,
      failCount: failed.length,
      topFail
    };
  }, [history]);

  const priorityTasks = useMemo(() => {
    const now = Date.now();
    // 1. Running & Pending (Active)
    const active = history.filter(e => e.status === "running" || e.status === "pending");
    
    // 2. Failed (Last 5)
    const failed = history.filter(e => e.status === "failed" || e.status === "error").slice(0, 5);
    
    // 3. Dangerous & Recovery (Persistent for 2m)
    const persistent = history.filter(e => {
      if (e.status === "running" || e.status === "pending") return false;
      const isDangerous = (e.input || "").includes("rm ") || (e.input || "").includes("drop ") || (e.input || "").includes("pm2 kill");
      const isRecovery = (e.input || "").includes("backup") || (e.input || "").includes("restart");
      if (!isDangerous && !isRecovery) return false;
      return (now - (e.timestamp || e.ts || now)) < 120000; // 2 minute persistence
    });

    // Deduplicate and Sort
    const combined = [...active, ...failed, ...persistent];
    const unique = Array.from(new Map(combined.map(t => [t.id || t.ts, t])).values());
    
    return unique.sort((a,b) => (b.timestamp || b.ts) - (a.timestamp || a.ts));
  }, [history]);

  const isIncident = stats.rate < 75;

  const agents   = rtStatus?.agents ?? [];
  const rtQueue  = rtStatus?.queue  ?? null;

  return (
    <div className="op-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="op-panel-header">
        <span className="op-panel-title">Execution Log</span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div style={{ fontSize: 9, color: stats.rate < 80 ? "var(--op-red)" : "var(--op-green)", fontWeight: "bold" }}>
            PULSE: {stats.rate}% OK
            {stats.failCount > 0 && <span style={{ marginLeft: 6, opacity: 0.8 }}>({stats.failCount} FAIL)</span>}
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button className={`op-send-btn ${filter === "all" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px" }} onClick={() => setFilter("all")}>All</button>
            <button className={`op-send-btn ${filter === "success" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px" }} onClick={() => setFilter("success")}>Success</button>
            <button className={`op-send-btn ${filter === "failed" ? "primary" : ""}`} style={{ fontSize: "9px", padding: "2px 6px" }} onClick={() => setFilter("failed")}>Failed</button>
          </div>
          <span className="op-panel-meta">
            {history.length > 0 && `${history.length} entries`}
            {rtQueue && (
              <>
                {` · queue:${rtQueue.size}`}
                {rtQueue.pulse && (Date.now() - rtQueue.pulse > 10000) && (
                  <span style={{ color: "var(--op-red)", fontWeight: "bold", marginLeft: 4 }}>⚠ QUEUE STALLED?</span>
                )}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Runtime agent overview */}
      {agents.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--op-border)", flexShrink: 0 }}>
          <div style={{ padding: "3px 6px", fontSize: 9, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.1em", background: "var(--op-bg)" }}>
            Agents
          </div>
          {agents.map(a => <AgentRow key={a.id} agent={a} />)}
        </div>
      )}

      {/* Execution history entries */}
      <div className="execlog-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', background: 'var(--op-bg)', borderBottom: '1px solid var(--op-border)' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 12 }}>
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="success">Success</option>
          </select>
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, fontSize: 12, padding: '2px 4px' }} />
        </div>
        <div
        ref={logRef}
        className="op-panel-body"
        style={{ padding: 0, flex: 1 }}
      >
        {filteredHistory.length === 0 ? (
          <div style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--op-text2)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "center"
          }}>
            <div style={{ fontSize: 24, opacity: 0.3 }}>🗒️</div>
            <div style={{ fontWeight: "bold", color: "var(--op-text)" }}>No executions yet</div>
            <div style={{ fontSize: 10, maxWidth: 200, lineHeight: 1.5 }}>
              Dispatch your first command from the Workflow center to start your operational timeline.
            </div>
            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: 4, 
              marginTop: 12, 
              fontSize: 9,
              textAlign: "left",
              background: "rgba(0,0,0,0.2)",
              padding: 10,
              borderRadius: 4,
              border: "1px solid var(--op-border)"
            }}>
              <span style={{ fontWeight: "bold", color: "var(--op-accent)", marginBottom: 4, display: "block" }}>WHERE TO START:</span>
              <span>1. Type "system health" in Workflow</span>
              <span>2. Observe the Execution Log pulse</span>
              <span>3. Check Adapter health signals</span>
            </div>
          </div>
        ) : (
          filteredHistory.map((e, i) => (
            <EntryRow 
              key={e.id || e.ts || i} 
              entry={e} 
              onPopulateInput={onPopulateInput}
              lastCheck={lastCheck}
            />
          ))
        )}
      </div>

      {/* Telemetry strip at bottom */}
      <div style={{
        borderTop: "1px solid var(--op-border)",
        background: "var(--op-surface2)",
        flexShrink: 0,
        maxHeight: 150,
        overflowY: "auto"
      }}>
        <div style={{ padding: "4px 10px", fontSize: 9, color: "var(--op-text2)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Telemetry
        </div>
        <TelemetryPanel ops={ops} />
      </div>
    </div>
  );
}
