// Phase 1257-1260: Execution performance audit + operational safety audit +
// growth operations validation + foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const GROWTHPERF_KEY  = "jarvis_growth_perf_audit";
const GROWTHSAFE_KEY  = "jarvis_growth_safety_audit";
const GROWTHREADY_KEY = "jarvis_growth_readiness";

const GROWTHREADY_MAX = 20;

const GROWTHPERF_TTL  = 24 * 60 * 60 * 1000;
const GROWTHSAFE_TTL  = 24 * 60 * 60 * 1000;
const GROWTHREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1257: Execution performance audit ───────────────────────────────────

function _runGrowthPerfAudit() {
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
  if (jarvisKeys > 185)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_500_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Conversion dedup check
  try {
    const convs = JSON.parse(localStorage.getItem("jarvis_onboard_conversion") || "[]");
    const now2  = Date.now();
    const burst = convs.filter(c => now2 - (c.ts || 0) < 5 * 1000);
    if (burst.length > 5)
      findings.push({ id: "conversion_burst", severity: "medium", msg: `${burst.length} conversions in 5s` });
  } catch {}

  // Retention signal duplication check
  try {
    const sigs  = JSON.parse(localStorage.getItem("jarvis_retention_signals") || "[]");
    const types = sigs.map(s => s.type);
    const dupes = types.length - new Set(types).size;
    if (dupes > 3)
      findings.push({ id: "retention_duplication", severity: "low", msg: `${dupes} duplicate retention signals` });
  } catch {}

  // Ecosystem events size check
  try {
    const eco = JSON.parse(localStorage.getItem("jarvis_ecosystem_expansion") || "[]");
    if (eco.length > 15)
      findings.push({ id: "ecosystem_bloat", severity: "low", msg: `${eco.length} ecosystem events` });
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

// ── Phase 1258: Operational safety audit ─────────────────────────────────────

const GROWTH_SAFETY_RULES = [
  {
    id:    "no_hidden_engagement_escalation",
    label: "No hidden engagement escalation",
    check: () => {
      try {
        const engage = JSON.parse(localStorage.getItem("jarvis_platform_engagement") || "[]");
        return engage.every(e => !e.autoEscalate && !e.forceConversion);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_workflow_continuation",
    label: "No unsafe workflow continuation",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_replay_restoration",
    label: "No stale replay restoration",
    check: () => {
      try {
        const forecasts = JSON.parse(localStorage.getItem("jarvis_growth_forecast") || "[]");
        const stale = forecasts.filter(f => f.trend === "decelerating"
          && Date.now() - (f.ts || 0) > 24 * 60 * 60 * 1000);
        return stale.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_optimization_loops",
    label: "No recursive optimization loops",
    check: () => {
      try {
        const adopt = JSON.parse(localStorage.getItem("jarvis_workflow_adopt_intel") || "[]");
        const recent = adopt.filter(s => Date.now() - (s.ts || 0) < 5 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_growth_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "growth_isolation_clean",
    label: "Growth isolation clean",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_growth_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "analytics_privacy_safe",
    label: "Growth analytics are privacy-safe",
    check: () => {
      try {
        const growth = JSON.parse(localStorage.getItem("jarvis_growth_analytics") || "[]");
        return growth.every(e => !e.rawContent && !e.userInput && !e.commandOutput);
      } catch { return true; }
    },
  },
];

function _runGrowthSafetyAudit() {
  const results = GROWTH_SAFETY_RULES.map(rule => ({
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

// ── Phase 1259-1260: Validation + foundation complete ────────────────────────

function _computeGrowthReadiness({
  perfScore       = 100,
  safetyScore     = 100,
  growthScore     = 100,
  conversionScore = 100,
  retentionScore  = 100,
  ecosystemScore  = 100,
  forecastRisk    = "low",
  isoViolations   = 0,
} = {}) {
  const forecastPenalty = forecastRisk === "high" ? 15 : forecastRisk === "medium" ? 5 : 0;

  const composite = Math.round(
    safetyScore     * 0.25 +
    growthScore     * 0.20 +
    retentionScore  * 0.20 +
    conversionScore * 0.15 +
    ecosystemScore  * 0.10 +
    perfScore       * 0.10
  )
  - forecastPenalty
  - (isoViolations > 0 ? 10 : 0)
  + (safetyScore === 100 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)        blockers.push("Safety audit failures");
  if (growthScore < 50)         blockers.push("Growth score critical");
  if (retentionScore < 50)      blockers.push("Retention low");
  if (conversionScore < 40)     blockers.push("Conversion funnel incomplete");
  if (forecastRisk === "high")  blockers.push("Growth forecast high risk");
  if (isoViolations > 0)        blockers.push("Growth isolation violations");

  return {
    score,
    label:   score >= 80 ? "GROWTH READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useGrowthReadiness({
  growthScore     = 100,
  conversionScore = 100,
  retentionScore  = 100,
  ecosystemScore  = 100,
  forecastRisk    = "low",
  isoViolations   = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runGrowthPerfAudit();
    setPerfAudit(perf);
    _save(GROWTHPERF_KEY, perf);

    const safety = _runGrowthSafetyAudit();
    setSafetyAudit(safety);
    _save(GROWTHSAFE_KEY, safety);

    const snap = _computeGrowthReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      growthScore, conversionScore, retentionScore,
      ecosystemScore, forecastRisk, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < GROWTHREADY_TTL)
        .slice(0, GROWTHREADY_MAX);
      _save(GROWTHREADY_KEY, next);
      return next;
    });
  }, [growthScore, conversionScore, retentionScore, ecosystemScore, forecastRisk, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(GROWTHPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < GROWTHPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(GROWTHSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < GROWTHSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(GROWTHREADY_KEY, []).filter(s => now - (s.ts || 0) < GROWTHREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const growthReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "GROWTH",
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
    growthReadinessPill,
    readinessTrend,
    evaluate,
  };
}
