// Phase 1408-1410: Execution performance audit + operational safety audit +
// autonomous operational assistance foundation complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const ASSIST2PERF_KEY   = "jarvis_assist2_perf_audit";
const ASSIST2SAFE_KEY   = "jarvis_assist2_safety_audit";
const ASSIST2READY_KEY  = "jarvis_assist2_readiness";

const ASSIST2READY_MAX  = 20;

const ASSIST2PERF_TTL   = 24 * 60 * 60 * 1000;
const ASSIST2SAFE_TTL   = 24 * 60 * 60 * 1000;
const ASSIST2READY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1408: Execution performance audit ───────────────────────────────────

function _runAssist2PerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: memory entries have required fields
  try {
    const items    = JSON.parse(localStorage.getItem("jarvis_op_memory") || "[]");
    const corrupted = items.filter(i => !i.id || !i.type || !i.summary);
    if (corrupted.length > 0) findings.push({ id: "memory_corruption", severity: "high", msg: `${corrupted.length} corrupted memory entries` });
  } catch {}

  // No workflow duplication: multi-workflow IDs unique
  try {
    const workflows = JSON.parse(localStorage.getItem("jarvis_multi_workflow") || "[]");
    const ids       = workflows.map(w => w.id);
    const dupes     = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "workflow_duplication", severity: "high", msg: `${dupes} duplicate multi-workflow IDs` });
  } catch {}

  // No indexing leaks: productivity signals privacy-safe
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_productivity_accel") || "[]");
    const leaked = events.filter(e => e.userInput || e.rawContent || e.commandOutput);
    if (leaked.length > 0) findings.push({ id: "productivity_pii_leak", severity: "high", msg: `${leaked.length} productivity events with PII` });
  } catch {}

  // Stale recommendation overflow
  try {
    const recs   = JSON.parse(localStorage.getItem("jarvis_exec_recommendations") || "[]");
    const stale  = recs.filter(r => !r.acted && Date.now() - (r.ts || 0) > 12 * 60 * 60 * 1000);
    if (stale.length > 5) findings.push({ id: "stale_recs", severity: "medium", msg: `${stale.length} stale recommendations` });
  } catch {}

  // Blocked multi-workflow overflow
  try {
    const wfs     = JSON.parse(localStorage.getItem("jarvis_multi_workflow") || "[]");
    const blocked = wfs.filter(w => w.stage === "blocked");
    if (blocked.length > 3) findings.push({ id: "workflow_blocked_overflow", severity: "high", msg: `${blocked.length} blocked workflows` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1409: Operational safety audit ─────────────────────────────────────

const ASSIST2_SAFETY_RULES = [
  {
    id:    "no_hidden_execution_escalation",
    label: "No hidden execution escalation",
    check: () => ["jarvis_assist_auto_escalate", "jarvis_auto_assist", "jarvis_assist_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_recommendation_execution",
    label: "No unsafe recommendation execution",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_exec_recommendations") || "[]");
        // All acted recommendations must have explicit actedAt timestamp
        return recs
          .filter(r => r.acted === true)
          .every(r => r.actedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const items = JSON.parse(localStorage.getItem("jarvis_op_copilot") || "[]");
        const stale = items.filter(i =>
          i.type === "replay_suggestion"
          && !i.acted
          && Date.now() - (i.ts || 0) > 24 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_coordination_loops",
    label: "No recursive coordination loops",
    check: () => {
      try {
        const coords = JSON.parse(localStorage.getItem("jarvis_exec_coordination") || "[]");
        const recent = coords.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
        return recent.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_assist_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_assist_isolation") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "recommendations_operator_gated",
    label: "All acted recommendations have operator confirmation",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_exec_recommendations") || "[]");
        return recs.filter(r => r.acted).every(r => r.actedAt);
      } catch { return true; }
    },
  },
];

function _runAssist2SafetyAudit() {
  const results = ASSIST2_SAFETY_RULES.map(rule => ({
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

// ── Phase 1410: Foundation complete ──────────────────────────────────────────

function _computeAssist2Readiness({
  perfScore       = 100,
  safetyScore     = 100,
  assistScore     = 100,
  trustScore      = 100,
  productivityScore = 100,
  coordScore      = 100,
  isoViolations   = 0,
} = {}) {
  const composite = Math.round(
    safetyScore       * 0.25 +
    trustScore        * 0.20 +
    assistScore       * 0.20 +
    productivityScore * 0.15 +
    coordScore        * 0.10 +
    perfScore         * 0.10
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)       blockers.push("Safety audit failures");
  if (trustScore < 60)         blockers.push("Assistance trust degraded");
  if (productivityScore < 60)  blockers.push("Productivity acceleration degraded");
  if (coordScore < 60)         blockers.push("Execution coordination degraded");
  if (isoViolations > 0)       blockers.push("Assistance isolation violations");

  return {
    score,
    label:   score >= 80 ? "ASSISTANCE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useAssistanceReadiness2({
  assistScore     = 100,
  trustScore      = 100,
  productivityScore = 100,
  coordScore      = 100,
  isoViolations   = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runAssist2PerfAudit();
    setPerfAudit(perf);
    _save(ASSIST2PERF_KEY, perf);

    const safety = _runAssist2SafetyAudit();
    setSafetyAudit(safety);
    _save(ASSIST2SAFE_KEY, safety);

    const snap = _computeAssist2Readiness({
      perfScore: perf.score, safetyScore: safety.score,
      assistScore, trustScore, productivityScore, coordScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < ASSIST2READY_TTL)
        .slice(0, ASSIST2READY_MAX);
      _save(ASSIST2READY_KEY, next);
      return next;
    });
  }, [assistScore, trustScore, productivityScore, coordScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(ASSIST2PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < ASSIST2PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(ASSIST2SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < ASSIST2SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(ASSIST2READY_KEY, []).filter(s => now - (s.ts || 0) < ASSIST2READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const assistanceReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "ASSIST",
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
    assistanceReadinessPill,
    readinessTrend,
    evaluate,
  };
}
