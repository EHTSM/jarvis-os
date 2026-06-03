// Phase 1226-1230: Execution performance audit + operational safety audit +
// resilience validation + resilience operations audit + foundation complete.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const RESPERF_KEY  = "jarvis_res_perf_audit";
const RESSAFE_KEY  = "jarvis_res_safety_audit";
const RESREADY_KEY = "jarvis_res_readiness";

const RESREADY_MAX = 20;

const RESPERF_TTL  = 24 * 60 * 60 * 1000;
const RESSAFE_TTL  = 24 * 60 * 60 * 1000;
const RESREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1226: Execution performance audit ───────────────────────────────────

function _runResPerfAudit() {
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
  if (jarvisKeys > 160)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_300_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Obs snapshot duplication check
  try {
    const snaps = JSON.parse(localStorage.getItem("jarvis_obs_snapshots") || "[]");
    const recentTs = snaps.map(s => s.ts || 0).filter(t => Date.now() - t < 5 * 1000);
    if (recentTs.length > 5)
      findings.push({ id: "obs_burst", severity: "medium", msg: `${recentTs.length} obs snapshots in 5s` });
  } catch {}

  // Recovery state size check
  try {
    const recs = JSON.parse(localStorage.getItem("jarvis_recovery_state") || "[]");
    if (recs.length > 8)
      findings.push({ id: "recovery_bloat", severity: "medium", msg: `${recs.length} recovery entries` });
  } catch {}

  // Degradation array check
  try {
    const deg = JSON.parse(localStorage.getItem("jarvis_infra_degradation") || "[]");
    if (deg.length > 15)
      findings.push({ id: "degradation_bloat", severity: "low", msg: `${deg.length} degradation entries` });
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

// ── Phase 1227: Operational safety audit ─────────────────────────────────────

const RES_SAFETY_RULES = [
  {
    id:    "no_hidden_recovery_escalation",
    label: "No hidden recovery escalation",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_recovery_state") || "[]");
        return recs.every(r => r.stage !== "execute" || r.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_remediation",
    label: "No unsafe automated remediation",
    check: () => ["jarvis_auto_remediate", "jarvis_self_heal_exec"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_recovery_state") || "[]");
        const staleReplay = recs.filter(
          r => r.type === "replay_instability"
            && !["complete", "failed"].includes(r.stage)
            && Date.now() - (r.ts || 0) > 2 * 60 * 60 * 1000
        );
        return staleReplay.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_coordination",
    label: "No recursive coordination loops",
    check: () => {
      try {
        const snaps = JSON.parse(localStorage.getItem("jarvis_obs_snapshots") || "[]");
        const recentSnaps = snaps.filter(s => Date.now() - (s.ts || 0) < 10 * 1000);
        return recentSnaps.length < 5;
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
    id:    "heal_recs_bounded",
    label: "Heal recommendations bounded",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_heal_recommendations") || "[]");
        return Array.isArray(recs) && recs.length <= 15;
      } catch { return true; }
    },
  },
  {
    id:    "obs_isolation_clean",
    label: "Observability isolation clean",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_obs_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
];

function _runResSafetyAudit() {
  const results = RES_SAFETY_RULES.map(rule => ({
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

// ── Phase 1228-1230: Validation + audit + foundation complete ────────────────

function _computeResReadiness({
  perfScore       = 100,
  safetyScore     = 100,
  obsScore        = 100,
  diagScore       = 100,
  forecastRisk    = "low",
  isoViolations   = 0,
  activeRecoveries = 0,
} = {}) {
  const forecastPenalty = forecastRisk === "high" ? 15 : forecastRisk === "medium" ? 5 : 0;

  const composite = Math.round(
    safetyScore * 0.30 +
    obsScore    * 0.25 +
    diagScore   * 0.25 +
    perfScore   * 0.20
  )
  - forecastPenalty
  - (isoViolations   > 0 ? 10 : 0)
  - (activeRecoveries > 3 ? 5  : 0)
  + (safetyScore === 100 ? 10  : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)       blockers.push("Safety audit failures");
  if (obsScore < 60)           blockers.push("Observability score critical");
  if (diagScore < 60)          blockers.push("Distributed diagnostics degraded");
  if (forecastRisk === "high") blockers.push("Resilience forecast high risk");
  if (isoViolations > 0)       blockers.push("Observability isolation violations");

  return {
    score,
    label:   score >= 80 ? "RESILIENCE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useResilienceReadiness({
  obsScore        = 100,
  diagScore       = 100,
  forecastRisk    = "low",
  isoViolations   = 0,
  activeRecoveries = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runResPerfAudit();
    setPerfAudit(perf);
    _save(RESPERF_KEY, perf);

    const safety = _runResSafetyAudit();
    setSafetyAudit(safety);
    _save(RESSAFE_KEY, safety);

    const snap = _computeResReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      obsScore, diagScore, forecastRisk, isoViolations, activeRecoveries,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < RESREADY_TTL)
        .slice(0, RESREADY_MAX);
      _save(RESREADY_KEY, next);
      return next;
    });
  }, [obsScore, diagScore, forecastRisk, isoViolations, activeRecoveries]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(RESPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < RESPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(RESSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < RESSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(RESREADY_KEY, []).filter(s => now - (s.ts || 0) < RESREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const resilienceReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "RES",
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
    resilienceReadinessPill,
    readinessTrend,
    evaluate,
  };
}
