// Phase 890: Public operational telemetry.
// Lightweight, privacy-safe aggregation of workflow health, replay survivability,
// deployment reliability, debugging productivity, and runtime stability.
//
// Privacy contract:
//   - No commands, no output, no user content stored
//   - Only counts, rates, durations, and boolean outcomes
//   - Operator-visible with full export/clear controls
// Bounded: max 200 events, 7-day retention, 24h aggregation window.
// No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const TELEM_KEY   = "jarvis_telemetry";
const TELEM_MAX   = 200;
const TELEM_TTL   = 7 * 24 * 60 * 60 * 1000;
const AGG_WINDOW  = 24 * 60 * 60 * 1000;

// ── Event taxonomy ─────────────────────────────────────────────────────────────
// All event types that can be recorded. Only metadata — no content.

const EVENT_TYPES = new Set([
  "workflow_started", "workflow_completed", "workflow_failed", "workflow_abandoned",
  "deploy_started",   "deploy_completed",   "deploy_failed",   "deploy_rolled_back",
  "debug_started",    "debug_resolved",     "debug_escalated",
  "session_restored", "session_expired",    "reconnect",
  "onboarding_step",  "onboarding_completed",
  "crash_recorded",   "crash_recovered",
  "command_blocked",  "approval_granted",   "approval_denied",
]);

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = JSON.parse(localStorage.getItem(TELEM_KEY) || "[]");
    return raw.filter(e => Date.now() - (e.ts || 0) < TELEM_TTL);
  } catch { return []; }
}

function _append(events, entry) {
  const next = [entry, ...events].slice(0, TELEM_MAX);
  try { localStorage.setItem(TELEM_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function _aggregate(events) {
  const now     = Date.now();
  const recent  = events.filter(e => now - (e.ts || 0) < AGG_WINDOW);

  const count = (type) => recent.filter(e => e.type === type).length;

  // Workflow health
  const wfStarted   = count("workflow_started");
  const wfCompleted = count("workflow_completed");
  const wfFailed    = count("workflow_failed");
  const wfRate      = wfStarted > 0 ? Math.round((wfCompleted / wfStarted) * 100) : null;

  // Deployment reliability
  const depStarted   = count("deploy_started");
  const depCompleted = count("deploy_completed");
  const depFailed    = count("deploy_failed");
  const depRolledBack = count("deploy_rolled_back");
  const depRate      = depStarted > 0 ? Math.round((depCompleted / depStarted) * 100) : null;

  // Debug productivity
  const dbgStarted  = count("debug_started");
  const dbgResolved = count("debug_resolved");
  const dbgEscalated = count("debug_escalated");
  const dbgRate     = dbgStarted > 0 ? Math.round((dbgResolved / dbgStarted) * 100) : null;

  // Replay survivability
  const restored   = count("session_restored");
  const expired    = count("session_expired");
  const reconnects = count("reconnect");

  // Runtime stability
  const crashes     = count("crash_recorded");
  const recovered   = count("crash_recovered");
  const crashRecoveryRate = crashes > 0 ? Math.round((recovered / crashes) * 100) : null;

  // Safety events
  const blocked   = count("command_blocked");
  const approved  = count("approval_granted");
  const denied    = count("approval_denied");

  // Stability score: 0-100
  let score = 100;
  if (wfRate  !== null && wfRate  < 70)  score -= 15;
  if (depRate !== null && depRate < 80)  score -= 20;
  if (crashes > 2)                        score -= 20;
  if (reconnects > 5)                     score -= 10;
  if (depRolledBack > 0)                  score -= 10;
  score = Math.max(0, score);

  return {
    window:      "24h",
    windowStart: now - AGG_WINDOW,
    eventCount:  recent.length,
    workflow:    { started: wfStarted,  completed: wfCompleted,  failed: wfFailed,   successRate: wfRate },
    deployment:  { started: depStarted, completed: depCompleted, failed: depFailed,   rolledBack: depRolledBack, successRate: depRate },
    debugging:   { started: dbgStarted, resolved:  dbgResolved,  escalated: dbgEscalated, resolveRate: dbgRate },
    replay:      { restored, expired, reconnects },
    stability:   { crashes, recovered, crashRecoveryRate, score,
                   label: score >= 80 ? "STABLE" : score >= 55 ? "DEGRADED" : "UNSTABLE",
                   color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)" },
    safety:      { blocked, approved, denied },
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useOperationalTelemetry() {
  const [events,      setEvents]      = useState([]);
  const [telemetryOn, setTelemetryOn] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setEvents(_load());
    // Telemetry opt-out persisted
    const off = localStorage.getItem("jarvis_telemetry_off") === "1";
    setTelemetryOn(!off);
    setInitialized(true);
  }, []);

  // Record a telemetry event (no content — only type + numeric metadata)
  const record = useCallback((type, meta = {}) => {
    if (!telemetryOn) return;
    if (!EVENT_TYPES.has(type)) return;
    const entry = { type, ts: Date.now(), ...meta };
    setEvents(prev => _append(prev, entry));
  }, [telemetryOn]);

  // 24h aggregate metrics
  const metrics = useMemo(() => _aggregate(events), [events]);

  // Operator opt-out
  const setEnabled = useCallback((enabled) => {
    setTelemetryOn(enabled);
    try {
      if (enabled) localStorage.removeItem("jarvis_telemetry_off");
      else         localStorage.setItem("jarvis_telemetry_off", "1");
    } catch {}
  }, []);

  // Privacy-safe export (counts only, no content)
  const exportMetrics = useCallback(() => {
    return JSON.stringify({ exportedAt: Date.now(), metrics }, null, 2);
  }, [metrics]);

  // Clear all telemetry
  const clearAll = useCallback(() => {
    try { localStorage.removeItem(TELEM_KEY); } catch {}
    setEvents([]);
  }, []);

  // Status pill for operator bar
  const statusPill = useMemo(() => {
    if (!telemetryOn) return { label: "TELEMETRY OFF", color: "var(--op-muted)" };
    const s = metrics.stability;
    return { label: s.label, color: s.color, score: s.score };
  }, [telemetryOn, metrics]);

  return {
    initialized,
    telemetryOn,
    metrics,
    statusPill,
    events: events.slice(0, 50), // only expose recent 50 for display
    // Actions
    record,
    setEnabled,
    exportMetrics,
    clearAll,
  };
}
