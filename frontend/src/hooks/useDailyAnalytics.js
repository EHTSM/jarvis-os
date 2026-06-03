// Phase 901: Daily-usage analytics.
// Tracks workflow completion rates, debugging-session duration,
// deployment interruption frequency, replay restoration success,
// onboarding friction points, recovery-loop frequency.
//
// Privacy contract: no commands, no output, no user content.
// Only outcome booleans, durations, and counts.
// Bounded: 500 events max, 30-day retention, operator-visible controls.
// No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const DA_KEY     = "jarvis_daily_analytics";
const DA_OPT_KEY = "jarvis_da_opt_out";
const DA_MAX     = 500;
const DA_TTL     = 30 * 24 * 60 * 60 * 1000;
const DAY_MS     = 24 * 60 * 60 * 1000;

// ── Event taxonomy — privacy-safe, counts/booleans only ──────────────────────

const VALID_EVENTS = new Set([
  // Workflow lifecycle
  "workflow_started", "workflow_completed", "workflow_failed", "workflow_abandoned",
  "workflow_resumed",
  // Debugging
  "debug_session_started", "debug_session_resolved", "debug_session_escalated",
  "debug_step_completed", "debug_dead_end",
  // Deployment
  "deploy_started", "deploy_completed", "deploy_failed",
  "deploy_interrupted", "deploy_rolled_back",
  // Replay / restore
  "replay_restored", "replay_stale", "replay_failed",
  "reconnect_recovered", "reconnect_failed",
  // Onboarding
  "onboarding_step_viewed", "onboarding_step_skipped",
  "onboarding_flow_completed", "onboarding_dismissed",
  // Recovery
  "recovery_loop_detected", "recovery_succeeded", "recovery_failed",
  // Session
  "session_started", "session_ended_idle", "session_ended_error",
]);

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = JSON.parse(localStorage.getItem(DA_KEY) || "[]");
    return raw.filter(e => Date.now() - (e.ts || 0) < DA_TTL);
  } catch { return []; }
}

