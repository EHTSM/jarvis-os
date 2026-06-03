// Phase 1182-1185: Execution performance audit + operational safety audit +
// engineering intelligence validation + foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const INTPERF_KEY  = "jarvis_intel_perf_audit";
const INTSAFE_KEY  = "jarvis_intel_safety_audit";
const INTREADY_KEY = "jarvis_intel_readiness";

const INTPERF_MAX  = 20;
const INTREADY_MAX = 20;

const INTPERF_TTL  = 24 * 60 * 60 * 1000;
const INTSAFE_TTL  = 24 * 60 * 60 * 1000;
const INTREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1182: Execution performance audit ───────────────────────────────────

function _runIntelPerfAudit() {
  const now = Date.now();
  let jarvisKeys = 0;
  let totalBytes = 0;
  let largestArray = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key) || "";
      totalBytes += key.length + val.length;
      if (!key?.startsWith("jarvis_")) continue;
      jarvisKeys++;
      const parsed = JSON.parse(val || "null");
      if (Array.isArray(parsed) && parsed.length > largestArray) largestArray = parsed.length;
    }
  } catch {}

  const findings = [];
  if (jarvisKeys > 140)       findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_100_000) findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)     findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Pattern deduplication check
  try {
    const patterns = JSON.parse(localStorage.getItem("jarvis_debug_patterns") || "[]");
    const types = patterns.map(p => p.type);
    const dupes = types.length - new Set(types).size;
    if (dupes > 0) findings.push({ id: "pattern_duplication", severity: "medium", msg: `${dupes} duplicate debug patterns` });
  } catch {}

  // Memory entry bound check
  try {
    const mem = JSON.parse(localStorage.getItem("jarvis_eng_memory") || "[]");
    if (mem.length > 20) findings.push({ id: "memory_overflow", severity: "medium", msg: `${mem.length} memory entries` });
  } catch {}

  return {
    ts:          now,
    jarvisKeys,
    totalBytes,
    largestArray,
    findings,
    highCount:   findings.filter(f => f.severity === "high").length,
    score:       findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1183: Operational safety audit ─────────────────────────────────────

const INTEL_SAFETY_RULES = [
  {
    id:    "no_hidden_prediction_escalation",
    label: "No hidden predictive escalation",
    check: () => {
      try {
        const risks = JSON.parse(localStorage.getItem("jarvis_deploy_risk") || "[]");
        // Risk predictions must only be advisory — no execution flags
        return risks.every(r => !r.autoExecute && !r.triggerDeploy);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_anomalies_ignored",
    label: "Anomalies not accumulating unaddressed",
    check: () => {
      try {
        const anoms = JSON.parse(localStorage.getItem("jarvis_op_anomalies") || "[]");
        const highUnresolved = anoms.filter(
          a => a.severity === "high" && Date.now() - (a.ts || 0) > 4 * 60 * 60 * 1000
        );
        return highUnresolved.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_intelligence",
    label: "No recursive intelligence loops",
    check: () => {
      try {
        const snaps = JSON.parse(localStorage.getItem("jarvis_repo_intelligence") || "[]");
        const recentSnaps = snaps.filter(s => Date.now() - (s.ts || 0) < 60 * 1000);
        return recentSnaps.length < 5; // max 5 intelligence evaluations per minute
      } catch { return true; }
    },
  },
  {
    id:    "memory_privacy_safe",
    label: "Engineering memory is privacy-safe",
    check: () => {
      try {
        const mem = JSON.parse(localStorage.getItem("jarvis_eng_memory") || "[]");
        // Check no memory entry has raw content fields
        return mem.every(m => !m.rawContent && !m.commandOutput && !m.userInput);
      } catch { return true; }
    },
  },
  {
    id:    "anomaly_count_bounded",
    label: "Anomalies bounded",
    check: () => {
      try {
        const anoms = JSON.parse(localStorage.getItem("jarvis_op_anomalies") || "[]");
        return Array.isArray(anoms) && anoms.length <= 30;
      } catch { return true; }
    },
  },
];

function _runIntelSafetyAudit() {
  const results = INTEL_SAFETY_RULES.map(rule => ({
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

// ── Phase 1184-1185: Validation + foundation complete ────────────────────────

function _computeIntelReadiness({
  perfScore         = 100,
  safetyScore       = 100,
  productivityScore = 100,
  repoHealth        = 100,
  activeAnomalies   = 0,
  isoViolations     = 0,
} = {}) {
  const composite = Math.round(
    safetyScore       * 0.30 +
    productivityScore * 0.25 +
    repoHealth        * 0.25 +
    perfScore         * 0.20
  )
  - (activeAnomalies > 0 ? Math.min(20, activeAnomalies * 5) : 0)
  - (isoViolations  > 0 ? 10 : 0)
  + (safetyScore === 100 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)       blockers.push("Safety audit failures");
  if (activeAnomalies > 2)     blockers.push(`${activeAnomalies} active anomalies`);
  if (repoHealth < 60)         blockers.push("Repository health critical");
  if (productivityScore < 50)  blockers.push("Engineering productivity low");
  if (isoViolations > 0)       blockers.push("Intelligence isolation violations");

  return {
    score,
    label:   score >= 80 ? "INTELLIGENCE READY" : score >= 60 ? "DEVELOPING" : "FOUNDATIONAL",
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

export function useIntelligenceReadiness({
  productivityScore = 100,
  repoHealth        = 100,
  activeAnomalies   = 0,
  isoViolations     = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runIntelPerfAudit();
    setPerfAudit(perf);
    _save(INTPERF_KEY, perf);

    const safety = _runIntelSafetyAudit();
    setSafetyAudit(safety);
    _save(INTSAFE_KEY, safety);

    const snap = _computeIntelReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      productivityScore, repoHealth, activeAnomalies, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < INTREADY_TTL)
        .slice(0, INTREADY_MAX);
      _save(INTREADY_KEY, next);
      return next;
    });
  }, [productivityScore, repoHealth, activeAnomalies, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(INTPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < INTPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(INTSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < INTSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(INTREADY_KEY, []).filter(s => now - (s.ts || 0) < INTREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const intelReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "INTEL",
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
    intelReadinessPill,
    readinessTrend,
    evaluate,
  };
}
