import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch } from "../_client";

// Severity badge colour — reuses existing design token naming pattern
const SEV_COLOR = { INFO: "#4caf50", WARN: "#ff9800", ERROR: "#f44336", CRITICAL: "#9c27b0" };
const CAT_ICON = {
  git: "⎇", filesystem: "📄", pm2: "⚙", logs: "📋", build: "🔨",
  tests: "✓", tasks: "↺", missions: "◎", agents: "⬡", plugins: "🔌",
  extensions: "⚡", memory: "◈", ai: "✦", system: "⊞", observer: "◉",
};

function SevBadge({ severity }) {
  return (
    <span style={{ color: SEV_COLOR[severity] || "#888", fontWeight: 600, fontSize: 11,
      padding: "1px 6px", borderRadius: 4, border: `1px solid ${SEV_COLOR[severity] || "#888"}`,
      marginRight: 6, display: "inline-block", lineHeight: "16px" }}>
      {severity}
    </span>
  );
}

function SourceRow({ src }) {
  const dot = src.status === "healthy" ? "#4caf50"
    : src.status === "degraded" ? "#ff9800"
    : src.status === "error"    ? "#f44336"
    : "#888";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
      borderBottom: "1px solid #1e1e1e", fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, color: "#ccc" }}>{CAT_ICON[src.name] || "·"} {src.name}</span>
      <span style={{ color: "#666", fontSize: 11 }}>
        {src.intervalMs ? `${src.intervalMs / 1000}s` : "event"}
      </span>
      <span style={{ color: "#666", fontSize: 11, minWidth: 40, textAlign: "right" }}>
        {src.runCount || 0} runs
      </span>
      {src.lastError && (
        <span style={{ color: "#f44336", fontSize: 10, maxWidth: 120, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={src.lastError}>
          {src.lastError}
        </span>
      )}
    </div>
  );
}