function _append(events, entry) {
  const next = [entry, ...events].slice(0, DA_MAX);
  try { localStorage.setItem(DA_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ── Daily bucket helper ───────────────────────────────────────────────────────

function _dayBucket(ts) {
  return Math.floor((ts || Date.now()) / DAY_MS);
}

// ── Aggregate calculator ──────────────────────────────────────────────────────

function _aggregate(events, windowDays = 7) {
  const now      = Date.now();
  const cutoff   = now - windowDays * DAY_MS;
  const recent   = events.filter(e => (e.ts || 0) > cutoff);

  const count = (type) => recent.filter(e => e.type === type).length;

  // Workflow completion rate
  const wfStarted   = count("workflow_started");
  const wfCompleted = count("workflow_completed");
  const wfFailed    = count("workflow_failed");
  const wfAbandoned = count("workflow_abandoned");
  const wfRate      = wfStarted > 0 ? Math.round((wfCompleted / wfStarted) * 100) : null;

  // Debugging session duration (use stored durationMs meta)
  const debugSessions = recent.filter(e => e.type === "debug_session_resolved" && e.durationMs > 0);
  const avgDebugMs    = debugSessions.length > 0
    ? Math.round(debugSessions.reduce((s, e) => s + e.durationMs, 0) / debugSessions.length)
    : null;

  // Deployment interruptions
  const depInterrupted = count("deploy_interrupted");
  const depCompleted   = count("deploy_completed");
  const depStarted     = count("deploy_started");
  const depRate        = depStarted > 0 ? Math.round((depCompleted / depStarted) * 100) : null;

  // Replay restoration
  const replayOk    = count("replay_restored");
  const replayStale = count("replay_stale");
  const replayFail  = count("replay_failed");
  const replayTotal = replayOk + replayStale + replayFail;
  const replayRate  = replayTotal > 0 ? Math.round((replayOk / replayTotal) * 100) : null;

  // Onboarding friction
  const obViewed   = count("onboarding_step_viewed");
  const obSkipped  = count("onboarding_step_skipped");
  const obCompleted = count("onboarding_flow_completed");
  const obFriction = obViewed > 0 ? Math.round((obSkipped / obViewed) * 100) : 0;

  // Recovery loops
  const recoveryLoops = count("recovery_loop_detected");
  const recoveryOk    = count("recovery_succeeded");
  const recoveryFail  = count("recovery_failed");

  // Per-day breakdown (last 7 days)
  const dailyBuckets = {};
  recent.forEach(e => {
    const day = _dayBucket(e.ts);
    if (!dailyBuckets[day]) dailyBuckets[day] = { wfStarted: 0, wfCompleted: 0, deploys: 0, debug: 0 };
    if (e.type === "workflow_started")    dailyBuckets[day].wfStarted++;
    if (e.type === "workflow_completed")  dailyBuckets[day].wfCompleted++;
    if (e.type === "deploy_started")      dailyBuckets[day].deploys++;
    if (e.type === "debug_session_started") dailyBuckets[day].debug++;
  });

  return {
    windowDays,
    totalEvents: recent.length,
    workflow:   { started: wfStarted,  completed: wfCompleted, failed: wfFailed, abandoned: wfAbandoned, completionRate: wfRate },
    debugging:  { sessions: debugSessions.length, avgDurationMs: avgDebugMs, deadEnds: count("debug_dead_end") },
    deployment: { started: depStarted, completed: depCompleted, interrupted: depInterrupted, successRate: depRate },
    replay:     { ok: replayOk, stale: replayStale, failed: replayFail, successRate: replayRate },
    onboarding: { viewed: obViewed, skipped: obSkipped, completed: obCompleted, frictionPct: obFriction },
    recovery:   { loops: recoveryLoops, succeeded: recoveryOk, failed: recoveryFail },
    dailyBuckets,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useDailyAnalytics() {
  const [events,    setEvents]    = useState([]);
  const [optOut,    setOptOutState] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setEvents(_load());
    setOptOutState(localStorage.getItem(DA_OPT_KEY) === "1");
    setInitialized(true);
  }, []);

  const record = useCallback((type, meta = {}) => {
    if (optOut) return;
    if (!VALID_EVENTS.has(type)) return;
    const entry = { type, ts: Date.now(), ...meta };
    setEvents(prev => _append(prev, entry));
  }, [optOut]);

  // Coarse dep-key: only recompute metrics when event bucket changes
  const eventBucket = Math.floor(events.length / 10);

  const metrics7d  = useMemo(() => _aggregate(events, 7),  [eventBucket, events]);
  const metrics30d = useMemo(() => _aggregate(events, 30), [eventBucket, events]);

  const setOptOut = useCallback((val) => {
    setOptOutState(val);
    try {
      if (val) localStorage.setItem(DA_OPT_KEY, "1");
      else     localStorage.removeItem(DA_OPT_KEY);
    } catch {}
  }, []);

  const clearAll = useCallback(() => {
    try { localStorage.removeItem(DA_KEY); } catch {}
    setEvents([]);
  }, []);

  // Privacy-safe export
  const exportMetrics = useCallback(() => {
    return JSON.stringify({ exportedAt: Date.now(), metrics7d, metrics30d }, null, 2);
  }, [metrics7d, metrics30d]);

  // Status pill: most notable metric for operator bar
  const statusPill = useMemo(() => {
    if (optOut) return null;
    const m = metrics7d;
    if (m.recovery.loops >= 3) return { label: `${m.recovery.loops} recovery loops`, color: "var(--op-amber)" };
    if (m.workflow.completionRate !== null && m.workflow.completionRate < 60)
      return { label: `${m.workflow.completionRate}% WF rate`, color: "var(--op-amber)" };
    if (m.deployment.interrupted > 2) return { label: `${m.deployment.interrupted} deploy interrupts`, color: "var(--op-amber)" };
    if (m.replay.successRate !== null && m.replay.successRate < 70)
      return { label: `${m.replay.successRate}% replay OK`, color: "var(--op-amber)" };
    return null;
  }, [optOut, metrics7d]);

  return {
    initialized,
    optOut,
    events: events.slice(0, 100), // display cap
    metrics7d,
    metrics30d,
    statusPill,
    record,
    setOptOut,
    clearAll,
    exportMetrics,
  };
}
