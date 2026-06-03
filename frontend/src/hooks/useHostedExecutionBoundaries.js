// Phase 949-951: Hosted execution boundaries + session continuity hardening + MVP diagnostics.
// Safe hosted execution limits, replay-safe cloud coordination guards,
// deployment execution boundaries, workflow resource restrictions,
// session continuity hardening, reconnect-safe restore.
//
// Consolidates three phases — no external calls, no autonomous execution.
// All state: localStorage-only. Bounded: 20 boundary events, 15 diagnostics, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const HEB_KEY    = "jarvis_hosted_boundaries";
const CONT_KEY   = "jarvis_session_continuity";
const MVPD_KEY   = "jarvis_mvp_diagnostics";
const HEB_TTL    = 24 * 60 * 60 * 1000;
const EVT_MAX    = 20;
const DIAG_MAX   = 15;
const CONT_TTL   = 6  * 60 * 60 * 1000;   // 6h session continuity window

// ── Phase 949: Hosted execution boundary enforcer ────────────────────────────
// Validates that a workflow action is within safe hosted-execution limits.

const HOSTED_LIMITS = {
  maxChainSteps:         6,    // max steps before requiring human re-approval
  maxRetryAttempts:      2,    // max retries per step
  maxConcurrentActions:  1,    // serial execution only
  blockCloudEscalation:  true, // no recursive hosted workflow spawning
  requireApprovalOnDeploy: true,
  requireApprovalOnRestart: true,
  maxExecDurationMin:    30,   // flag if single chain exceeds 30min
};

function _validateHostedAction(actionType, meta = {}) {
  const violations = [];

  if (actionType === "deploy" && HOSTED_LIMITS.requireApprovalOnDeploy) {
    if (!meta.approved) violations.push("Deploy requires operator approval");
  }
  if (actionType === "restart" && HOSTED_LIMITS.requireApprovalOnRestart) {
    if (!meta.approved) violations.push("Service restart requires operator approval");
  }
  if (actionType === "chain" && (meta.stepCount || 0) > HOSTED_LIMITS.maxChainSteps) {
    violations.push(`Chain exceeds ${HOSTED_LIMITS.maxChainSteps}-step limit`);
  }
  if (actionType === "cloud_spawn" && HOSTED_LIMITS.blockCloudEscalation) {
    violations.push("Cloud workflow spawning is not permitted");
  }
  if (meta.durationMin && meta.durationMin > HOSTED_LIMITS.maxExecDurationMin) {
    violations.push(`Execution exceeds ${HOSTED_LIMITS.maxExecDurationMin}min limit`);
  }

  return { allowed: violations.length === 0, violations };
}

// ── Phase 950: Session continuity hardening ───────────────────────────────────
// Validates that session can continue safely — no stale replay, no corruption.

function _buildContinuityState() {
  const now = Date.now();

  // Replay snapshot freshness
  const snap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null"); } catch { return null; }
  })();
  const snapAgeMs   = snap ? now - (snap.ts || 0) : Infinity;
  const replayStale = snapAgeMs > CONT_TTL;

  // Key corruption check
  const CRITICAL_KEYS = [
    "jarvis_workflow_hist", "jarvis_friction_signals",
    "jarvis_operator_workspace", "jarvis_health_snapshot",
  ];
  const corrupted = [];
  CRITICAL_KEYS.forEach(k => {
    try { const v = localStorage.getItem(k); if (v) JSON.parse(v); }
    catch { corrupted.push(k); }
  });

  // Dedup guard: check for duplicate workflow chain execution
  const waSession = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_wa_session") || "null"); } catch { return null; }
  })();
  const possibleDuplicate = waSession?.activeChainId && (now - (waSession.ts || 0)) < 5 * 60 * 1000;

  let score = 100;
  if (replayStale)       score -= 15;
  if (corrupted.length)  score -= 25 * Math.min(corrupted.length, 2);
  if (possibleDuplicate) score -= 10;
  score = Math.max(0, score);

  return {
    score,
    label:            score >= 80 ? "HEALTHY" : score >= 55 ? "DEGRADED" : "CRITICAL",
    color:            score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    replayStale,
    replayAgeMin:     replayStale ? Math.round(snapAgeMs / 60000) : null,
    corrupted,
    possibleDuplicate,
    ts: now,
  };
}

// ── Phase 951: MVP diagnostics ────────────────────────────────────────────────
// Aggregates crash + friction + workflow interruption data into MVP diagnostics.

