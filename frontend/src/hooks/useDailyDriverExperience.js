// Phase 1051-1058: Keyboard-first productivity + rapid debugging + workspace persistence polish +
// execution acceleration + contextual engineering assistance + session continuity refinement +
// operational smoothness evolution + productivity observability.
//
// Consolidates eight phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 shortcuts, 15 assistance records, 50 smoothness events, 20 productivity snapshots, 30d retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const DD_KEY     = "jarvis_daily_driver";
const ASSIST_KEY = "jarvis_dd_assistance";
const SMOOTH_KEY = "jarvis_op_smoothness";
const PROD_OBS_KEY = "jarvis_dd_prod_obs";
const ASSIST_MAX = 15;
const SMOOTH_MAX = 50;
const PROD_OBS_MAX = 20;
const DD_TTL     = 30 * 24 * 60 * 60 * 1000;
const SMOOTH_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1051: Keyboard-first productivity ───────────────────────────────────

// Core operator shortcuts — bounded, replay-safe, no autonomous execution
const CORE_SHORTCUTS = [
  { id: "palette",       keys: "⌘K",     label: "Command palette",          category: "navigation" },
  { id: "focus_mode",    keys: "⌘F",     label: "Focus mode toggle",        category: "navigation" },
  { id: "pm2_status",    keys: null,      label: "pm2 status",               category: "debug",   cmd: "pm2 status" },
  { id: "pm2_logs",      keys: null,      label: "pm2 logs --lines 50",      category: "debug",   cmd: "pm2 logs --lines 50" },
  { id: "health_check",  keys: null,      label: "Health check",             category: "debug",   cmd: "curl -s localhost:3001/health | jq ." },
  { id: "git_status",    keys: null,      label: "git status",               category: "deploy",  cmd: "git status --short" },
  { id: "git_log",       keys: null,      label: "git log (recent)",         category: "deploy",  cmd: "git log --oneline -10" },
  { id: "deploy_check",  keys: null,      label: "Deploy readiness",         category: "deploy",  cmd: "npm run build 2>&1 | tail -5" },
  { id: "queue_check",   keys: null,      label: "Queue status",             category: "debug",   cmd: "cat /tmp/jarvis-queue.json 2>/dev/null | jq ." },
  { id: "disk_check",    keys: null,      label: "Disk usage",               category: "infra",   cmd: "df -h | head -5" },
];

function _getContextualShortcuts(trustScore, failRate, hasBottleneck) {
  const shortcuts = [...CORE_SHORTCUTS];

  // Prioritise debug shortcuts when trust is low or fail rate is high
  if (trustScore < 80 || failRate > 20 || hasBottleneck) {
    return shortcuts.sort((a, b) => {
      const priority = { debug: 0, deploy: 1, navigation: 2, infra: 3 };
      return (priority[a.category] ?? 9) - (priority[b.category] ?? 9);
    }).slice(0, 5);
  }

  return shortcuts.filter(s => s.category === "navigation").slice(0, 3);
}

// ── Phase 1052: Rapid debugging experience ────────────────────────────────────

function _buildDebugContext() {
  const now = Date.now();
  try {
    const hist = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
    })();
    const recent = hist.filter(h => now - (h.ts || 0) < 60 * 60 * 1000);
    const fails  = recent.filter(h => h.ok === false || h.status === "failed");
    const lastFail = fails[0] || null;

    // Replay link: is there a fresh snapshot to restore from?
    const snap = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null"); } catch { return null; }
    })();
    const snapAgeMin = snap ? Math.round((now - (snap.ts || 0)) / 60000) : null;
    const replayReady = snapAgeMin !== null && snapAgeMin < 360;

    const friction = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]"); }
      catch { return []; }
    })();
    const recentFriction = friction.filter(f => now - (f.ts || 0) < 30 * 60 * 1000).length;

    return {
      recentFailCount: fails.length,
      lastFailCmd:     lastFail?.cmd?.slice(0, 60) || null,
      replayReady,
      snapAgeMin,
      recentFriction,
      debugReadiness:  replayReady && fails.length < 3 ? "READY" : fails.length >= 3 ? "DEGRADED" : "LIMITED",
    };
  } catch { return { debugReadiness: "READY", replayReady: false }; }
}

