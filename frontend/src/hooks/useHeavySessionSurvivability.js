// Phase 976-980: Heavy-session survivability + concurrent workspace coordination +
// runtime load visibility + queue resilience hardening + distributed workflow continuity.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 10 load samples, 20 queue snapshots, 30 runtime events, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const HSS_KEY   = "jarvis_heavy_session";
const LOAD_KEY  = "jarvis_runtime_load";
const QUEUE_KEY = "jarvis_queue_resilience";
const DIST_KEY  = "jarvis_dist_continuity";
const HSS_TTL   = 6  * 60 * 60 * 1000;   // 6h session window
const LOAD_MAX  = 10;
const QUEUE_MAX = 20;
const DIST_MAX  = 30;
const STALE_WIN = 6  * 60 * 60 * 1000;
const DEDUP_WIN = 5  * 60 * 1000;

// ── Phase 976: Heavy-session survivability ───────────────────────────────────

function _buildSessionSnapshot() {
  const now = Date.now();
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      id:          `hss_${now.toString(36)}`,
      ts:          now,
      expiresAt:   now + HSS_TTL,
      uptimeMs:    nav ? Math.round(performance.now()) : null,
      domNodes:    document.querySelectorAll("*").length,
      heapMb:      performance?.memory?.usedJSHeapSize
                     ? Math.round(performance.memory.usedJSHeapSize / 1048576)
                     : null,
      workflowHist: (() => {
        try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]").length; } catch { return 0; }
      })(),
      replayActive: (() => {
        try {
          const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
          return snap ? (now - (snap.ts || 0)) < STALE_WIN : false;
        } catch { return false; }
      })(),
    };
  } catch { return { id: `hss_${now.toString(36)}`, ts: now, expiresAt: now + HSS_TTL }; }
}

function _assessSessionHealth(snap) {
  const issues = [];
  if (!snap) return { healthy: true, issues };
  if (snap.heapMb && snap.heapMb > 300) issues.push("High memory usage (>300 MB heap)");
  if (snap.domNodes && snap.domNodes > 3000) issues.push(`DOM pressure: ${snap.domNodes} nodes`);
  if (snap.uptimeMs && snap.uptimeMs > 4 * 60 * 60 * 1000) issues.push("Long session (>4h) — consider refresh");
  return { healthy: issues.length === 0, issues };
}

// ── Phase 977: Concurrent workspace coordination ──────────────────────────────

const WS_COORD_MAX = 3;

function _validateWorkspaceCoord(workspaces) {
  const active = Object.entries(workspaces).filter(([, ws]) => ws.active);
  const contamination = [];

  if (active.length > WS_COORD_MAX) {
    contamination.push(`${active.length} active workspaces exceeds limit of ${WS_COORD_MAX}`);
  }

  const chains = active.map(([, ws]) => ws.activeChainId).filter(Boolean);
  if (new Set(chains).size < chains.length) {
    contamination.push("Shared chain ID detected across workspaces — dedup risk");
  }

  return { safe: contamination.length === 0, contamination };
}

// ── Phase 978: Runtime load visibility ───────────────────────────────────────

function _sampleRuntimeLoad() {
  const now = Date.now();
  try {
    const hist = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
    })();
    const recentWin = 5 * 60 * 1000;
    const recentExecs = hist.filter(h => now - (h.ts || 0) < recentWin).length;
    const running = hist.filter(h => h.status === "running" || h.status === "pending").length;
    const stalled = hist.filter(h => h.status === "running" && now - (h.ts || 0) > 60000).length;

    const queueSize = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_runtime_status") || "null")?.queue?.size || 0; }
      catch { return 0; }
    })();

    const pressure = running > 5 ? "HIGH" : running > 2 ? "MODERATE" : "LOW";
    const scalingRisk = stalled > 2 || queueSize > 15 ? "ELEVATED" : queueSize > 8 ? "MODERATE" : "LOW";

    return { ts: now, recentExecs, running, stalled, queueSize, pressure, scalingRisk };
  } catch { return { ts: now, pressure: "LOW", scalingRisk: "LOW" }; }
}

// ── Phase 979: Queue resilience hardening ────────────────────────────────────

const QUEUE_LIMITS = {
  maxSize:        25,
  staleMins:       5,
  maxRetries:      3,
};

function _assessQueueHealth(queueSize, stalledCount) {
  const violations = [];
  if (queueSize >= QUEUE_LIMITS.maxSize) violations.push(`Queue saturated: ${queueSize}/${QUEUE_LIMITS.maxSize}`);
  if (stalledCount > 0) violations.push(`${stalledCount} stalled task(s) >1min`);
  const score = Math.max(0, 100 - violations.length * 30 - Math.min(queueSize, 10) * 3);
  return {
    score,
    label: score >= 80 ? "HEALTHY" : score >= 55 ? "DEGRADED" : "CRITICAL",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    violations,
  };
}

