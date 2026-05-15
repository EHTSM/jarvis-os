import React, { useState, useEffect, useCallback, useRef } from "react";
import { BASE_URL, getOpsData, getTasks, getRuntimeStatus, getRuntimeHistory } from "../../api";
import TaskQueuePanel  from "./TaskQueuePanel";
import ExecLogPanel    from "./ExecLogPanel";
import AIConsolePanel  from "./AIConsolePanel";
import AdapterPanel    from "./AdapterPanel";
import TelemetryPanel  from "./TelemetryPanel";
import WorkflowPanel   from "./WorkflowPanel";
import GovernorPanel   from "./GovernorPanel";
import ErrorBoundary   from "../ErrorBoundary";
import "./operator.css";

// ── Fallback polling intervals (active when SSE is disconnected) ───
const POLL_OPS_MS    = 6_000;   // ops + tasks (fast fallback)
const POLL_RT_MS     = 8_000;   // runtime status
const POLL_HIST_MS   = 5_000;   // execution history

// ── SSE reconnect backoff ──────────────────────────────────────────
const SSE_BACKOFF    = [1000, 2000, 4000, 8000, 30_000];

function fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function OperatorConsole() {
  const [ops,       setOps]       = useState(null);
  const [tasks,     setTasks]     = useState(null);
  const [rtStatus,  setRtStatus]  = useState(null);
  const [history,   setHistory]   = useState([]);
  const [stream,    setStream]    = useState({ connected: false, lastBeat: null, replayCount: 0, retryCount: 0, retryDelayMs: 0 });
  const [fetchErrors, setFetchErrors] = useState({});

  // Track seen entry IDs for new-entry flash animation
  const seenEntries   = useRef(new Set());
  const sseRef        = useRef(null);    // EventSource instance
  const sseRetryCount = useRef(0);
  const sseRetryTimer = useRef(null);
  const pollRefs      = useRef({});      // interval handles for fallback polling

  // ── Helpers ────────────────────────────────────────────────────
  const markNew = useCallback((entry) => {
    const isNew = !seenEntries.current.has(entry.id || entry.seq);
    if (isNew) {
      seenEntries.current.add(entry.id || entry.seq);
      if (seenEntries.current.size > 600) {
        const arr = [...seenEntries.current];
        seenEntries.current = new Set(arr.slice(-500));
      }
    }
    return isNew;
  }, []);

  const prependExec = useCallback((entry) => {
    setHistory(prev => {
      const isNew = markNew(entry);
      const enriched = { ...entry, _new: isNew };
      // De-duplicate by id/seq — SSE replay may resend recent entries
      const exists = prev.some(e => (e.id && e.id === entry.id) || (e.seq && e.seq === entry.seq));
      if (exists) return prev;
      return [enriched, ...prev.slice(0, 199)];
    });
  }, [markNew]);

  // ── Fallback fetchers ──────────────────────────────────────────
  const fetchOps = useCallback(async () => {
    try {
      const o = await getOpsData();
      if (o) { setOps(o); setFetchErrors(e => ({ ...e, ops: null })); }
    } catch (err) {
      setFetchErrors(e => ({ ...e, ops: err.message }));
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const t = await getTasks();
      if (t) { setTasks(t); setFetchErrors(e => ({ ...e, tasks: null })); }
    } catch (err) {
      setFetchErrors(e => ({ ...e, tasks: err.message }));
    }
  }, []);

  const fetchRt = useCallback(async () => {
    try {
      const r = await getRuntimeStatus();
      if (r) { setRtStatus(r); setFetchErrors(e => ({ ...e, rt: null })); }
    } catch (err) {
      setFetchErrors(e => ({ ...e, rt: err.message }));
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await getRuntimeHistory(60);
      if (!r?.entries) return;
      setFetchErrors(e => ({ ...e, history: null }));
      // Bulk-load without animation for initial/fallback hydration
      r.entries.forEach(e => {
        if (!seenEntries.current.has(e.id || e.seq)) {
          seenEntries.current.add(e.id || e.seq);
        }
      });
      setHistory(r.entries.map(e => ({ ...e, _new: false })));
    } catch (err) {
      setFetchErrors(e => ({ ...e, history: err.message }));
    }
  }, []);

  // ── SSE connection ─────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    // Don't open a second connection
    if (sseRef.current && sseRef.current.readyState !== 2 /* CLOSED */) return;

    const url = `${BASE_URL}/runtime/stream`;
    let es;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      // EventSource not available — stay in polling mode
      return;
    }
    sseRef.current = es;

    // ── Connection established ─────────────────────────────────
    es.addEventListener("connected", (e) => {
      try {
        const d = JSON.parse(e.data);
        setStream({ connected: true, lastBeat: Date.now(), replayCount: d.replayCount ?? 0, retryCount: 0, retryDelayMs: 0 });
        sseRetryCount.current = 0;
        // Stop heavy fallback polling now that SSE is live
        clearInterval(pollRefs.current.hist);
        pollRefs.current.hist = null;
        // Keep a slow ops+tasks poll as insurance (every 15s)
        clearInterval(pollRefs.current.ops);
        pollRefs.current.ops = setInterval(() => { fetchOps(); fetchTasks(); }, 15_000);
      } catch {}
    });

    // ── Execution events ───────────────────────────────────────
    es.addEventListener("execution", (e) => {
      try { prependExec(JSON.parse(e.data)); } catch {}
    });

    // ── Task lifecycle ─────────────────────────────────────────
    es.addEventListener("task:added",   () => { fetchTasks(); });
    es.addEventListener("task:updated", () => { fetchTasks(); });

    // ── Telemetry snapshot ─────────────────────────────────────
    es.addEventListener("telemetry", (e) => {
      try {
        const d = JSON.parse(e.data);
        // Merge into ops: preserve fields SSE doesn't send (crm, requests, etc.)
        setOps(prev => prev ? { ...prev, memory: d.memory, errors: d.errors, queue: d.queue } : d);
      } catch {}
    });

    // ── Heartbeat ──────────────────────────────────────────────
    es.addEventListener("heartbeat", () => {
      setStream(s => ({ ...s, connected: true, lastBeat: Date.now() }));
    });

    // ── Warning ────────────────────────────────────────────────
    es.addEventListener("warning", (e) => {
      try {
        const d = JSON.parse(e.data);
        setOps(prev => prev ? { ...prev, warnings: [...(prev.warnings ?? []), d] } : null);
      } catch {}
    });

    // ── SSE error + reconnect backoff ──────────────────────────
    es.onerror = () => {
      setStream(s => ({ ...s, connected: false }));
      es.close();
      sseRef.current = null;

      // Restart full polling while disconnected
      if (!pollRefs.current.hist) {
        pollRefs.current.hist = setInterval(fetchHistory, POLL_HIST_MS);
      }
      if (!pollRefs.current.ops) {
        pollRefs.current.ops = setInterval(() => { fetchOps(); fetchTasks(); }, POLL_OPS_MS);
      }

      // Schedule reconnect with exponential backoff
      clearTimeout(sseRetryTimer.current);
      const delay = SSE_BACKOFF[Math.min(sseRetryCount.current, SSE_BACKOFF.length - 1)];
      sseRetryCount.current++;
      setStream(s => ({ ...s, retryCount: sseRetryCount.current, retryDelayMs: delay }));
      sseRetryTimer.current = setTimeout(connectSSE, delay);
    };
  }, [fetchOps, fetchTasks, fetchHistory, prependExec]);

  // ── Bootstrap: initial data load + connect SSE ────────────────
  useEffect(() => {
    // Immediate initial loads so UI isn't blank
    fetchOps();
    fetchTasks();
    fetchRt();
    fetchHistory();

    // Start fallback polling (will be throttled once SSE connects)
    pollRefs.current.ops  = setInterval(() => { fetchOps(); fetchTasks(); }, POLL_OPS_MS);
    pollRefs.current.rt   = setInterval(fetchRt,   POLL_RT_MS);
    pollRefs.current.hist = setInterval(fetchHistory, POLL_HIST_MS);

    // Connect SSE
    connectSSE();

    return () => {
      // Full cleanup on unmount
      Object.values(pollRefs.current).forEach(t => t && clearInterval(t));
      pollRefs.current = {};
      clearTimeout(sseRetryTimer.current);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    };
  }, []); // eslint-disable-line

  // ── Force refresh callback (used by WorkflowPanel after dispatch) ─
  const handleRefresh = useCallback(() => {
    fetchOps();
    fetchTasks();
  }, [fetchOps, fetchTasks]);

  // ── Derived display values ─────────────────────────────────────
  const status   = ops?.status ?? "unknown";
  const heapMb   = ops?.memory?.current?.heap_mb ?? "—";
  const rssMb    = ops?.memory?.current?.rss_mb  ?? "—";
  const uptime   = fmtUptime(ops?.uptime?.seconds);
  const warnings = ops?.warnings ?? [];
  const errRate  = ops?.errors?.errors_per_hour ?? 0;
  const qCounts  = ops?.queue?.counts ?? {};
  const pending  = qCounts.pending ?? 0;
  const running  = qCounts.running ?? 0;

  const statusClass = status === "ok" ? "ok" : status === "degraded" ? "warn" : "crit";

  // Stream age: "Live", "Xm ago", or "—"
  const streamAge = (() => {
    if (!stream.lastBeat) return "—";
    const secs = Math.floor((Date.now() - stream.lastBeat) / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m`;
  })();

  return (
    <div className="operator-console">
      {/* ── Status Bar ─────────────────────────────────────────── */}
      <div className="op-statusbar">
        <div
          className={`op-pulse ${stream.connected ? "" : "offline"}`}
          title={stream.connected ? `Live stream · beat ${streamAge} ago` : "Stream offline — polling fallback active"}
        />
        <span className="op-statusbar-brand">JARVIS OS</span>

        {/* Stream indicator */}
        <div className="op-stat">
          <span className="op-stat-label">Stream</span>
          <span
            className={`op-stat-value ${stream.connected ? "ok" : "warn"}`}
            title={!stream.connected && stream.retryCount > 0
              ? `Reconnect attempt ${stream.retryCount} — next in ${Math.round(stream.retryDelayMs / 1000)}s`
              : undefined}
          >
            {stream.connected ? "SSE" : `POLL #${stream.retryCount || 0}`}
          </span>
        </div>

        {/* Fetch error indicator */}
        {Object.values(fetchErrors).some(Boolean) && (
          <div className="op-stat" title={Object.entries(fetchErrors).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(" | ")}>
            <span className="op-stat-value crit">⚠ fetch</span>
          </div>
        )}
        <div className="op-statusbar-sep" />

        <div className="op-stat">
          <span className="op-stat-label">Status</span>
          <span className={`op-stat-value ${statusClass}`}>{status.toUpperCase()}</span>
        </div>
        <div className="op-statusbar-sep" />

        <div className="op-stat">
          <span className="op-stat-label">Heap</span>
          <span className={`op-stat-value ${ops?.memory?.critical ? "crit" : ops?.memory?.warn ? "warn" : ""}`}>
            {heapMb}MB
          </span>
        </div>

        <div className="op-stat">
          <span className="op-stat-label">RSS</span>
          <span className="op-stat-value dim">{rssMb}MB</span>
        </div>
        <div className="op-statusbar-sep" />

        <div className="op-stat">
          <span className="op-stat-label">Uptime</span>
          <span className="op-stat-value dim">{uptime}</span>
        </div>
        <div className="op-statusbar-sep" />

        <div className="op-stat">
          <span className="op-stat-label">Queue</span>
          <span className={`op-stat-value ${pending > 10 ? "warn" : ""}`}>
            {pending}p / {running}r
          </span>
        </div>

        <div className="op-stat">
          <span className="op-stat-label">Err/hr</span>
          <span className={`op-stat-value ${errRate > 10 ? "crit" : errRate > 0 ? "warn" : "ok"}`}>
            {errRate}
          </span>
        </div>

        <div className="op-statusbar-warnings">
          {warnings.slice(0, 3).map((w, i) => (
            <span key={i} className={`op-warn-badge ${w.level === "critical" ? "crit" : ""}`}>
              {w.code}
            </span>
          ))}
        </div>
      </div>

      {/* ── Main Grid ────────────────────────────────────────────── */}
      <div className="op-grid">

        {/* Col 1 top: Task Queue */}
        <div className="op-col-left">
          <ErrorBoundary label="TaskQueue">
            <TaskQueuePanel tasks={tasks} />
          </ErrorBoundary>
        </div>

        {/* Col 2 (spans both rows): Execution Log + Telemetry */}
        <div className="op-col-mid">
          <ErrorBoundary label="ExecLog">
            <ExecLogPanel history={history} rtStatus={rtStatus} ops={ops} />
          </ErrorBoundary>
        </div>

        {/* Col 3 (spans both rows): AI Console + Workflow + Governor */}
        <div className="op-col-right" style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
          <ErrorBoundary label="AIConsole">
            <AIConsolePanel style={{ flex: "1 1 0", minHeight: 0 }} />
          </ErrorBoundary>
          <ErrorBoundary label="Workflow">
            <WorkflowPanel  onRefresh={handleRefresh} />
          </ErrorBoundary>
          <ErrorBoundary label="Governor">
            <GovernorPanel  ops={ops} onRefresh={handleRefresh} />
          </ErrorBoundary>
        </div>

        {/* Col 1 bottom: Adapters + Services */}
        <div className="op-col-left-bot">
          <ErrorBoundary label="Adapters">
            <AdapterPanel rtStatus={rtStatus} services={ops?.services} />
          </ErrorBoundary>
        </div>

      </div>
    </div>
  );
}
