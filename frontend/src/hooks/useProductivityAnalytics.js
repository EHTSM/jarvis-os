// Phase 124: Local-only productivity analytics.
// Tracks workflow efficiency, dispatch friction, session length.
// Phase 161: Real-user friction signals — hesitation, onboarding drop-off, reconnect confusion.
// All data stays in localStorage — no external calls.
import { useEffect, useRef, useCallback } from "react";

const ANALYTICS_KEY  = "jarvis_productivity_analytics";
const FRICTION_KEY   = "jarvis_friction_signals";   // Phase 161
const MAX_SESSIONS   = 50;

function _load() {
  try { return JSON.parse(localStorage.getItem(ANALYTICS_KEY) || "[]"); }
  catch { return []; }
}

function _save(sessions) {
  try { localStorage.setItem(ANALYTICS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS))); } catch {}
}

// Phase 161: append a friction event to the rolling friction log (max 200 entries)
export function recordFrictionEvent(type, detail = {}) {
  try {
    const raw = localStorage.getItem(FRICTION_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift({ type, ts: Date.now(), ...detail });
    localStorage.setItem(FRICTION_KEY, JSON.stringify(log.slice(0, 200)));
  } catch { /* non-critical */ }
}

// Phase 161: retrieve friction summary for diagnostics export
// Phase 221: cluster events into named pain categories for feedback ingestion
export function getFrictionSummary() {
  try {
    const log = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    const counts = {};
    log.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });

    // Phase 221: cluster into named pain areas
    const clusters = {
      onboarding_failures: log.filter(e =>
        e.type === "onboarding_skip" || e.type === "onboarding_bounce" ||
        (e.type === "installer_health" && !e.ok)
      ).length,
      confusion_points: log.filter(e =>
        e.type === "hesitation" || e.type === "rapid_friction" || e.type === "abandonment"
      ).length,
      recovery_pain: log.filter(e =>
        e.type === "reconnect_confusion" || e.type === "reconnect_event" ||
        e.type === "system_resume" || e.type === "startup_corruption"
      ).length,
      workflow_friction: log.filter(e =>
        e.type === "abandonment" || e.type === "hesitation" || e.type === "network_lost"
      ).length,
      crash_events: log.filter(e =>
        e.type === "crash" || e.type === "startup_corruption"
      ).length,
    };

    return { total: log.length, counts, clusters, recent: log.slice(0, 20) };
  } catch { return null; }
}

// Phase 176: detect real-user confusion patterns from the friction log
// Returns an array of detected scenario signals — used in diagnostics bundle.
export function detectConfusionPatterns() {
  try {
    const log = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    const signals = [];
    const now = Date.now();
    const recent10m = log.filter(e => now - e.ts < 10 * 60 * 1000);

    // Rapid retries: ≥3 failures within 10 min → confused user
    const failures = recent10m.filter(e => e.type === "abandonment" || e.type === "hesitation");
    if (failures.length >= 3) signals.push({ pattern: "rapid_friction", count: failures.length, severity: "high" });

    // Reconnect panic: ≥2 reconnect events within 5 min
    const reconnects = recent10m.filter(e => e.type === "reconnect_event" || e.type === "reconnect_during_input");
    if (reconnects.length >= 2) signals.push({ pattern: "reconnect_panic", count: reconnects.length, severity: "medium" });

    // Onboarding bounce: skip happened at step 0 or 1
    const earlySkip = log.find(e => e.type === "onboarding_skip" && (e.atStep === 0 || e.atStep === 1));
    if (earlySkip) signals.push({ pattern: "onboarding_bounce", atStep: earlySkip.atStep, severity: "medium" });

    // Dangerous-cmd abandonment: typed dangerous then cleared without dispatch
    const dangerAbandons = log.filter(e => e.type === "abandonment");
    if (dangerAbandons.length >= 2) signals.push({ pattern: "repeated_abandonment", count: dangerAbandons.length, severity: "low" });

    return signals;
  } catch { return []; }
}

