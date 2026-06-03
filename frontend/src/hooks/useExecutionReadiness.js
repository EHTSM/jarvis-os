// Phase 1315-1320: Execution performance audit + execution safety audit +
// execution validation + maturity audit + excellence validation + foundation complete.
//
// Consolidates six phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const EXECPERF_KEY   = "jarvis_exec_perf_audit";
const EXECSAFE_KEY   = "jarvis_exec_safety_audit";
const EXECREADY_KEY  = "jarvis_exec_readiness";

const EXECREADY_MAX  = 20;

const EXECPERF_TTL   = 24 * 60 * 60 * 1000;
const EXECSAFE_TTL   = 24 * 60 * 60 * 1000;
const EXECREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1315: Execution performance audit ───────────────────────────────────

function _runExecPerfAudit() {
  const now = Date.now();
  const findings = [];

  // Smoothness signal burst check (>5 in 5s)
  try {
    const sigs   = JSON.parse(localStorage.getItem("jarvis_exec_smoothness") || "[]");
    const burst  = sigs.filter(s => Date.now() - (s.ts || 0) < 5 * 1000);
    if (burst.length > 5) findings.push({ id: "smoothness_burst", severity: "medium", msg: `${burst.length} smoothness signals in 5s` });
  } catch {}

  // Maturity history size check
  try {
    const mats = JSON.parse(localStorage.getItem("jarvis_platform_maturity") || "[]");
    if (mats.length > 20) findings.push({ id: "maturity_overflow", severity: "medium", msg: `${mats.length} maturity snapshots` });
  } catch {}

  // Render event duplication check
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_render_discipline") || "[]");
    const types  = events.map(e => e.type + "|" + Math.floor((e.ts || 0) / 10000));
    const dupes  = types.length - new Set(types).size;
    if (dupes > 5) findings.push({ id: "render_duplication", severity: "medium", msg: `${dupes} duplicate render events` });
  } catch {}

  // Consistency signal overflow
  try {
    const sigs = JSON.parse(localStorage.getItem("jarvis_exec_consistency") || "[]");
    if (sigs.length > 20) findings.push({ id: "consistency_overflow", severity: "medium", msg: `${sigs.length} consistency signals` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1316: Execution safety audit ───────────────────────────────────────

const EXEC_SAFETY_RULES = [
  {
    id:    "no_hidden_execution_escalation",
    label: "No hidden execution escalation",
    check: () => ["jarvis_exec_auto_escalate", "jarvis_exec_escalate"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_replay_continuation",
    label: "No unsafe replay continuation",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_incident_recovery") || "[]");
        return recs
          .filter(r => ["executing", "verifying"].includes(r.stage))
          .every(r => r.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_runtime_restoration",
    label: "Stale runtime restoration not active",
    check: () => {
      try {
        const sigs = JSON.parse(localStorage.getItem("jarvis_exec_smoothness") || "[]");
        const stale = sigs.filter(s =>
          s.dim === "runtime"
          && s.outcome === "degraded"
          && Date.now() - (s.ts || 0) > 4 * 60 * 60 * 1000
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
        const events = JSON.parse(localStorage.getItem("jarvis_render_discipline") || "[]");
        const recent = events.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const sigs = JSON.parse(localStorage.getItem("jarvis_exec_consistency") || "[]");
        const corrupted = sigs.filter(s => s.outcome === "corrupted" && !["resolved", "closed"].includes(s.stage));
        return corrupted.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "memory_efficiency_safe",
    label: "Memory efficiency within safe bounds",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_memory_efficiency") || "[]");
        return events.every(e => !e.rawContent && !e.commandOutput && !e.userInput);
      } catch { return true; }
    },
  },
];

function _runExecSafetyAudit() {
  const results = EXEC_SAFETY_RULES.map(rule => ({
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

// ── Phase 1317-1320: Validation + maturity audit + excellence validation + foundation ─

function _computeExecReadiness({
  perfScore       = 100,
  safetyScore     = 100,
  maturityScore   = 100,
  smoothnessScore = 100,
  memoryScore     = 100,
  renderScore     = 100,
  consistencyScore = 100,
} = {}) {
  const composite = Math.round(
    safetyScore      * 0.25 +
    maturityScore    * 0.20 +
    smoothnessScore  * 0.15 +
    memoryScore      * 0.15 +
    renderScore      * 0.10 +
    consistencyScore * 0.10 +
    perfScore        * 0.05
  )
  + (safetyScore === 100 ? 5 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)       blockers.push("Safety audit failures");
  if (maturityScore < 60)      blockers.push("Platform maturity degraded");
  if (smoothnessScore < 60)    blockers.push("Execution smoothness degraded");
  if (memoryScore < 60)        blockers.push("Memory efficiency degraded");
  if (renderScore < 60)        blockers.push("Render discipline degraded");

  return {
    score,
    label:   score >= 80 ? "EXCELLENCE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useExecutionReadiness({
  maturityScore    = 100,
  smoothnessScore  = 100,
  memoryScore      = 100,
  renderScore      = 100,
  consistencyScore = 100,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runExecPerfAudit();
    setPerfAudit(perf);
    _save(EXECPERF_KEY, perf);

    const safety = _runExecSafetyAudit();
    setSafetyAudit(safety);
    _save(EXECSAFE_KEY, safety);

    const snap = _computeExecReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      maturityScore, smoothnessScore, memoryScore, renderScore, consistencyScore,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < EXECREADY_TTL)
        .slice(0, EXECREADY_MAX);
      _save(EXECREADY_KEY, next);
      return next;
    });
  }, [maturityScore, smoothnessScore, memoryScore, renderScore, consistencyScore]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(EXECPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < EXECPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(EXECSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < EXECSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(EXECREADY_KEY, []).filter(s => now - (s.ts || 0) < EXECREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const executionReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "EXEC",
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
    executionReadinessPill,
    readinessTrend,
    evaluate,
  };
}
