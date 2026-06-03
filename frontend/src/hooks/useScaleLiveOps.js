// Phase 1141-1150: Concurrent workspace coordination + live session survivability +
// production queue scaling + live collaboration + operational load balancing +
// runtime saturation handling + infrastructure resilience + multi-tenant perf hardening +
// stress validation + UX refinement.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 10 workspaces, 30 queue entries, 15 collaboration events, 20 load samples, 15 isolation events.

import { useState, useEffect, useCallback, useMemo } from "react";

const WS_COORD_KEY  = "jarvis_ws_coordination";
const QUEUE_KEY     = "jarvis_scale_queue";
const COLLAB_KEY    = "jarvis_collab_state";
const LOAD_KEY      = "jarvis_load_samples";
const SISO_KEY      = "jarvis_scale_isolation";

const WS_MAX        = 10;
const QUEUE_MAX     = 30;
const COLLAB_MAX    = 15;
const LOAD_MAX      = 20;
const SISO_MAX      = 15;

const WS_TTL        = 24 * 60 * 60 * 1000;
const QUEUE_TTL     = 4  * 60 * 60 * 1000;
const COLLAB_TTL    = 24 * 60 * 60 * 1000;
const LOAD_TTL      = 24 * 60 * 60 * 1000;
const SISO_TTL      = 24 * 60 * 60 * 1000;

// ── Phase 1141: Concurrent workspace coordination ────────────────────────────

const WS_STATES = new Set(["active", "idle", "reconnecting", "suspended"]);

function _buildWsCoord(wsId) {
  return {
    wsId,
    state:        "active",
    lastHeartbeat: Date.now(),
    replaySafe:   true,
    deployActive: false,
    queueDepth:   0,
    ts:           Date.now(),
  };
}

function _wsHealthy(ws) {
  const now = Date.now();
  // Stale if no heartbeat in 5 min
  return ws.state === "active" && now - (ws.lastHeartbeat || 0) < 5 * 60 * 1000;
}

// ── Phase 1142: Live session survivability ────────────────────────────────────

const SESSION_HEALTH_THRESHOLDS = {
  staleSecs:         300,  // 5 min idle = stale session
  maxQueueDepth:     25,
  replayGuardSecs:   60,
  maxReconnects:     5,
};

function _assessSessionSurvivability({ workspaces = [], queueDepth = 0, reconnectCount = 0, replayAgeMs = null } = {}) {
  const issues = [];
  let score = 100;

  const staleWs = workspaces.filter(w => !_wsHealthy(w)).length;
  if (staleWs > 0) {
    issues.push({ id: "stale_workspaces", msg: `${staleWs} stale workspace${staleWs > 1 ? "s" : ""}`, severity: "medium" });
    score -= staleWs * 10;
  }
  if (queueDepth > SESSION_HEALTH_THRESHOLDS.maxQueueDepth) {
    issues.push({ id: "queue_depth", msg: `Queue depth ${queueDepth}`, severity: "high" });
    score -= 20;
  }
  if (reconnectCount > SESSION_HEALTH_THRESHOLDS.maxReconnects) {
    issues.push({ id: "reconnect_storm", msg: `${reconnectCount} reconnects`, severity: "medium" });
    score -= 15;
  }
  if (replayAgeMs !== null && replayAgeMs > SESSION_HEALTH_THRESHOLDS.replayGuardSecs * 1000) {
    issues.push({ id: "stale_replay", msg: "Replay stale", severity: "low" });
    score -= 5;
  }

  score = Math.max(0, score);
  return {
    score,
    label:  score >= 80 ? "SURVIVABLE" : score >= 55 ? "DEGRADED" : "CRITICAL",
    color:  score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    issues,
  };
}

// ── Phase 1143: Production queue scaling ──────────────────────────────────────

const QUEUE_PRIORITIES = { critical: 0, high: 1, normal: 2, low: 3 };