// ── Phase 1053: Workspace persistence polish ──────────────────────────────────

function _assessWorkspacePersistence() {
  const now = Date.now();
  const issues = [];

  // Workspace state age
  const ws = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_operator_workspace") || "null"); } catch { return null; }
  })();
  if (!ws) {
    issues.push("No workspace state — session will start cold");
  } else {
    const ageMs = now - (ws.savedAt || 0);
    if (ageMs > 24 * 3600000) issues.push("Workspace state stale (>24h)");
  }

  // WA session dedup check
  const waSession = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_wa_session") || "null"); } catch { return null; }
  })();
  if (waSession?.activeChainId) {
    const chainAge = now - (waSession.ts || 0);
    if (chainAge > 6 * 3600000) issues.push("Active chain is stale — may resurrect on reconnect");
  }

  const score = Math.max(0, 100 - issues.length * 20);
  return {
    score,
    label: score >= 80 ? "PERSISTENT" : score >= 55 ? "PARTIAL" : "DEGRADED",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    issues,
  };
}

// ── Phase 1054: Execution acceleration — bounded session cache ────────────────

const _sessionCache = new Map();
const SESSION_CACHE_MAX = 20;
const SESSION_CACHE_TTL = 10 * 60 * 1000;  // 10min

function _sessionCacheGet(key) {
  const e = _sessionCache.get(key);
  if (!e || Date.now() - e.ts > SESSION_CACHE_TTL) { _sessionCache.delete(key); return null; }
  return e.value;
}
function _sessionCacheSet(key, value) {
  if (_sessionCache.size >= SESSION_CACHE_MAX) {
    const oldest = [..._sessionCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _sessionCache.delete(oldest[0]);
  }
  _sessionCache.set(key, { value, ts: Date.now() });
}
function _sessionCacheEvict() {
  const now = Date.now();
  for (const [k, v] of _sessionCache.entries()) {
    if (now - v.ts > SESSION_CACHE_TTL) _sessionCache.delete(k);
  }
}

// ── Phase 1055: Contextual engineering assistance ─────────────────────────────

function _buildContextualAssistance({ debugCtx, wsPersistence, accelScore, topBottleneck }) {
  const recs = [];

  if (debugCtx.recentFailCount >= 3) {
    recs.push({
      id:       "debug_failures",
      category: "debugging",
      title:    `${debugCtx.recentFailCount} recent failures`,
      rec:      debugCtx.lastFailCmd
        ? `Last failed: ${debugCtx.lastFailCmd} — check pm2 logs`
        : "Run pm2 logs --lines 50 to investigate",
      priority: "high",
    });
  }

  if (!debugCtx.replayReady) {
    recs.push({
      id:       "replay_not_ready",
      category: "replay",
      title:    "Replay snapshot unavailable",
      rec:      "Create a health snapshot for faster session restoration",
      priority: "medium",
    });
  }

  if (wsPersistence.score < 80) {
    recs.push({
      id:       "ws_persistence",
      category: "workspace",
      title:    `Workspace: ${wsPersistence.label}`,
      rec:      wsPersistence.issues[0] || "Refresh workspace snapshot",
      priority: wsPersistence.score < 55 ? "high" : "medium",
    });
  }

  if (topBottleneck) {
    recs.push({
      id:       "bottleneck",
      category: "performance",
      title:    topBottleneck.detail,
      rec:      topBottleneck.type === "queue_congestion" ? "Review queue depth — consider stopping stalled tasks"
              : topBottleneck.type === "execution_stall" ? "Check pm2 status for stalled processes"
              : "Investigate runtime health",
      priority: topBottleneck.severity,
    });
  }

  return recs.slice(0, 5);
}

// ── Phase 1056: Session continuity refinement ─────────────────────────────────

function _assessSessionContinuity() {
  const now = Date.now();
  const STALE_WIN = 6 * 60 * 60 * 1000;

  const snap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null"); } catch { return null; }
  })();
  const snapStale = snap ? now - (snap.ts || 0) > STALE_WIN : true;

  const CRITICAL_KEYS = ["jarvis_workflow_hist", "jarvis_friction_signals", "jarvis_operator_workspace"];
  const corrupted = CRITICAL_KEYS.filter(k => {
    try { const v = localStorage.getItem(k); if (v) JSON.parse(v); return false; }
    catch { return true; }
  });

  const waSession = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_wa_session") || "null"); } catch { return null; }
  })();
  const duplicateRisk = waSession?.activeChainId && (now - (waSession.ts || 0)) < 5 * 60 * 1000;

  let score = 100;
  if (snapStale)        score -= 15;
  if (corrupted.length) score -= 25 * Math.min(corrupted.length, 2);
  if (duplicateRisk)    score -= 10;
  score = Math.max(0, score);

  return {
    score,
    label: score >= 80 ? "CONTINUOUS" : score >= 55 ? "DEGRADED" : "INTERRUPTED",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    snapStale,
    corrupted,
    duplicateRisk,
  };
}

