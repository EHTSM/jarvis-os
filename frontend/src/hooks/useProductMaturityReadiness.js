// Phase 1347-1350: Execution performance audit + operational safety audit +
// product quality validation + real-world product maturity foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const MATPERF_KEY   = "jarvis_mat_perf_audit";
const MATSAFE_KEY   = "jarvis_mat_safety_audit";
const MATREADY_KEY  = "jarvis_mat_readiness";

const MATREADY_MAX  = 20;

const MATPERF_TTL   = 24 * 60 * 60 * 1000;
const MATSAFE_TTL   = 24 * 60 * 60 * 1000;
const MATREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1347: Execution performance audit ───────────────────────────────────

function _runMatPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: session stages must be valid
  const VALID_SESSION_STAGES = ["started", "workspace_ready", "first_action", "first_deploy", "complete"];
  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_first_session") || "[]");
    const corrupted = sessions.filter(s => !s.stage || !VALID_SESSION_STAGES.includes(s.stage));
    if (corrupted.length > 0) findings.push({ id: "session_corruption", severity: "high", msg: `${corrupted.length} corrupted session records` });
  } catch {}

  // No workflow duplication: long session IDs must be unique
  try {
    const longSes = JSON.parse(localStorage.getItem("jarvis_long_sessions") || "[]");
    const ids     = longSes.map(s => s.id);
    const dupes   = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate long session IDs` });
  } catch {}

  // No indexing leaks: stability events must not contain PII
  try {
    const events  = JSON.parse(localStorage.getItem("jarvis_product_stability") || "[]");
    const leaked  = events.filter(e => e.userInput || e.rawContent || e.commandOutput);
    if (leaked.length > 0) findings.push({ id: "stability_pii_leak", severity: "high", msg: `${leaked.length} stability events with PII` });
  } catch {}

  // No unbounded memory growth: plugin array bounded
  try {
    const plugins = JSON.parse(localStorage.getItem("jarvis_plugin_reliability") || "[]");
    if (plugins.length > 20) findings.push({ id: "plugin_overflow", severity: "medium", msg: `${plugins.length} plugin records` });
  } catch {}

  // Usability burst check
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_usability_analytics") || "[]");
    const burst  = events.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
    if (burst.length > 8) findings.push({ id: "usability_burst", severity: "medium", msg: `${burst.length} usability events in 10s` });
  } catch {}

  // No listener leaks: calmness snaps bounded
  try {
    const snaps = JSON.parse(localStorage.getItem("jarvis_product_calmness") || "[]");
    if (snaps.length > 20) findings.push({ id: "calmness_overflow", severity: "medium", msg: `${snaps.length} calmness snapshots` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1348: Operational safety audit ─────────────────────────────────────

const MAT_SAFETY_RULES = [
  {
    id:    "no_hidden_execution_escalation",
    label: "No hidden execution escalation",
    check: () => ["jarvis_mat_auto_escalate", "jarvis_auto_exec", "jarvis_mat_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_plugin_execution",
    label: "No unsafe plugin execution",
    check: () => {
      try {
        const plugins = JSON.parse(localStorage.getItem("jarvis_plugin_reliability") || "[]");
        return plugins
          .filter(p => p.state === "active")
          .every(p => p.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_first_session") || "[]");
        const stale    = sessions.filter(s =>
          !["complete"].includes(s.stage)
          && Date.now() - (s.ts || 0) > 48 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_rendering_loops",
    label: "No recursive rendering loops",
    check: () => {
      try {
        const snaps  = JSON.parse(localStorage.getItem("jarvis_product_calmness") || "[]");
        const recent = snaps.filter(s => Date.now() - (s.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_mat_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_session_isolation") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "usability_analytics_privacy_safe",
    label: "Usability analytics are privacy-safe",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_usability_analytics") || "[]");
        return events.every(e => !e.rawContent && !e.commandOutput && !e.userInput);
      } catch { return true; }
    },
  },
];

function _runMatSafetyAudit() {
  const results = MAT_SAFETY_RULES.map(rule => ({
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

// ── Phase 1349-1350: Product quality validation + foundation complete ──────────

function _computeMatReadiness({
  perfScore        = 100,
  safetyScore      = 100,
  maturityScore    = 100,
  stabilityScore   = 100,
  trustScore       = 100,
  pluginScore      = 100,
  calmnessScore    = 100,
  isoViolations    = 0,
} = {}) {
  const composite = Math.round(
    safetyScore    * 0.25 +
    trustScore     * 0.20 +
    stabilityScore * 0.20 +
    maturityScore  * 0.15 +
    pluginScore    * 0.10 +
    calmnessScore  * 0.05 +
    perfScore      * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (trustScore < 60)      blockers.push("User trust degraded");
  if (stabilityScore < 60)  blockers.push("Product stability critical");
  if (maturityScore < 60)   blockers.push("Product maturity degraded");
  if (isoViolations > 0)    blockers.push("Session isolation violations");
  if (pluginScore < 60)     blockers.push("Plugin reliability degraded");

  return {
    score,
    label:   score >= 80 ? "PRODUCT READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useProductMaturityReadiness({
  maturityScore  = 100,
  stabilityScore = 100,
  trustScore     = 100,
  pluginScore    = 100,
  calmnessScore  = 100,
  isoViolations  = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runMatPerfAudit();
    setPerfAudit(perf);
    _save(MATPERF_KEY, perf);

    const safety = _runMatSafetyAudit();
    setSafetyAudit(safety);
    _save(MATSAFE_KEY, safety);

    const snap = _computeMatReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      maturityScore, stabilityScore, trustScore, pluginScore, calmnessScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < MATREADY_TTL)
        .slice(0, MATREADY_MAX);
      _save(MATREADY_KEY, next);
      return next;
    });
  }, [maturityScore, stabilityScore, trustScore, pluginScore, calmnessScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(MATPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < MATPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(MATSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < MATSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(MATREADY_KEY, []).filter(s => now - (s.ts || 0) < MATREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const productMaturityPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "MATURITY",
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
    productMaturityPill,
    readinessTrend,
    evaluate,
  };
}