function _buildQueueEntry({ type, priority = "normal", payload = {} }) {
  return {
    id:        `qe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    priority:  QUEUE_PRIORITIES[priority] ?? 2,
    priorityLabel: priority,
    status:    "queued",
    retries:   0,
    maxRetries: 3,
    ts:        Date.now(),
    updatedAt: Date.now(),
    payloadSize: JSON.stringify(payload).length, // size only, not content
  };
}

function _queueHealth(entries) {
  const active   = entries.filter(e => e.status === "queued" || e.status === "running");
  const stale    = active.filter(e => Date.now() - e.updatedAt > 5 * 60 * 1000);
  const critical = active.filter(e => e.priority === 0);

  if (stale.length > 3 || active.length > 20) return "saturated";
  if (critical.length > 0 || active.length > 10) return "pressured";
  return "healthy";
}

// ── Phase 1144: Live collaboration foundation ─────────────────────────────────

const COLLAB_EVENT_TYPES = new Set([
  "workspace_joined", "workspace_left", "deploy_shared",
  "replay_shared", "incident_escalated", "workflow_coordinated",
]);

function _buildCollabEvent(type, wsId, meta = {}) {
  if (!COLLAB_EVENT_TYPES.has(type)) return null;
  return {
    id:    `collab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    wsId,
    ts:    Date.now(),
    ...(typeof meta.count   === "number"  ? { count:   meta.count   } : {}),
    ...(typeof meta.success === "boolean" ? { success: meta.success } : {}),
  };
}

// ── Phase 1145: Operational load balancing ────────────────────────────────────

function _sampleLoad({ workspaceCount = 0, queueDepth = 0, activeDeployments = 0 } = {}) {
  const pressure = Math.min(100,
    Math.round(
      (queueDepth     / SESSION_HEALTH_THRESHOLDS.maxQueueDepth) * 40 +
      (workspaceCount / WS_MAX)                                  * 30 +
      (activeDeployments / 5)                                    * 30
    )
  );

  return {
    ts:              Date.now(),
    pressure,
    label:           pressure >= 80 ? "HIGH" : pressure >= 50 ? "MEDIUM" : "LOW",
    color:           pressure >= 80 ? "var(--op-red)" : pressure >= 50 ? "var(--op-amber)" : "var(--op-green)",
    workspaceCount,
    queueDepth,
    activeDeployments,
  };
}

function _buildLoadRec(loadSample) {
  if (!loadSample || loadSample.pressure < 50) return null;
  if (loadSample.queueDepth > 15)     return { area: "Queue",     rec: "Queue depth high — reduce concurrent workflow submissions" };
  if (loadSample.workspaceCount > 7)  return { area: "Workspaces",rec: "Many active workspaces — consider suspending idle ones" };
  if (loadSample.activeDeployments > 3) return { area: "Deploys",  rec: "Multiple concurrent deployments — stagger for reliability" };
  return { area: "General", rec: "System under pressure — pause non-critical operations" };
}

// ── Phase 1146: Runtime saturation handling ───────────────────────────────────

const BACKPRESSURE_LIMITS = {
  queueSoftLimit:  15,
  queueHardLimit:  25,
  workspaceSoftLimit: 7,
  workspaceHardLimit: 10,
};

function _computeBackpressure({ queueDepth = 0, workspaceCount = 0 } = {}) {
  if (queueDepth >= BACKPRESSURE_LIMITS.queueHardLimit || workspaceCount >= BACKPRESSURE_LIMITS.workspaceHardLimit) {
    return { level: "hard", shouldThrottle: true, msg: "Hard limit reached — new submissions blocked" };
  }
  if (queueDepth >= BACKPRESSURE_LIMITS.queueSoftLimit || workspaceCount >= BACKPRESSURE_LIMITS.workspaceSoftLimit) {
    return { level: "soft", shouldThrottle: false, msg: "Soft limit reached — reduce submission rate" };
  }
  return { level: "none", shouldThrottle: false, msg: null };
}

// ── Phase 1147: Infrastructure resilience ────────────────────────────────────

const SCALE_ISOLATED_PREFIXES = [
  "jarvis_ws_coordination_",
  "jarvis_scale_queue_",
  "jarvis_collab_state_",
];

function _scanScaleIsolation(activeWsId) {
  if (!activeWsId) return [];
  const violations = [];
  try {
    for (let i = 0; i < Math.min(localStorage.length, 100); i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (SCALE_ISOLATED_PREFIXES.some(p => key.startsWith(p)) && !key.endsWith(activeWsId)) {
        violations.push({ key, reason: "Cross-workspace scale state bleed" });
      }
    }
  } catch {}
  return violations.slice(0, 5);
}

// ── Phase 1148: Perf hardening — bounded scale cache ─────────────────────────

const _scaleCache = new Map();
const SCALE_CACHE_TTL = 15 * 1000; // 15s — frequent sampling context