// ── Phase 1057: Operational smoothness ───────────────────────────────────────

const SMOOTHNESS_EVENTS = new Set([
  "shortcut_used", "palette_opened", "debug_started", "replay_restored",
  "workspace_recovered", "deploy_prepared", "friction_event",
  "reconnect_handled", "session_extended", "assist_accepted",
]);

function _scoreOperationalSmoothness(events) {
  const now     = Date.now();
  const win     = 24 * 60 * 60 * 1000;
  const recent  = events.filter(e => now - (e.ts || 0) < win);

  const shortcuts = recent.filter(e => e.type === "shortcut_used").length;
  const frictions = recent.filter(e => e.type === "friction_event").length;
  const assists   = recent.filter(e => e.type === "assist_accepted").length;

  let score = 70;  // baseline for new sessions
  score += Math.min(shortcuts * 3, 15);   // shortcuts show familiarity
  score += Math.min(assists   * 2, 10);   // assist acceptance shows engagement
  score -= Math.min(frictions * 5, 25);   // friction degrades smoothness
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    label: score >= 80 ? "SMOOTH" : score >= 55 ? "ADEQUATE" : "ROUGH",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    shortcuts,
    frictions,
    assists,
  };
}

// ── Phase 1058: Productivity observability ────────────────────────────────────

