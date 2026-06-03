// Phase 934-936: Workflow discoverability + productivity acceleration + session continuity.
// Debugging workflow suggestions, deployment guidance visibility, replay ecosystem navigation,
// contextual workflow recommendations, startup restoration, session continuity protection.
//
// Consolidates three phases into one bounded surface — avoids hook sprawl.
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: max 8 recommendations, 6h session TTL, 24h continuity window.

import { useState, useEffect, useCallback, useMemo } from "react";

const WD_KEY      = "jarvis_wf_discoverability";
const WD_TTL      = 6  * 60 * 60 * 1000;
const CONT_WINDOW = 24 * 60 * 60 * 1000;
const REC_MAX     = 8;

// ── Contextual recommendation engine ─────────────────────────────────────────
// Generates workflow recommendations based on current operational state.

function _buildRecommendations({ trustScore, failRate, reconnects, hasCrash, hasBackup, debugActive, deployBlocked }) {
  const recs = [];

  // Debugging discovery: when fail rate is elevated
  if (failRate > 25 || hasCrash) {
    recs.push({
      id:       "start_debug_sequence",
      type:     "debugging",
      priority: hasCrash ? "high" : "medium",
      title:    "Start Debug Sequence",
      body:     "Follow the guided debug sequence: health check → diagnose → inspect logs → restart → verify",
      action:   "open_debug_sequence",
      shortcut: "pm2 logs --lines 50",
    });
  }

  // Deployment guidance: when trust is sufficient but no backup exists
  if (trustScore >= 55 && !hasBackup && failRate < 30) {
    recs.push({
      id:       "create_backup_before_deploy",
      type:     "deployment",
      priority: "medium",
      title:    "Create backup before deploying",
      body:     "No recent backup on record. Creating a backup improves deployment confidence and enables rollback.",
      action:   "open_deploy_bundle",
      shortcut: "npm run backup",
    });
  }

  // Deployment blocked: surface the Deploy bundle
  if (deployBlocked) {
    recs.push({
      id:       "deploy_bundle",
      type:     "deployment",
      priority: "high",
      title:    "Resolve deploy blockers",
      body:     "Deployment is blocked. Use the Deploy bundle to run pre-deploy checks and clear blockers.",
      action:   "open_deploy_bundle",
      shortcut: "pm2 status",
    });
  }

  // Reconnect recovery: after reconnect storm
  if (reconnects >= 3) {
    recs.push({
      id:       "reconnect_recovery_bundle",
      type:     "recovery",
      priority: "high",
      title:    "Run Reconnect Recovery bundle",
      body:     `${reconnects} reconnects recorded. The Recovery bundle validates services and restores stable state.`,
      action:   "start_recovery_bundle",
      shortcut: "pm2 status",
    });
  }

  // Replay explainability: when replay was recently stale
  recs.push({
    id:       "replay_understand",
    type:     "replay",
    priority: "low",
    title:    "Session context explained",
    body:     "JARVIS stores your last session context for up to 6 hours. After reconnecting, it restores your last known state automatically.",
    action:   null,
    shortcut: null,
  });

  // Startup restoration shortcut
  if (trustScore < 80) {
    recs.push({
      id:       "run_startup_bundle",
      type:     "startup",
      priority: trustScore < 55 ? "high" : "medium",
      title:    "Run Startup bundle",
      body:     "Runtime trust is degraded. The Startup bundle runs a quick health check and dependency validation.",
      action:   "start_startup_bundle",
      shortcut: "pm2 status && npm install",
    });
  }

  // Sort by priority and cap
  const order = { high: 0, medium: 1, low: 2 };
  return recs
    .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9))
    .slice(0, REC_MAX);
}

// ── Session continuity checks ─────────────────────────────────────────────────
// Phase 936: verifies session can continue safely.

function _checkSessionContinuity() {
  const now  = Date.now();
  const snap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null"); }
    catch { return null; }
  })();

  // Stale replay
  const snapAgeMs = snap ? now - (snap.ts || 0) : Infinity;
  const replayStale = snapAgeMs > WD_TTL;

  // Workflow duplication: same chain started twice in last 5min
  const waSession = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_wa_session") || "null"); }
    catch { return null; }
  })();
  const chainActive = waSession?.activeChainId && (now - (waSession.ts || 0)) < 5 * 60 * 1000;

  // Context corruption
  let contextOk = true;
  ["jarvis_workflow_hist", "jarvis_friction_signals"].forEach(k => {
    try { const v = localStorage.getItem(k); if (v) JSON.parse(v); }
    catch { contextOk = false; }
  });

  return {
    replayStale,
    replayAgeMin: replayStale ? Math.round(snapAgeMs / 60000) : null,
    chainActive,
    contextOk,
    safe: !replayStale && contextOk,
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadCache() {
  const raw = _load(WD_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > WD_TTL) return null;
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWorkflowDiscoverability({
  trustScore    = 100,
  failRate      = 0,
  reconnects    = 0,
  hasCrash      = false,
  hasBackup     = false,
  debugActive   = false,
  deployBlocked = false,
} = {}) {
  const [recommendations, setRecommendations] = useState([]);
  const [continuity,      setContinuity]      = useState(null);
  const [dismissed,       setDismissed]       = useState(new Set());
  const [initialized,     setInitialized]     = useState(false);

  const evaluate = useCallback(() => {
    const recs = _buildRecommendations({ trustScore, failRate, reconnects, hasCrash, hasBackup, debugActive, deployBlocked });
    const cont = _checkSessionContinuity();
    setRecommendations(recs);
    setContinuity(cont);
    _save(WD_KEY, { recs, continuity: cont, ts: Date.now() });
  }, [trustScore, failRate, reconnects, hasCrash, hasBackup, debugActive, deployBlocked]);

  useEffect(() => {
    const cached = _loadCache();
    if (cached) {
      setRecommendations(cached.recs || []);
      setContinuity(cached.continuity || null);
    }
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Dismiss a recommendation
  const dismissRec = useCallback((id) => {
    setDismissed(prev => new Set([...prev, id]));
  }, []);

  // Visible recommendations (not dismissed)
  const visibleRecs = useMemo(() =>
    recommendations.filter(r => !dismissed.has(r.id)),
    [recommendations, dismissed]
  );

  // Top recommendation for operator bar
  const topRec = useMemo(() =>
    visibleRecs.find(r => r.priority === "high") || visibleRecs[0] || null,
    [visibleRecs]
  );

  // Continuity health for operator display
  const continuityStatus = useMemo(() => {
    if (!continuity) return null;
    if (!continuity.safe) {
      return {
        label: continuity.replayStale ? `Replay stale (${continuity.replayAgeMin}m)` : "Context issue",
        color: "var(--op-amber)",
        warn:  true,
      };
    }
    return { label: "Session continuity OK", color: "var(--op-green)", warn: false };
  }, [continuity]);

  return {
    initialized,
    recommendations: visibleRecs,
    topRec,
    continuity,
    continuityStatus,
    dismissRec,
    evaluate,
  };
}