function EventRow({ ev }) {
  const [expanded, setExpanded] = useState(false);
  const ts = new Date(ev.timestamp).toLocaleTimeString("en-US", { hour12: false });
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", padding: "4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ color: "#444", fontSize: 10, minWidth: 60, fontVariantNumeric: "tabular-nums" }}>{ts}</span>
        <SevBadge severity={ev.severity} />
        <span style={{ color: "#888", fontSize: 11, minWidth: 80 }}>{CAT_ICON[ev.category] || "·"} {ev.source}</span>
        <span style={{ color: "#ccc", fontSize: 12, flex: 1, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "#aaa" }}>{ev.entity}</span>
          {" — "}
          {ev.action.replace(/_/g, " ")}
        </span>
        <span style={{ color: "#555", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <pre style={{ margin: "4px 0 4px 66px", padding: 8, background: "#111",
          borderRadius: 4, fontSize: 10, color: "#888", overflow: "auto", maxHeight: 120,
          whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {JSON.stringify(ev.metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function RuntimeObserverPanel() {
  const [tab, setTab]         = useState("events");
  const [status, setStatus]   = useState(null);
  const [events, setEvents]   = useState([]);
  const [stats, setStats]     = useState(null);
  const [sources, setSources] = useState([]);
  const [health, setHealth]   = useState(null);
  const [filter, setFilter]   = useState({ category: "", severity: "", source: "" });
  const [error, setError]     = useState(null);
  const pollRef               = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [st, ev, sta, src, hlt] = await Promise.all([
        _fetch("/runtime/observer/status"),
        _fetch(`/runtime/observer/events?limit=200${filter.category ? `&category=${filter.category}` : ""}${filter.severity ? `&severity=${filter.severity}` : ""}${filter.source ? `&source=${filter.source}` : ""}`),
        _fetch("/runtime/observer/statistics"),
        _fetch("/runtime/observer/sources"),
        _fetch("/runtime/observer/health"),
      ]);
      if (st?.success)  setStatus(st);
      if (ev?.success)  setEvents((ev.events || []).slice().reverse());
      if (sta?.success) setStats(sta);
      if (src?.success) setSources(src.sources || []);
      if (hlt?.success) setHealth(hlt);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [filter]);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 10_000);
    return () => clearInterval(pollRef.current);
  }, [fetchAll]);

  const tabStyle = (t) => ({
    padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500,
    color: tab === t ? "#fff" : "#666",
    borderBottom: tab === t ? "2px solid #4caf50" : "2px solid transparent",
    background: "none", border: "none", borderBottom: tab === t ? "2px solid #4caf50" : "2px solid transparent",
  });

  if (error) return (
    <div style={{ padding: 16, color: "#f44336", fontSize: 12 }}>
      Observer unavailable: {error}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d0d0d", color: "#ccc", fontFamily: "monospace" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px",
        borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span style={{ color: "#4caf50", fontWeight: 700, fontSize: 13 }}>◉ Runtime Observer</span>
        {status && (
          <>
            <span style={{ color: "#555", fontSize: 11 }}>
              {status.running ? <span style={{ color: "#4caf50" }}>● live</span> : <span style={{ color: "#f44336" }}>● stopped</span>}
            </span>
            <span style={{ color: "#555", fontSize: 11 }}>
              {status.sourceCount} sources · {status.eventCount} events · uptime {Math.floor((status.uptimeSec || 0) / 60)}m
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={fetchAll} style={{ background: "#1e1e1e", border: "1px solid #333", color: "#888",
          borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>↻ refresh</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        {["events", "sources", "health", "statistics"].map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {tab === "events" && (
          <>
            {/* Filters */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {[["category", "Category"], ["severity", "Severity"], ["source", "Source"]].map(([key, label]) => (
                <input key={key} placeholder={label} value={filter[key]}
                  onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}
                  style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ccc",
                    borderRadius: 4, padding: "3px 8px", fontSize: 11, width: 100 }} />
              ))}
              <span style={{ color: "#555", fontSize: 11, lineHeight: "26px" }}>{events.length} events</span>
            </div>
            {events.length === 0 && <div style={{ color: "#555", fontSize: 12, padding: "20px 0" }}>No events yet — observer starting…</div>}
            {events.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </>
        )}

        {tab === "sources" && (
          <>
            <div style={{ color: "#555", fontSize: 11, marginBottom: 8 }}>{sources.length} sources registered</div>
            {sources.map(s => <SourceRow key={s.name} src={s} />)}
          </>
        )}

        {tab === "health" && health && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ color: health.healthy ? "#4caf50" : "#f44336", fontSize: 18 }}>
                {health.healthy ? "✓" : "✗"}
              </span>
              <span style={{ color: "#ccc", fontSize: 14 }}>
                {health.healthy ? "All sources healthy" : "Degraded sources detected"}
              </span>
            </div>
            {Object.entries(health.sources || {}).map(([name, s]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
                borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: s.status === "healthy" ? "#4caf50" : s.status === "degraded" ? "#ff9800" : "#f44336" }} />
                <span style={{ flex: 1, color: "#ccc" }}>{CAT_ICON[name] || "·"} {name}</span>
                <span style={{ color: "#666", fontSize: 11 }}>{s.errorCount} errors</span>
                <span style={{ color: "#555", fontSize: 10 }}>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "statistics" && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ color: "#666", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Throughput</div>
              {[
                ["Total emitted", stats.totalEmitted],
                ["Per minute", stats.throughputPerMin],
                ["Dedup hits", stats.dedupHits],
                ["Ring fill", `${stats.ringFill} / 1000`],
                ["Uptime", `${Math.floor((stats.uptimeSec || 0) / 60)}m`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0",
                  borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: "#888" }}>{k}</span>
                  <span style={{ color: "#ccc" }}>{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ color: "#666", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>By Severity</div>
              {Object.entries(stats.bySeverity || {}).map(([sev, count]) => (
                <div key={sev} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0",
                  borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: SEV_COLOR[sev] || "#888" }}>{sev}</span>
                  <span style={{ color: "#ccc" }}>{count}</span>
                </div>
              ))}
              <div style={{ color: "#666", fontSize: 11, marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>By Category</div>
              {Object.entries(stats.byCategory || {}).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0",
                  borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: "#888" }}>{CAT_ICON[cat] || "·"} {cat}</span>
                  <span style={{ color: "#ccc" }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