// ── Phase 980: Distributed workflow continuity ────────────────────────────────

function _validateDistContinuity() {
  const now = Date.now();
  const issues = [];

  const waSession = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_wa_session") || "null"); } catch { return null; }
  })();
  if (waSession?.activeChainId) {
    const age = now - (waSession.ts || 0);
    if (age < DEDUP_WIN) issues.push({ type: "dedup_risk", msg: "Active chain may duplicate on reconnect" });
    if (age > STALE_WIN) issues.push({ type: "stale_chain", msg: "Active chain is stale (>6h)" });
  }

  const snapAge = (() => {
    try {
      const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
      return snap ? now - (snap.ts || 0) : null;
    } catch { return null; }
  })();
  if (snapAge !== null && snapAge > STALE_WIN) {
    issues.push({ type: "stale_replay", msg: `Replay snapshot stale (${Math.round(snapAge / 3600000)}h)` });
  }

  return { safe: issues.length === 0, issues };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useHeavySessionSurvivability() {
  const [sessionSnap,  setSessionSnap]  = useState(null);
  const [loadSamples,  setLoadSamples]  = useState([]);
  const [queueSnaps,   setQueueSnaps]   = useState([]);
  const [distEvents,   setDistEvents]   = useState([]);
  const [initialized,  setInitialized]  = useState(false);

  const sample = useCallback(() => {
    const snap = _buildSessionSnapshot();
    setSessionSnap(snap);
    _save(HSS_KEY, snap);

    const load = _sampleRuntimeLoad();
    setLoadSamples(prev => {
      const next = [load, ...prev].slice(0, LOAD_MAX);
      _save(LOAD_KEY, next);
      return next;
    });

    const queueHealth = _assessQueueHealth(load.queueSize, load.stalled);
    setQueueSnaps(prev => {
      const entry = { ts: Date.now(), ...queueHealth, queueSize: load.queueSize };
      const next  = [entry, ...prev].slice(0, QUEUE_MAX);
      _save(QUEUE_KEY, next);
      return next;
    });

    const dist = _validateDistContinuity();
    if (!dist.safe) {
      setDistEvents(prev => {
        const next = [...dist.issues.map(i => ({ ...i, ts: Date.now() })), ...prev].slice(0, DIST_MAX);
        _save(DIST_KEY, next);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const cached = _load(HSS_KEY, null);
    if (cached && Date.now() < (cached.expiresAt || 0)) setSessionSnap(cached);
    setLoadSamples(_load(LOAD_KEY, []));
    setQueueSnaps(_load(QUEUE_KEY, []));
    setDistEvents(_load(DIST_KEY, []));
    sample();
    setInitialized(true);
  }, [sample]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") sample(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sample]);

  // Workspace coordination
  const wsCoordStatus = useMemo(() => {
    const workspaces = _load("jarvis_mwc_state", { workspaces: {} })?.workspaces || {};
    return _validateWorkspaceCoord(workspaces);
  }, [loadSamples]);

  // Session health
  const sessionHealth = useMemo(() => _assessSessionHealth(sessionSnap), [sessionSnap]);

  // Latest load sample
  const currentLoad = useMemo(() => loadSamples[0] || null, [loadSamples]);

  // Latest queue health
  const queueHealth = useMemo(() => queueSnaps[0] || null, [queueSnaps]);

  // Distributed continuity
  const distContinuity = useMemo(() => _validateDistContinuity(), [loadSamples]);

  // Survivability score 0-100
  const survivabilityScore = useMemo(() => {
    let score = 100;
    if (!sessionHealth.healthy) score -= sessionHealth.issues.length * 15;
    if (!wsCoordStatus.safe)    score -= wsCoordStatus.contamination.length * 20;
    if (!distContinuity.safe)   score -= distContinuity.issues.length * 10;
    if (queueHealth?.score < 55) score -= 20;
    return Math.max(0, score);
  }, [sessionHealth, wsCoordStatus, distContinuity, queueHealth]);

  // Top resilience warning for operator bar
  const resilienceWarning = useMemo(() => {
    if (!sessionHealth.healthy) return { msg: sessionHealth.issues[0], color: "var(--op-amber)" };
    if (!wsCoordStatus.safe)    return { msg: wsCoordStatus.contamination[0], color: "var(--op-red)" };
    if (!distContinuity.safe)   return { msg: distContinuity.issues[0]?.msg, color: "var(--op-amber)" };
    if (queueHealth?.violations?.length) return { msg: queueHealth.violations[0], color: queueHealth.color };
    return null;
  }, [sessionHealth, wsCoordStatus, distContinuity, queueHealth]);

  return {
    initialized,
    sessionSnap,
    sessionHealth,
    loadSamples,
    currentLoad,
    queueSnaps,
    queueHealth,
    distEvents,
    distContinuity,
    wsCoordStatus,
    survivabilityScore,
    resilienceWarning,
    queueLimits: QUEUE_LIMITS,
    sample,
  };
}
