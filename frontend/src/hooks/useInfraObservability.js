// Phase 981-984: Infrastructure observability + scaling analytics +
// multi-runtime isolation + scaling performance hardening.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 200 analytics events, 10 runtime snapshots, 30d retention, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const INFRA_KEY    = "jarvis_infra_obs";
const SCALE_KEY    = "jarvis_scaling_analytics";
const RUNTIME_KEY  = "jarvis_runtime_isolation";
const INFRA_TTL    = 24 * 60 * 60 * 1000;
const SCALE_MAX    = 200;
const RUNTIME_MAX  = 10;
const SCALE_TTL    = 30 * 24 * 60 * 60 * 1000;
const SCALE_WIN    = 7  * 24 * 60 * 60 * 1000;  // 7d analytics window

// ── Phase 981: Infrastructure observability ──────────────────────────────────

function _buildInfraSnapshot() {
  const now = Date.now();
  try {
    const hist = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
    })();
    const win = INFRA_TTL;
    const recent     = hist.filter(h => now - (h.ts || 0) < win);
    const successes  = recent.filter(h => h.ok !== false && h.status !== "failed").length;
    const failures   = recent.filter(h => h.ok === false || h.status === "failed").length;
    const total      = recent.length;
    const failRate   = total > 0 ? Math.round((failures / total) * 100) : 0;

    const queueSize = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_runtime_status") || "null")?.queue?.size || 0; }
      catch { return 0; }
    })();

    const replayHealth = (() => {
      try {
        const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
        if (!snap) return null;
        const ageMin = Math.round((now - (snap.ts || 0)) / 60000);
        return { ageMin, stale: ageMin > 360 };
      } catch { return null; }
    })();

    let infraScore = 100;
    if (failRate > 40)      infraScore -= 25;
    else if (failRate > 20) infraScore -= 10;
    if (queueSize > 20)     infraScore -= 20;
    else if (queueSize > 10) infraScore -= 8;
    if (replayHealth?.stale) infraScore -= 15;
    infraScore = Math.max(0, infraScore);

    return {
      ts: now,
      failRate,
      total,
      successes,
      failures,
      queueSize,
      replayHealth,
      infraScore,
      label: infraScore >= 80 ? "HEALTHY" : infraScore >= 55 ? "DEGRADED" : "CRITICAL",
      color: infraScore >= 80 ? "var(--op-green)" : infraScore >= 55 ? "var(--op-amber)" : "var(--op-red)",
    };
  } catch { return { ts: now, infraScore: 100, label: "HEALTHY", color: "var(--op-green)" }; }
}

// ── Phase 982: Scaling analytics ─────────────────────────────────────────────

const SCALE_EVENTS = new Set([
  "workspace_concurrency", "replay_latency", "deploy_efficiency",
  "workflow_throughput", "trust_progression", "queue_saturation",
  "runtime_isolation_breach", "scaling_risk",
]);

function _aggregateScalingAnalytics(events) {
  const now    = Date.now();
  const recent = events.filter(e => now - (e.ts || 0) < SCALE_WIN);
  const counts = {};
  recent.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });

  const riskEvents = (counts.queue_saturation || 0) + (counts.scaling_risk || 0) +
                     (counts.runtime_isolation_breach || 0);
  const riskLevel  = riskEvents > 5 ? "HIGH" : riskEvents > 2 ? "MODERATE" : "LOW";

  return {
    counts,
    riskLevel,
    riskColor: riskLevel === "HIGH" ? "var(--op-red)" :
               riskLevel === "MODERATE" ? "var(--op-amber)" : "var(--op-green)",
    topRisk: riskEvents > 0
      ? Object.entries(counts)
          .filter(([k]) => ["queue_saturation", "scaling_risk", "runtime_isolation_breach"].includes(k))
          .sort((a, b) => b[1] - a[1])[0]?.[0] || null
      : null,
    windowDays: 7,
  };
}

// ── Phase 983: Multi-runtime isolation ───────────────────────────────────────

const RUNTIME_NAMESPACES = [
  "jarvis_workflow_", "jarvis_replay_", "jarvis_exec_",
  "jarvis_deploy_", "jarvis_debug_",
];

function _checkRuntimeIsolation(runtimeId) {
  const violations = [];
  if (!runtimeId) return { isolated: true, violations };

  RUNTIME_NAMESPACES.forEach(prefix => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && !k.includes(runtimeId) && !k.endsWith("_global")) {
        // Key exists for different runtime — potential crossover
        // Only flag if there's a mismatched runtime suffix
        const parts = k.split("_");
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart !== runtimeId && lastPart.startsWith("rt")) {
          violations.push({ key: k, reason: "Runtime namespace crossover" });
        }
      }
    }
  });

  return { isolated: violations.length === 0, violations: violations.slice(0, 5) };
}