export function useProductivityAnalytics() {
  const sessionRef = useRef({
    start: Date.now(), dispatches: 0, failures: 0,
    totalLatencyMs: 0, retries: 0,
    abandonments: 0,   // Phase 156: cleared inputs without dispatch
    peakElapsed: 0,    // Phase 155: longest single dispatch wait
    hesitations: 0,    // Phase 161: typed >2s then cleared without dispatch
    reconnectConfusions: 0, // Phase 161: reconnect during active typing
  });
  const dispatchStartRef = useRef(null);
  // Phase 161: hesitation detector — input typed but not sent for >3s
  const hesitationTimerRef = useRef(null);

  // Flush session data on unmount / visibility-hidden
  const flush = useCallback(() => {
    const s = sessionRef.current;
    if (s.dispatches === 0 && s.hesitations === 0) return;
    const sessionMs = Date.now() - s.start;

    // Phase 282: orchestration bottleneck detection — flag sessions with high latency or retry rates
    const avgLatencyMs = s.dispatches ? Math.round(s.totalLatencyMs / s.dispatches) : 0;
    const retryRate    = s.dispatches ? Math.round((s.retries / s.dispatches) * 100) : 0;
    const bottleneck   = avgLatencyMs > 5000 ? "high_latency"
      : retryRate > 30 ? "high_retry_rate"
      : s.reconnectConfusions > 2 ? "reconnect_instability"
      : null;

    const entry = {
      date:              new Date().toISOString(),
      sessionMs,
      dispatches:        s.dispatches,
      failures:          s.failures,
      successRate:       s.dispatches ? Math.round(((s.dispatches - s.failures) / s.dispatches) * 100) : 100,
      avgLatencyMs,
      peakLatencyMs:     s.peakElapsed,
      retries:           s.retries,
      retryRate,                              // Phase 282
      abandonments:      s.abandonments,
      hesitations:       s.hesitations,
      reconnectConfusions: s.reconnectConfusions,
      bottleneck,                             // Phase 282: orchestration bottleneck signal
    };
    const all = _load();
    all.unshift(entry);
    _save(all);
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const recordDispatchStart = useCallback(() => {
    dispatchStartRef.current = Date.now();
  }, []);

  const recordDispatchEnd = useCallback((success) => {
    const s = sessionRef.current;
    s.dispatches++;
    if (!success) s.failures++;
    if (dispatchStartRef.current) {
      const latency = Date.now() - dispatchStartRef.current;
      s.totalLatencyMs += latency;
      if (latency > s.peakElapsed) s.peakElapsed = latency; // Phase 155: track peak
      dispatchStartRef.current = null;
    }
  }, []);

  const recordRetry = useCallback(() => {
    sessionRef.current.retries++;
  }, []);

  // Phase 156: record abandonment — input cleared without dispatch
  const recordAbandonment = useCallback(() => {
    sessionRef.current.abandonments++;
    recordFrictionEvent("abandonment");
  }, []);

  // Phase 161: record hesitation — input typed but idle >3s without dispatch
  const recordHesitationStart = useCallback((inputLen) => {
    clearTimeout(hesitationTimerRef.current);
    if (inputLen < 3) return;
    hesitationTimerRef.current = setTimeout(() => {
      sessionRef.current.hesitations++;
      recordFrictionEvent("hesitation", { inputLen });
    }, 3000);
  }, []);

  const recordHesitationCancel = useCallback(() => {
    clearTimeout(hesitationTimerRef.current);
  }, []);

  // Phase 161: record reconnect confusion — reconnect event during active input
  const recordReconnectConfusion = useCallback(() => {
    sessionRef.current.reconnectConfusions++;
    recordFrictionEvent("reconnect_confusion");
  }, []);

  useEffect(() => () => clearTimeout(hesitationTimerRef.current), []);

  return {
    recordDispatchStart, recordDispatchEnd, recordRetry, recordAbandonment,
    recordHesitationStart, recordHesitationCancel, recordReconnectConfusion,
  };
}

// Phase 282: bottleneck summary — aggregates detected bottlenecks across recent sessions
export function getBottleneckSummary() {
  try {
    const sessions = _load().slice(0, 20);
    const counts = {};
    sessions.forEach(s => {
      if (s.bottleneck) counts[s.bottleneck] = (counts[s.bottleneck] || 0) + 1;
    });
    const top = Object.entries(counts).sort(([,a],[,b]) => b - a);
    if (!top.length) return null;
    const avgLatency = Math.round(sessions.reduce((a, s) => a + (s.avgLatencyMs || 0), 0) / sessions.length);
    const avgRetryRate = Math.round(sessions.reduce((a, s) => a + (s.retryRate || 0), 0) / sessions.length);
    return {
      topBottleneck: top[0][0],
      topCount: top[0][1],
      all: Object.fromEntries(top),
      avgLatencyMs: avgLatency,
      avgRetryRate,
      sessionsSampled: sessions.length,
    };
  } catch { return null; }
}

// Phase 252: Advanced operational analytics — workflow efficiency + fatigue-risk detection
export function getOperationalAnalytics() {
  try {
    const sessions = _load();
    if (!sessions.length) return null;

    const friction = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    const recent   = sessions.slice(0, 10);

    // Workflow efficiency score: dispatches per minute of session time
    const efficiencyScores = recent
      .filter(s => s.sessionMs > 0 && s.dispatches > 0)
      .map(s => (s.dispatches / (s.sessionMs / 60_000)));
    const avgEfficiency = efficiencyScores.length
      ? Math.round(efficiencyScores.reduce((a, b) => a + b, 0) / efficiencyScores.length * 10) / 10
      : null;

    // Fatigue-risk detection: declining success rate + rising hesitations in recent sessions
    const firstHalf  = recent.slice(Math.floor(recent.length / 2));
    const secondHalf = recent.slice(0, Math.floor(recent.length / 2));
    const avgSuccessOld = firstHalf.length  ? firstHalf.reduce((a, s)  => a + s.successRate,  0) / firstHalf.length  : null;
    const avgSuccessNew = secondHalf.length ? secondHalf.reduce((a, s) => a + s.successRate,  0) / secondHalf.length : null;
    const avgHesOld = firstHalf.length  ? firstHalf.reduce((a, s)  => a + (s.hesitations || 0), 0) / firstHalf.length  : 0;
    const avgHesNew = secondHalf.length ? secondHalf.reduce((a, s) => a + (s.hesitations || 0), 0) / secondHalf.length : 0;

    const successDecline = avgSuccessOld !== null && avgSuccessNew !== null
      ? avgSuccessOld - avgSuccessNew
      : 0;
    const hesitationRise = avgHesNew - avgHesOld;
    const fatiguRisk = successDecline > 10 && hesitationRise > 0.5 ? "high"
      : successDecline > 5 || hesitationRise > 1 ? "medium" : "low";

    // Execution confidence trend (most recent 5 vs prior 5)
    const confTrend = avgSuccessNew !== null && avgSuccessOld !== null
      ? avgSuccessNew >= avgSuccessOld ? "improving" : "declining"
      : "stable";

    return {
      avgEfficiency,
      fatiguRisk,
      successDecline: Math.round(successDecline),
      hesitationRise: Math.round(hesitationRise * 10) / 10,
      confTrend,
      sessionCount: sessions.length,
    };
  } catch { return null; }
}

// Phase 249: AI-assisted diagnostics — cluster failures, explain instability, generate incident summary
export function generateIncidentSummary({ connectionState, runtimeDegraded } = {}) {
  try {
    const friction = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    const sessions = _load();
    const HIST_KEY = "jarvis_workflow_hist";
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");

    // Cluster recurring failures by error message
    const failClusters = {};
    hist.filter(h => !h.ok && h.output).forEach(h => {
      const key = h.output.slice(0, 50);
      failClusters[key] = (failClusters[key] || 0) + 1;
    });
    const topFailCluster = Object.entries(failClusters).sort(([,a],[,b]) => b - a)[0];

    // Reconnect instability explanation
    const reconnects = friction.filter(e => e.type === "reconnect_event" || e.type === "reconnect_during_input");
    const reconnectDurations = friction.filter(e => e.type === "reconnect_duration");
    const avgRecoveryMs = reconnectDurations.length
      ? Math.round(reconnectDurations.reduce((a, e) => a + (e.durationMs || 0), 0) / reconnectDurations.length)
      : null;

    const lines = [];

    // Runtime state
    lines.push(`Runtime: ${runtimeDegraded ? "DEGRADED" : "healthy"} | Stream: ${connectionState || "unknown"}`);

    // Session summary
    if (sessions.length) {
      const recent = sessions.slice(0, 5);
      const avgSuccess = Math.round(recent.reduce((a, s) => a + s.successRate, 0) / recent.length);
      const totalDisp = recent.reduce((a, s) => a + s.dispatches, 0);
      lines.push(`Last ${recent.length} sessions: ${totalDisp} dispatches, ${avgSuccess}% success rate`);
    }

    // Failure cluster
    if (topFailCluster) {
      lines.push(`Most common failure (×${topFailCluster[1]}): "${topFailCluster[0]}"`);
    }

    // Reconnect instability
    if (reconnects.length >= 2) {
      const explanation = avgRecoveryMs
        ? `Stream reconnected ${reconnects.length}× — avg recovery ${Math.round(avgRecoveryMs / 1000)}s`
        : `Stream reconnected ${reconnects.length}× in this session`;
      lines.push(explanation);
    }

    // Friction summary
    const clusters = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
    const confusionCount = clusters.filter(e => e.type === "hesitation" || e.type === "abandonment").length;
    if (confusionCount > 0) lines.push(`Operator friction events: ${confusionCount} hesitations/abandonments`);

    return {
      lines,
      text: lines.join("\n"),
      topFailCluster: topFailCluster ? { msg: topFailCluster[0], count: topFailCluster[1] } : null,
      reconnectCount: reconnects.length,
      avgRecoveryMs,
    };
  } catch { return { lines: ["Incident summary unavailable"], text: "Incident summary unavailable", topFailCluster: null, reconnectCount: 0, avgRecoveryMs: null }; }
}

// Phase 231: public-beta retention analytics — trends across sessions
export function getRetentionAnalytics() {
  try {
    const sessions = _load();
    if (sessions.length < 2) return null;

    const friction = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");

    // Onboarding completion trend — did the user skip onboarding?
    const onboardingSkips  = friction.filter(e => e.type === "onboarding_skip").length;
    const onboardingBounce = friction.filter(e => e.type === "onboarding_bounce").length;
    const onboardingComplete = friction.find(e => e.type === "onboarding_complete");
    const onboardingStatus = onboardingComplete ? "completed"
      : onboardingSkips > 0 ? "skipped"
      : onboardingBounce > 0 ? "bounced"
      : "unknown";

    // Workflow reuse rate — ratio of sessions with ≥1 dispatch to total sessions
    const activeSessions  = sessions.filter(s => s.dispatches > 0).length;
    const reuseRate       = Math.round((activeSessions / sessions.length) * 100);

    // Abandonment trend — compare first half vs second half of stored sessions
    const half = Math.floor(sessions.length / 2);
    const olderHalf  = sessions.slice(half);
    const newerHalf  = sessions.slice(0, half);
    const avgAbandonOlder = olderHalf.length
      ? (olderHalf.reduce((a, s) => a + (s.abandonments || 0), 0) / olderHalf.length).toFixed(1)
      : 0;
    const avgAbandonNewer = newerHalf.length
      ? (newerHalf.reduce((a, s) => a + (s.abandonments || 0), 0) / newerHalf.length).toFixed(1)
      : 0;
    const abandonTrend = avgAbandonNewer < avgAbandonOlder ? "improving"
      : avgAbandonNewer > avgAbandonOlder ? "worsening" : "stable";

    // Recovery success trend — reconnect events vs reconnect_duration (successful recovery)
    const reconnectEvents    = friction.filter(e => e.type === "reconnect_event").length;
    const reconnectDurations = friction.filter(e => e.type === "reconnect_duration");
    const recoveryRate = reconnectEvents > 0
      ? Math.round((reconnectDurations.length / reconnectEvents) * 100)
      : 100;
    const avgRecoveryMs = reconnectDurations.length
      ? Math.round(reconnectDurations.reduce((a, e) => a + (e.durationMs || 0), 0) / reconnectDurations.length)
      : null;

    return {
      totalSessions:   sessions.length,
      activeSessions,
      reuseRate,
      onboardingStatus,
      abandonTrend,
      avgAbandonOlder: Number(avgAbandonOlder),
      avgAbandonNewer: Number(avgAbandonNewer),
      recoveryRate,
      avgRecoveryMs,
    };
  } catch { return null; }
}

export function getProductivitySummary() {
  const sessions = _load();
  if (!sessions.length) return null;
  const recent = sessions.slice(0, 10);
  const avgSuccess     = Math.round(recent.reduce((a, s) => a + s.successRate,    0) / recent.length);
  const avgLatency     = Math.round(recent.reduce((a, s) => a + s.avgLatencyMs,   0) / recent.length);
  const totalDispatches   = recent.reduce((a, s) => a + s.dispatches,         0);
  const totalHesitations  = recent.reduce((a, s) => a + (s.hesitations  || 0), 0);
  const totalAbandonments = recent.reduce((a, s) => a + (s.abandonments || 0), 0);
  const confusionPatterns = detectConfusionPatterns();

  // Phase 187: deployment confidence score (0–100)
  // Weighs: dispatch success rate, friction density, confusion patterns
  const frictionRate = totalDispatches > 0
    ? Math.min(1, (totalHesitations + totalAbandonments) / totalDispatches)
    : 0;
  const confusionPenalty = confusionPatterns.filter(p => p.severity === "high").length * 15
    + confusionPatterns.filter(p => p.severity === "medium").length * 7;
  const deploymentConfidence = Math.max(0, Math.min(100,
    Math.round(avgSuccess * 0.6 + (1 - frictionRate) * 30 - confusionPenalty)
  ));
  const confidenceLabel = deploymentConfidence >= 80 ? "high"
    : deploymentConfidence >= 55 ? "medium" : "low";

  return {
    sessions: sessions.length, avgSuccess, avgLatencyMs: avgLatency,
    totalDispatches, totalHesitations, totalAbandonments, recent,
    friction: getFrictionSummary(),
    confusionPatterns,
    deploymentConfidence, confidenceLabel, // Phase 187
  };
}

// Phase 329: generate a human-readable session narrative from recent history
// Produces a 3-4 sentence operational story summarizing what the operator accomplished
export function generateSessionNarrative() {
  try {
    const HIST_KEY = "jarvis_workflow_hist";
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    if (hist.length < 2) return null;

    const recent = hist.slice(0, 20);
    const total  = recent.length;
    const passed = recent.filter(h => h.ok).length;
    const failed = total - passed;
    const successPct = Math.round((passed / total) * 100);

    // Identify dominant domains
    const DOMAIN_MAP = [
      { pattern: /npm run build|docker build/i, label: "building" },
      { pattern: /npm test/i,                   label: "testing" },
      { pattern: /git (pull|push|commit)/i,     label: "version control" },
      { pattern: /pm2 restart|pm2 reload/i,     label: "service recovery" },
      { pattern: /pm2 list|check-health/i,      label: "health monitoring" },
      { pattern: /npm install/i,                label: "dependency setup" },
    ];
    const domainCounts = {};
    recent.forEach(h => {
      for (const { pattern, label } of DOMAIN_MAP) {
        if (pattern.test(h.cmd)) { domainCounts[label] = (domainCounts[label] || 0) + 1; break; }
      }
    });
    const topDomains = Object.entries(domainCounts).sort(([, a], [, b]) => b - a).slice(0, 2).map(([l]) => l);

    const timeSpanMs = (recent[0]?.ts || Date.now()) - (recent[recent.length - 1]?.ts || Date.now());
    const timeSpanMin = Math.max(1, Math.round(timeSpanMs / 60_000));

    const lines = [];
    if (topDomains.length) {
      lines.push(`Session focused on ${topDomains.join(" and ")} across ${total} commands over ~${timeSpanMin} minutes.`);
    } else {
      lines.push(`Session ran ${total} commands over ~${timeSpanMin} minutes.`);
    }
    lines.push(`${successPct}% succeeded (${passed} of ${total}).`);
    if (failed > 0) lines.push(`${failed} command${failed !== 1 ? "s" : ""} failed — review execution log for details.`);
    if (successPct >= 90) lines.push("Overall session was stable and productive.");
    else if (successPct >= 70) lines.push("Session had some friction — consider reviewing failed steps before continuing.");
    else lines.push("High failure rate this session — check backend health before proceeding.");

    return lines.join(" ");
  } catch { return null; }
}
