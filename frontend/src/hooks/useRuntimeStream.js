import { useState, useEffect, useCallback, useRef } from 'react';
import { BASE_URL, getOpsData, getTasks, getRuntimeStatus, getRuntimeHistory } from '../api';

const POLL_OPS_MS = 10000; // Relaxed from 6000
const POLL_RT_MS = 15000;  // Relaxed from 8000
const POLL_HIST_MS = 10000; // Relaxed from 5000
const SSE_BACKOFF = [1000, 2000, 4000, 8000, 30000];

/**
 * useRuntimeStream - Scoped hook for high-throughput operational data.
 * Optimized for long-session stability and minimal render churn.
 */
export function useRuntimeStream() {
  const [ops, setOps] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [rtStatus, setRtStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastExec, setLastExec] = useState(null);
  
  // Connection state
  const [connectionState, setConnectionState] = useState("connecting");
  const [streamMeta, setStreamMeta] = useState({ lastBeat: null, retryCount: 0, retryDelayMs: 0 });
  const [fetchErrors, setFetchErrors] = useState({});
  const [authError, setAuthError] = useState(null);
  const [sseWarning, setSseWarning] = useState(null);

  const sseRef = useRef(null);
  const pollRefs = useRef({});
  const sseRetryCount = useRef(0);
  const sseRetryTimer = useRef(null);
  
  // High-frequency buffers
  const historyBuffer = useRef([]);
  const historyFlushTimer = useRef(null);
  const seenEntries = useRef(new Set());

  // ── History Throttling ──────────────────────────────────────────
  const flushHistory = useCallback(() => {
    if (historyBuffer.current.length === 0) return;
    
    setHistory(prev => {
      let newBatch = historyBuffer.current;
      historyBuffer.current = [];
      
      const existingIds = new Set(prev.map(e => e.id || e.seq).filter(Boolean));
      newBatch = newBatch.filter(e => !existingIds.has(e.id || e.seq));
      
      if (newBatch.length === 0) return prev;
      // Reverse order: newest at top
      const combined = [...newBatch, ...prev];
      return combined.slice(0, 300); // Expanded slightly for better historical view
    });
  }, []);

  const queueExecEntry = useCallback((entry) => {
    const id = entry.id || entry.seq;
    if (seenEntries.current.has(id)) return;
    
    seenEntries.current.add(id);
    if (seenEntries.current.size > 800) {
      const arr = Array.from(seenEntries.current);
      seenEntries.current = new Set(arr.slice(-500));
    }

    historyBuffer.current.push({ ...entry, _new: true });
    
    if (!historyFlushTimer.current) {
      historyFlushTimer.current = setTimeout(() => {
        flushHistory();
        historyFlushTimer.current = null;
      }, 150); // Slightly more relaxed flush
    }
  }, [flushHistory]);

  const classifyAuthErr = useCallback((err) => {
    const status = err?.status;
    const msg = (err?.message || "").toLowerCase();
    if (status === 401 || msg.includes("unauthorized") || msg.includes("expired")) {
      setAuthError("expired");
    } else if (status === 503 || msg.includes("not configured")) {
      setAuthError("unconfigured");
    }
  }, []);

  // ── Fetchers ───────────────────────────────────────────────────
  const fetchOps = useCallback(async () => {
    try {
      const o = await getOpsData();
      if (o) { setOps(o); setFetchErrors(e => ({ ...e, ops: null })); setAuthError(null); }
    } catch (err) {
      setFetchErrors(e => ({ ...e, ops: err.message }));
      classifyAuthErr(err);
    }
  }, [classifyAuthErr]);

  const fetchTasks = useCallback(async () => {
    try {
      const t = await getTasks();
      if (t) { setTasks(t); setFetchErrors(e => ({ ...e, tasks: null })); }
    } catch (err) {
      setFetchErrors(e => ({ ...e, tasks: err.message }));
      classifyAuthErr(err);
    }
  }, [classifyAuthErr]);

  const fetchRt = useCallback(async () => {
    try {
      const r = await getRuntimeStatus();
      if (r) { setRtStatus(r); setFetchErrors(e => ({ ...e, rt: null })); setAuthError(null); }
    } catch (err) {
      setFetchErrors(e => ({ ...e, rt: err.message }));
      classifyAuthErr(err);
    }
  }, [classifyAuthErr]);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await getRuntimeHistory(60);
      if (!r?.entries) return;
      setFetchErrors(e => ({ ...e, history: null }));
      r.entries.forEach(e => seenEntries.current.add(e.id || e.seq));
      setHistory(r.entries.map(e => ({ ...e, _new: false })));
    } catch (err) {
      setFetchErrors(e => ({ ...e, history: err.message }));
    }
  }, []);

  // ── SSE Lifecycle ──────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }

    let es;
    try {
      es = new EventSource(`${BASE_URL}/runtime/stream`, { withCredentials: true });
    } catch (err) {
      setConnectionState("degraded");
      return;
    }
    sseRef.current = es;

    es.addEventListener("connected", () => {
      setConnectionState("connected");
      setStreamMeta({ lastBeat: Date.now(), retryCount: 0, retryDelayMs: 0 });
      sseRetryCount.current = 0;
      
      // Stop history polling during SSE active session
      if (pollRefs.current.hist) {
        clearInterval(pollRefs.current.hist);
        pollRefs.current.hist = null;
      }
    });

    es.addEventListener("execution", (e) => {
      try {
        const d = JSON.parse(e.data);
        queueExecEntry(d);
        if (["success", "completed", "failed", "error"].includes(d.status)) {
          setLastExec({ status: d.status, input: (d.input || d.task || "").slice(0, 40), ts: Date.now() });
        }
      } catch {}
    });

    es.addEventListener("task:added", fetchTasks);
    es.addEventListener("task:updated", fetchTasks);

    es.addEventListener("telemetry", (e) => {
      try {
        const d = JSON.parse(e.data);
        setOps(prev => prev ? { ...prev, ...d } : d);
      } catch {}
    });

    es.addEventListener("heartbeat", () => {
      setConnectionState("connected");
      // Throttle heartbeat metadata updates to once every 10s to save console rerenders
      setStreamMeta(s => {
        if (s.lastBeat && Date.now() - s.lastBeat < 10000) return s;
        return { ...s, lastBeat: Date.now() };
      });
    });

    es.addEventListener("jwt_expiry_warning", () => setSseWarning("expiring_soon"));

    es.onerror = () => {
      setConnectionState("reconnecting");
      es.close();
      sseRef.current = null;

      // Restore fallback polling
      if (!pollRefs.current.hist) pollRefs.current.hist = setInterval(fetchHistory, POLL_HIST_MS);
      if (!pollRefs.current.ops) pollRefs.current.ops = setInterval(() => { fetchOps(); fetchTasks(); }, POLL_OPS_MS);

      clearTimeout(sseRetryTimer.current);
      const delay = SSE_BACKOFF[Math.min(sseRetryCount.current, SSE_BACKOFF.length - 1)];
      sseRetryCount.current++;
      setStreamMeta(s => ({ ...s, retryCount: sseRetryCount.current, retryDelayMs: delay }));
      
      if (sseRetryCount.current >= SSE_BACKOFF.length) setConnectionState("offline");
      sseRetryTimer.current = setTimeout(connectSSE, delay);
    };
  }, [fetchOps, fetchTasks, fetchHistory, queueExecEntry]);

  // ── Lifecycles ─────────────────────────────────────────────────
  useEffect(() => {
    fetchOps(); fetchTasks(); fetchRt(); fetchHistory();
    pollRefs.current.ops = setInterval(() => { fetchOps(); fetchTasks(); }, POLL_OPS_MS);
    pollRefs.current.rt = setInterval(fetchRt, POLL_RT_MS);
    pollRefs.current.hist = setInterval(fetchHistory, POLL_HIST_MS);

    connectSSE();

    return () => {
      Object.values(pollRefs.current).forEach(t => t && clearInterval(t));
      pollRefs.current = {};
      clearTimeout(sseRetryTimer.current);
      if (historyFlushTimer.current) clearTimeout(historyFlushTimer.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, [fetchOps, fetchTasks, fetchRt, fetchHistory, connectSSE]);

  return {
    connectionState,
    streamMeta,
    authError,
    sseWarning,
    fetchErrors,
    forceRefresh: () => { fetchOps(); fetchTasks(); },
    dismissWarning: () => setSseWarning(null),
    data: { ops, tasks, rtStatus, history, lastExec }
  };
}