// ── Phase 984: Scaling performance hardening ──────────────────────────────────

function _computePerfTrend(loadSamples) {
  if (loadSamples.length < 2) return null;
  const recent = loadSamples[0];
  const older  = loadSamples[Math.min(4, loadSamples.length - 1)];
  if (!recent || !older) return null;

  const queueDelta = (recent.queueSize || 0) - (older.queueSize || 0);
  const execDelta  = (recent.recentExecs || 0) - (older.recentExecs || 0);

  return {
    queueTrend:   queueDelta > 3 ? "GROWING" : queueDelta < -3 ? "DRAINING" : "STABLE",
    execTrend:    execDelta  > 5 ? "BUSY"    : execDelta < -3  ? "QUIET"    : "NORMAL",
    queueDelta,
    execDelta,
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

export function useInfraObservability({ loadSamples = [] } = {}) {
  const [infraSnap,       setInfraSnap]       = useState(null);
  const [scaleEvents,     setScaleEvents]      = useState([]);
  const [runtimeSnaps,    setRuntimeSnaps]     = useState([]);
  const [initialized,     setInitialized]      = useState(false);

  const evaluate = useCallback(() => {
    const snap = _buildInfraSnapshot();
    setInfraSnap(snap);
    _save(INFRA_KEY, { snap, ts: Date.now() });

    // Record scaling event if risk detected
    if (snap.infraScore < 55) {
      const entry = { type: "scaling_risk", ts: Date.now(), score: snap.infraScore };
      setScaleEvents(prev => {
        const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < SCALE_TTL).slice(0, SCALE_MAX);
        _save(SCALE_KEY, next);
        return next;
      });
    }
    if (snap.queueSize > 15) {
      const entry = { type: "queue_saturation", ts: Date.now(), size: snap.queueSize };
      setScaleEvents(prev => {
        const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < SCALE_TTL).slice(0, SCALE_MAX);
        _save(SCALE_KEY, next);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const cached = _load(INFRA_KEY, null);
    if (cached?.snap && Date.now() - (cached.ts || 0) < INFRA_TTL) setInfraSnap(cached.snap);
    setScaleEvents(_load(SCALE_KEY, []).filter(e => Date.now() - (e.ts || 0) < SCALE_TTL));
    setRuntimeSnaps(_load(RUNTIME_KEY, []));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Record a scaling analytics event
  const recordScaleEvent = useCallback((eventType, meta = {}) => {
    if (!SCALE_EVENTS.has(eventType)) return;
    const entry = { type: eventType, ts: Date.now(), ...meta };
    setScaleEvents(prev => {
      const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < SCALE_TTL).slice(0, SCALE_MAX);
      _save(SCALE_KEY, next);
      return next;
    });
  }, []);

  // Validate runtime isolation for a given runtime ID
  const checkRuntimeIsolation = useCallback((runtimeId) => {
    const result = _checkRuntimeIsolation(runtimeId);
    if (!result.isolated) {
      const snap = { runtimeId, violations: result.violations, ts: Date.now() };
      setRuntimeSnaps(prev => {
        const next = [snap, ...prev].slice(0, RUNTIME_MAX);
        _save(RUNTIME_KEY, next);
        return next;
      });
      recordScaleEvent("runtime_isolation_breach");
    }
    return result;
  }, [recordScaleEvent]);

  // Aggregated scaling analytics
  const scalingAnalytics = useMemo(() => _aggregateScalingAnalytics(scaleEvents), [scaleEvents]);

  // Performance trend across load samples
  const perfTrend = useMemo(() => _computePerfTrend(loadSamples), [loadSamples]);

  // Infrastructure status pill for operator bar
  const infraStatusPill = useMemo(() => {
    if (!infraSnap || infraSnap.label === "HEALTHY") return null;
    return {
      label: infraSnap.label,
      color: infraSnap.color,
      detail: infraSnap.failRate > 0 ? `${infraSnap.failRate}% fail rate` :
              infraSnap.replayHealth?.stale ? "Replay stale" :
              infraSnap.queueSize > 10 ? `Queue: ${infraSnap.queueSize}` : null,
    };
  }, [infraSnap]);

  return {
    initialized,
    infraSnap,
    infraStatusPill,
    scaleEvents,
    scalingAnalytics,
    runtimeSnaps,
    perfTrend,
    // Actions
    evaluate,
    recordScaleEvent,
    checkRuntimeIsolation,
  };
}