function _buildMvpDiagnostics() {
  const now     = Date.now();
  const WINDOW  = HEB_TTL;
  const diags   = [];

  const crashLog = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_crash_log") || "[]"); } catch { return []; }
  })();
  const hist     = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
  })();
  const friction = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]"); } catch { return []; }
  })();

  // Crash summary
  const recentCrashes = crashLog.filter(c => now - (c.ts || 0) < WINDOW);
  if (recentCrashes.length > 0) {
    const critical = recentCrashes.filter(c => c.severity === "critical").length;
    diags.push({
      id:       "crash_summary",
      category: "stability",
      severity: critical > 0 ? "critical" : "high",
      title:    `${recentCrashes.length} crash event(s) in 24h`,
      detail:   `${critical} critical, ${recentCrashes.length - critical} other`,
      action:   "pm2 logs --lines 50",
    });
  }

  // Onboarding interruptions
  const obInterruptions = friction.filter(f =>
    f.type === "onboarding_dismissed" && now - (f.ts || 0) < WINDOW
  ).length;
  if (obInterruptions >= 2) {
    diags.push({
      id:       "onboarding_friction",
      category: "onboarding",
      severity: "medium",
      title:    `${obInterruptions} onboarding dismissal(s)`,
      detail:   "Operators are skipping onboarding — consider simplifying first-run flow",
      action:   null,
    });
  }

  // Workflow friction
  const frictionEvents = friction.filter(f =>
    f.type === "workflow_interrupted" && now - (f.ts || 0) < WINDOW
  ).length;
  if (frictionEvents >= 3) {
    diags.push({
      id:       "workflow_friction_mvp",
      category: "workflow",
      severity: "medium",
      title:    `${frictionEvents} workflow interruption(s) in 24h`,
      detail:   "Workflows are not completing — may indicate approval gate confusion or timeouts",
      action:   null,
    });
  }

  // Runtime health aggregation
  const recentFails = hist.filter(h => !h.ok && now - (h.ts || 0) < WINDOW).length;
  const total       = hist.filter(h => now - (h.ts || 0) < WINDOW).length;
  const failRate    = total > 0 ? Math.round((recentFails / total) * 100) : 0;
  if (failRate > 40 && total >= 5) {
    diags.push({
      id:       "runtime_health_mvp",
      category: "runtime",
      severity: failRate > 60 ? "high" : "medium",
      title:    `${failRate}% command failure rate in 24h`,
      detail:   "High failure rate detected — check runtime health and dependencies",
      action:   "pm2 status",
    });
  }

  return diags.slice(0, DIAG_MAX);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useHostedExecutionBoundaries() {
  const [boundaryEvents, setBoundaryEvents] = useState([]);
  const [continuity,     setContinuity]     = useState(null);
  const [mvpDiagnostics, setMvpDiagnostics] = useState([]);
  const [initialized,    setInitialized]    = useState(false);

  const evaluate = useCallback(() => {
    const cont  = _buildContinuityState();
    const diags = _buildMvpDiagnostics();
    setContinuity(cont);
    setMvpDiagnostics(diags);
    _save(HEB_KEY,  { continuity: cont, ts: Date.now() });
    _save(MVPD_KEY, { diagnostics: diags, ts: Date.now() });
  }, []);

  useEffect(() => {
    const cached = _load(HEB_KEY, null);
    if (cached?.continuity) setContinuity(cached.continuity);
    const cachedD = _load(MVPD_KEY, null);
    if (cachedD?.diagnostics) setMvpDiagnostics(cachedD.diagnostics);
    setBoundaryEvents(_load("jarvis_boundary_events", []));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Validate a hosted action before execution
  const validateAction = useCallback((actionType, meta = {}) => {
    const result = _validateHostedAction(actionType, meta);
    if (!result.allowed) {
      const entry = { actionType, violations: result.violations, ts: Date.now() };
      setBoundaryEvents(prev => {
        const next = [entry, ...prev].slice(0, EVT_MAX);
        _save("jarvis_boundary_events", next);
        return next;
      });
    }
    return result;
  }, []);

  // Top MVP diagnostic
  const topDiagnostic = useMemo(() =>
    mvpDiagnostics.find(d => d.severity === "critical" || d.severity === "high") ||
    mvpDiagnostics[0] || null,
    [mvpDiagnostics]
  );

  // Continuity warning for operator bar
  const continuityWarning = useMemo(() => {
    if (!continuity || continuity.score >= 80) return null;
    const msg = continuity.corrupted.length > 0
      ? `Context corruption: ${continuity.corrupted[0]}`
      : continuity.replayStale
        ? `Replay stale (${continuity.replayAgeMin}m)`
        : "Session degraded";
    return { msg, color: continuity.color, score: continuity.score };
  }, [continuity]);

  return {
    initialized,
    continuity,
    continuityWarning,
    mvpDiagnostics,
    topDiagnostic,
    boundaryEvents,
    hostedLimits: HOSTED_LIMITS,
    validateAction,
    evaluate,
  };
}