function _cachedScale(key, compute) {
  const cached = _scaleCache.get(key);
  if (cached && Date.now() - cached.ts < SCALE_CACHE_TTL) return cached.val;
  const val = compute();
  if (_scaleCache.size > 15) {
    const oldest = [..._scaleCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _scaleCache.delete(oldest[0]);
  }
  _scaleCache.set(key, { val, ts: Date.now() });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useScaleLiveOps({
  activeDeployments = 0,
  replayAgeMs       = null,
  reconnectCount    = 0,
} = {}) {
  const [workspaces,    setWorkspaces]    = useState([]);
  const [queueEntries,  setQueueEntries]  = useState([]);
  const [collabEvents,  setCollabEvents]  = useState([]);
  const [loadSamples,   setLoadSamples]   = useState([]);
  const [isoEvents,     setIsoEvents]     = useState([]);
  const [initialized,   setInitialized]   = useState(false);

  const activeWsId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();

    // TTL-filter
    setWorkspaces(prev => {
      const next = prev.filter(w => now - (w.ts || 0) < WS_TTL).slice(0, WS_MAX);
      _save(WS_COORD_KEY, next);
      return next;
    });
    setQueueEntries(prev => {
      const next = prev.filter(e => now - (e.ts || 0) < QUEUE_TTL).slice(0, QUEUE_MAX);
      _save(QUEUE_KEY, next);
      return next;
    });
    setCollabEvents(prev => {
      const next = prev.filter(e => now - (e.ts || 0) < COLLAB_TTL).slice(0, COLLAB_MAX);
      _save(COLLAB_KEY, next);
      return next;
    });
    setLoadSamples(prev => {
      const next = prev.filter(s => now - (s.ts || 0) < LOAD_TTL).slice(0, LOAD_MAX);
      _save(LOAD_KEY, next);
      return next;
    });

    // Scale isolation scan
    const violations = _scanScaleIsolation(activeWsId);
    if (violations.length > 0) {
      setIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev].filter(e => now - (e.ts || 0) < SISO_TTL).slice(0, SISO_MAX);
        _save(SISO_KEY, next);
        return next;
      });
    }
  }, [activeWsId]);

  // Load sampling — on visibility change + evaluate
  const sampleLoad = useCallback((wsCount, qDepth) => {
    const sample = _sampleLoad({ workspaceCount: wsCount, queueDepth: qDepth, activeDeployments });
    setLoadSamples(prev => {
      const next = [sample, ...prev].filter(s => Date.now() - (s.ts || 0) < LOAD_TTL).slice(0, LOAD_MAX);
      _save(LOAD_KEY, next);
      return next;
    });
  }, [activeDeployments]);

  useEffect(() => {
    const now = Date.now();
    setWorkspaces(   _load(WS_COORD_KEY, []).filter(w => now - (w.ts  || 0) < WS_TTL));
    setQueueEntries( _load(QUEUE_KEY,    []).filter(e => now - (e.ts  || 0) < QUEUE_TTL));
    setCollabEvents( _load(COLLAB_KEY,   []).filter(e => now - (e.ts  || 0) < COLLAB_TTL));
    setLoadSamples(  _load(LOAD_KEY,     []).filter(s => now - (s.ts  || 0) < LOAD_TTL));
    setIsoEvents(    _load(SISO_KEY,     []).filter(e => now - (e.ts  || 0) < SISO_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Workspace actions (Phase 1141) ────────────────────────────────────────

  const registerWorkspace = useCallback((wsId) => {
    setWorkspaces(prev => {
      if (prev.some(w => w.wsId === wsId)) {
        // Update heartbeat
        const next = prev.map(w => w.wsId === wsId ? { ...w, lastHeartbeat: Date.now() } : w);
        _save(WS_COORD_KEY, next);
        return next;
      }
      if (prev.length >= WS_MAX) return prev; // hard limit
      const next = [_buildWsCoord(wsId), ...prev];
      _save(WS_COORD_KEY, next);
      return next;
    });
  }, []);

  const updateWorkspaceState = useCallback((wsId, updates = {}) => {
    setWorkspaces(prev => {
      const next = prev.map(w => {
        if (w.wsId !== wsId) return w;
        const newState = updates.state && WS_STATES.has(updates.state) ? updates.state : w.state;
        return { ...w, ...updates, state: newState, updatedAt: Date.now() };
      });
      _save(WS_COORD_KEY, next);
      return next;
    });
  }, []);

  // ── Queue actions (Phase 1143) ────────────────────────────────────────────

  const enqueue = useCallback(({ type, priority, payload } = {}) => {
    const entry = _buildQueueEntry({ type, priority, payload });
    setQueueEntries(prev => {
      const depth = prev.filter(e => e.status === "queued" || e.status === "running").length;
      if (depth >= BACKPRESSURE_LIMITS.queueHardLimit) return prev; // backpressure hard stop
      const next = [entry, ...prev].sort((a, b) => a.priority - b.priority).slice(0, QUEUE_MAX);
      _save(QUEUE_KEY, next);
      return next;
    });
    return entry.id;
  }, []);

  const dequeue = useCallback((entryId, success = true) => {
    setQueueEntries(prev => {
      const next = prev.map(e =>
        e.id === entryId ? { ...e, status: success ? "complete" : "failed", updatedAt: Date.now() } : e
      );
      _save(QUEUE_KEY, next);
      return next;
    });
  }, []);

  // ── Collab actions (Phase 1144) ───────────────────────────────────────────

  const recordCollab = useCallback((type, wsId, meta = {}) => {
    const evt = _buildCollabEvent(type, wsId, meta);
    if (!evt) return;
    setCollabEvents(prev => {
      const next = [evt, ...prev].filter(e => Date.now() - (e.ts || 0) < COLLAB_TTL).slice(0, COLLAB_MAX);
      _save(COLLAB_KEY, next);
      return next;
    });
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const activeWorkspaces = useMemo(() =>
    workspaces.filter(w => _wsHealthy(w)),
    [workspaces]
  );

  const queueDepth = useMemo(() =>
    queueEntries.filter(e => e.status === "queued" || e.status === "running").length,
    [queueEntries]
  );

  const currentQueueHealth = useMemo(() => _queueHealth(queueEntries), [queueEntries]);

  const sessionSurvivability = useMemo(() =>
    _cachedScale(`surv_${activeWorkspaces.length}_${queueDepth}_${reconnectCount}`,
      () => _assessSessionSurvivability({
        workspaces: activeWorkspaces, queueDepth, reconnectCount, replayAgeMs,
      })
    ),
    [activeWorkspaces.length, queueDepth, reconnectCount, replayAgeMs] // eslint-disable-line
  );

  const latestLoad = useMemo(() => loadSamples[0] || null, [loadSamples]);

  const loadRec = useMemo(() => _buildLoadRec(latestLoad), [latestLoad]);

  const backpressure = useMemo(() =>
    _computeBackpressure({ queueDepth, workspaceCount: activeWorkspaces.length }),
    [queueDepth, activeWorkspaces.length]
  );

  const recentIsoViolations = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return isoEvents.filter(e => (e.ts || 0) > cutoff).length;
  }, [isoEvents]);

  // Calm scale bar — Phase 1150: show only when pressured or survivability degraded
  const scaleBar = useMemo(() => {
    const show = sessionSurvivability.score < 80
      || backpressure.level !== "none"
      || currentQueueHealth !== "healthy"
      || recentIsoViolations > 0;
    if (!show) return null;
    return {
      survivability:  sessionSurvivability.score,
      survColor:      sessionSurvivability.color,
      survLabel:      sessionSurvivability.label,
      backpressure:   backpressure.msg,
      queueHealth:    currentQueueHealth !== "healthy" ? currentQueueHealth : null,
      isoViolations:  recentIsoViolations > 0 ? recentIsoViolations : null,
      loadRec:        loadRec?.rec || null,
      activeWs:       activeWorkspaces.length,
      queueDepth,
    };
  }, [sessionSurvivability, backpressure, currentQueueHealth, recentIsoViolations, loadRec, activeWorkspaces.length, queueDepth]);

  return {
    initialized,
    workspaces,
    queueEntries,
    collabEvents,
    loadSamples,
    isoEvents,
    // Derived
    activeWorkspaces,
    queueDepth,
    currentQueueHealth,
    sessionSurvivability,
    latestLoad,
    loadRec,
    backpressure,
    scaleBar,
    // Actions
    registerWorkspace,
    updateWorkspaceState,
    enqueue,
    dequeue,
    recordCollab,
    sampleLoad,
    evaluate,
  };
}
