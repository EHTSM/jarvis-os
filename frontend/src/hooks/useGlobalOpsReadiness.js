// Phase 1392-1395: Execution performance audit + operational safety audit +
// global platform validation + global platform operations + infra maturity complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const GLOBPERF_KEY   = "jarvis_glob_perf_audit";
const GLOBSAFE_KEY   = "jarvis_glob_safety_audit";
const GLOBREADY_KEY  = "jarvis_glob_readiness";

const GLOBREADY_MAX  = 20;

const GLOBPERF_TTL   = 24 * 60 * 60 * 1000;
const GLOBSAFE_TTL   = 24 * 60 * 60 * 1000;
const GLOBREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1392: Execution performance audit ───────────────────────────────────

function _runGlobPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: deploy IDs unique
  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_regional_deployments") || "[]");
    const ids     = deploys.map(d => d.id);
    const dupes   = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "deploy_duplication", severity: "high", msg: `${dupes} duplicate regional deploy IDs` });
  } catch {}

  // No indexing leaks: infra analytics privacy-safe
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_infra_analytics") || "[]");
    const leaked = events.filter(e => e.userInput || e.rawContent || e.commandOutput);
    if (leaked.length > 0) findings.push({ id: "analytics_pii_leak", severity: "high", msg: `${leaked.length} infra analytics events with PII` });
  } catch {}

  // No unbounded memory: redundancy nodes bounded
  try {
    const nodes = JSON.parse(localStorage.getItem("jarvis_infra_redundancy") || "[]");
    if (nodes.length > 15) findings.push({ id: "node_overflow", severity: "medium", msg: `${nodes.length} redundancy nodes` });
  } catch {}

  // Active deploy saturation
  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_regional_deployments") || "[]");
    const active  = deploys.filter(d => !["complete", "rolled_back"].includes(d.stage));
    if (active.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${active.length} active regional deploys` });
  } catch {}

  // Survivability burst check
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_regional_survivability") || "[]");
    const burst  = events.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
    if (burst.length > 5) findings.push({ id: "surv_burst", severity: "medium", msg: `${burst.length} survivability events in 10s` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1393: Operational safety audit ─────────────────────────────────────

const GLOB_SAFETY_RULES = [
  {
    id:    "no_hidden_failover_escalation",
    label: "No hidden failover escalation",
    check: () => ["jarvis_glob_auto_escalate", "jarvis_auto_failover", "jarvis_glob_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_regional_execution",
    label: "No unsafe regional execution",
    check: () => {
      try {
        const deploys = JSON.parse(localStorage.getItem("jarvis_regional_deployments") || "[]");
        return deploys
          .filter(d => ["deploying", "verifying", "complete"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_regional_survivability") || "[]");
        const stale  = events.filter(e =>
          e.type === "replay_failure"
          && e.recovered === false
          && Date.now() - (e.ts || 0) > 4 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_recovery_loops",
    label: "No recursive recovery loops",
    check: () => {
      try {
        const nodes  = JSON.parse(localStorage.getItem("jarvis_infra_redundancy") || "[]");
        const recent = nodes.filter(n => Date.now() - (n.updatedAt || n.ts || 0) < 10 * 1000);
        return recent.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_glob_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_region_iso_state") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "redundancy_failover_approval_gated",
    label: "Redundancy failover is approval-gated",
    check: () => {
      try {
        const nodes = JSON.parse(localStorage.getItem("jarvis_infra_redundancy") || "[]");
        return nodes
          .filter(n => n.stage === "failover")
          .every(n => n.approvedAt);
      } catch { return true; }
    },
  },
];

function _runGlobSafetyAudit() {
  const results = GLOB_SAFETY_RULES.map(rule => ({
    id:     rule.id,
    label:  rule.label,
    passed: rule.check(),
    ts:     Date.now(),
  }));
  const passCount = results.filter(r => r.passed).length;
  return {
    results,
    passCount,
    total:     results.length,
    allPassed: passCount === results.length,
    score:     Math.round((passCount / results.length) * 100),
    ts:        Date.now(),
  };
}

// ── Phase 1394-1395: Validation + foundation complete ────────────────────────

function _computeGlobReadiness({
  perfScore       = 100,
  safetyScore     = 100,
  globalOpsScore  = 100,
  survScore       = 100,
  redundancyScore = 100,
  continuityScore = 100,
  forecastRisk    = "low",
  isoViolations   = 0,
} = {}) {
  const forecastPenalty = forecastRisk === "high" ? 15 : forecastRisk === "medium" ? 5 : 0;

  const composite = Math.round(
    safetyScore     * 0.25 +
    globalOpsScore  * 0.20 +
    continuityScore * 0.20 +
    survScore       * 0.15 +
    redundancyScore * 0.10 +
    perfScore       * 0.10
  )
  + (safetyScore === 100 ? 5 : 0)
  - forecastPenalty
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (continuityScore < 60) blockers.push("Global continuity degraded");
  if (survScore < 60)       blockers.push("Regional survivability critical");
  if (redundancyScore < 60) blockers.push("Infra redundancy degraded");
  if (isoViolations > 0)    blockers.push("Region isolation violations");
  if (forecastRisk === "high") blockers.push("Global reliability forecast high risk");

  return {
    score,
    label:   score >= 80 ? "GLOBALLY READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    blockers,
    ts:      Date.now(),
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

export function useGlobalOpsReadiness({
  globalOpsScore  = 100,
  survScore       = 100,
  redundancyScore = 100,
  continuityScore = 100,
  forecastRisk    = "low",
  isoViolations   = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runGlobPerfAudit();
    setPerfAudit(perf);
    _save(GLOBPERF_KEY, perf);

    const safety = _runGlobSafetyAudit();
    setSafetyAudit(safety);
    _save(GLOBSAFE_KEY, safety);

    const snap = _computeGlobReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      globalOpsScore, survScore, redundancyScore, continuityScore, forecastRisk, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < GLOBREADY_TTL)
        .slice(0, GLOBREADY_MAX);
      _save(GLOBREADY_KEY, next);
      return next;
    });
  }, [globalOpsScore, survScore, redundancyScore, continuityScore, forecastRisk, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(GLOBPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < GLOBPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(GLOBSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < GLOBSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(GLOBREADY_KEY, []).filter(s => now - (s.ts || 0) < GLOBREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const globalReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "GLOBAL",
      score:   latestReadiness.score,
      color:   latestReadiness.color,
      blocker: latestReadiness.blockers[0] || null,
    };
  }, [latestReadiness]);

  const readinessTrend = useMemo(() => {
    if (readiness.length < 2) return null;
    const delta = readiness[0].score - readiness[1].score;
    return delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
  }, [readiness]);

  return {
    initialized,
    perfAudit,
    safetyAudit,
    latestReadiness,
    globalReadinessPill,
    readinessTrend,
    evaluate,
  };
}