function _buildProductivitySnapshot({ accelScore, debugCtx, sessionContinuity, smoothness }) {
  return {
    ts:               Date.now(),
    accelScore:       accelScore || 100,
    debugReadiness:   debugCtx.debugReadiness,
    continuityScore:  sessionContinuity.score,
    smoothnessScore:  smoothness.score,
    composite:        Math.round(
      (accelScore || 100) * 0.35 +
      sessionContinuity.score * 0.35 +
      smoothness.score * 0.30
    ),
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useDailyDriverExperience({
  trustScore    = 100,
  failRate      = 0,
  accelScore    = 100,
  topBottleneck = null,
} = {}) {
  const [debugCtx,          setDebugCtx]          = useState(null);
  const [wsPersistence,     setWsPersistence]      = useState(null);
  const [sessionContinuity, setSessionContinuity]  = useState(null);
  const [smoothnessEvents,  setSmoothnessEvents]   = useState([]);
  const [prodSnapshots,     setProdSnapshots]      = useState([]);
  const [assistance,        setAssistance]         = useState([]);
  const [initialized,       setInitialized]        = useState(false);

  const evaluate = useCallback(() => {
    _sessionCacheEvict();
    const dc  = _buildDebugContext();
    const wsp = _assessWorkspacePersistence();
    const sc  = _assessSessionContinuity();
    setDebugCtx(dc);
    setWsPersistence(wsp);
    setSessionContinuity(sc);

    const recs = _buildContextualAssistance({ debugCtx: dc, wsPersistence: wsp, accelScore, topBottleneck });
    setAssistance(prev => {
      const merged = [...recs, ...prev.filter(r => !recs.find(n => n.id === r.id))].slice(0, ASSIST_MAX);
      _save(ASSIST_KEY, merged);
      return merged;
    });
  }, [accelScore, topBottleneck]);

  useEffect(() => {
    const now = Date.now();
    setSmoothnessEvents(_load(SMOOTH_KEY, []).filter(e => now - (e.ts || 0) < SMOOTH_TTL));
    setProdSnapshots(_load(PROD_OBS_KEY, []).filter(e => now - (e.ts || 0) < DD_TTL));
    setAssistance(_load(ASSIST_KEY, []));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Record a smoothness event
  const recordSmoothness = useCallback((eventType, meta = {}) => {
    if (!SMOOTHNESS_EVENTS.has(eventType)) return;
    const entry = { type: eventType, ts: Date.now(), ...meta };
    setSmoothnessEvents(prev => {
      const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < SMOOTH_TTL).slice(0, SMOOTH_MAX);
      _save(SMOOTH_KEY, next);
      return next;
    });
  }, []);

  // Dismiss an assistance recommendation
  const dismissAssist = useCallback((id) => {
    setAssistance(prev => {
      const next = prev.filter(r => r.id !== id);
      _save(ASSIST_KEY, next);
      return next;
    });
  }, []);

  // Contextual shortcuts for current session state
  const contextualShortcuts = useMemo(() =>
    _getContextualShortcuts(trustScore, failRate, !!topBottleneck),
    [trustScore, failRate, topBottleneck]
  );

  // Smoothness score
  const smoothness = useMemo(() =>
    _scoreOperationalSmoothness(smoothnessEvents),
    [smoothnessEvents]
  );

  // Top assistance recommendation
  const topAssist = useMemo(() =>
    assistance.find(r => r.priority === "high") || assistance[0] || null,
    [assistance]
  );

  // Session cache access (Phase 1054)
  const sessionCache = useMemo(() => ({
    get: _sessionCacheGet,
    set: _sessionCacheSet,
    size: _sessionCache.size,
  }), []);

  // Productivity snapshot on state changes (Phase 1058)
  useEffect(() => {
    if (!debugCtx || !sessionContinuity || !smoothness) return;
    const snap = _buildProductivitySnapshot({ accelScore, debugCtx, sessionContinuity, smoothness });
    setProdSnapshots(prev => {
      const next = [snap, ...prev].filter(e => Date.now() - (e.ts || 0) < DD_TTL).slice(0, PROD_OBS_MAX);
      _save(PROD_OBS_KEY, next);
      return next;
    });
  }, [debugCtx, sessionContinuity, smoothness, accelScore]);

  // Daily-driver status pill for operator bar (Phase 1063 UX)
  const ddStatusPill = useMemo(() => {
    if (sessionContinuity?.score < 55) {
      return { label: "SESSION", msg: sessionContinuity.label, color: sessionContinuity.color };
    }
    if (topAssist?.priority === "high") {
      return { label: "ASSIST", msg: topAssist.title, color: "var(--op-amber)" };
    }
    if (smoothness.score < 55) {
      return { label: "SMOOTH", msg: smoothness.label, color: smoothness.color };
    }
    return null;
  }, [sessionContinuity, topAssist, smoothness]);

  return {
    initialized,
    debugCtx,
    wsPersistence,
    sessionContinuity,
    smoothness,
    assistance,
    topAssist,
    prodSnapshots,
    contextualShortcuts,
    ddStatusPill,
    sessionCache,
    // Actions
    evaluate,
    recordSmoothness,
    dismissAssist,
  };
}
