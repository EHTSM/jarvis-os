// Phase 1137-1140: Execution performance audit + operational safety audit +
// commercialization validation + SaaS foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 perf samples, 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const SAASPERF_KEY  = "jarvis_saas_perf_audit";
const SAASSAFE_KEY  = "jarvis_saas_safety_audit";
const SAASREADY_KEY = "jarvis_saas_readiness";

const SAASPERF_MAX  = 20;
const SAASREADY_MAX = 20;

const SAASPERF_TTL  = 24 * 60 * 60 * 1000;
const SAASSAFE_TTL  = 24 * 60 * 60 * 1000;
const SAASREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1137: Execution performance audit ───────────────────────────────────

function _runSaasPerfAudit() {
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
  if (jarvisKeys > 110)       findings.push({ id: "key_count",     severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 800_000)   findings.push({ id: "storage_size",  severity: "medium", msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)     findings.push({ id: "large_array",   severity: "high",   msg: `Array of ${largestArray} items` });

  // Quota array size check
  try {
    const quota = JSON.parse(localStorage.getItem("jarvis_saas_quota") || "null");
    if (quota && typeof quota === "object" && !Array.isArray(quota)) {
      // Quota is an object — check nested arrays
      const dims = Object.values(quota);
      if (dims.some(d => Array.isArray(d) && d.length > 200)) {
        findings.push({ id: "quota_unbounded", severity: "high", msg: "Quota dimension array unbounded" });
      }
    }
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

// ── Phase 1138: Operational safety audit ─────────────────────────────────────

const SAAS_SAFETY_RULES = [
  {
    id:    "no_hidden_billing_escalation",
    label: "No hidden billing escalation",
    check: () => {
      try {
        const plan = JSON.parse(localStorage.getItem("jarvis_saas_plan") || "null");
        // Grace period must have been explicitly set (gracePeriod=true) — not silently active
        if (plan?.gracePeriod && !plan?.graceEndsAt) return false; // missing end date = bad state
        return true;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_entitlement",
    label: "No unsafe entitlement execution",
    check: () => {
      try {
        const plan = JSON.parse(localStorage.getItem("jarvis_saas_plan") || "null");
        if (!plan) return true;
        // Suspended/cancelled plans must not have enterprise features active
        const billing = JSON.parse(localStorage.getItem("jarvis_saas_billing") || "[]");
        const suspended = billing.some(b => b.status === "suspended" || b.status === "cancelled");
        if (suspended && plan.planId === "enterprise") return false;
        return true;
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_quota_reset",
    label: "No stale quota state",
    check: () => {
      try {
        const quota = JSON.parse(localStorage.getItem("jarvis_saas_quota") || "null");
        if (!quota?.resetAt) return true;
        // Quota should have been reset if past reset date
        return Date.now() < quota.resetAt || (Date.now() - quota.resetAt) < 7 * 24 * 60 * 60 * 1000;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_billing",
    label: "No recursive billing recovery loops",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_saas_lifecycle") || "[]");
        const recentFailures = events.filter(
          e => e.type === "billing_failure" && Date.now() - (e.ts || 0) < 10 * 60 * 1000
        );
        return recentFailures.length < 3; // max 3 failures in 10 min
      } catch { return true; }
    },
  },
  {
    id:    "tenant_isolation_clean",
    label: "Tenant isolation clean",
    check: () => {
      try {
        const iso = JSON.parse(localStorage.getItem("jarvis_tenant_isolation") || "[]");
        const recent = iso.filter(e => Date.now() - (e.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "analytics_bounded",
    label: "SaaS analytics bounded",
    check: () => {
      try {
        const anal = JSON.parse(localStorage.getItem("jarvis_saas_analytics") || "[]");
        return Array.isArray(anal) && anal.length <= 50;
      } catch { return true; }
    },
  },
];

function _runSaasSafetyAudit() {
  const results = SAAS_SAFETY_RULES.map(rule => ({
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

// ── Phase 1139-1140: Validation + foundation complete ────────────────────────

function _computeSaasReadiness({
  perfScore          = 100,
  safetyScore        = 100,
  saasDashboardScore = 100,
  survivabilityScore = 100,
  gracePeriodActive  = false,
} = {}) {
  const composite = Math.round(
    safetyScore        * 0.30 +
    saasDashboardScore * 0.35 +
    perfScore          * 0.15 +
    survivabilityScore * 0.20
  ) - (gracePeriodActive ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)       blockers.push("Safety audit failures");
  if (saasDashboardScore < 60) blockers.push("SaaS health degraded");
  if (gracePeriodActive)       blockers.push("Billing grace period active");
  if (survivabilityScore < 70) blockers.push("Survivability degraded");

  return {
    score,
    label:   score >= 80 ? "SAAS READY" : score >= 60 ? "NEEDS WORK" : "NOT READY",
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

export function useSaasReadiness({
  saasDashboardScore = 100,
  survivabilityScore = 100,
  gracePeriodActive  = false,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runSaasPerfAudit();
    setPerfAudit(perf);
    _save(SAASPERF_KEY, perf);

    const safety = _runSaasSafetyAudit();
    setSafetyAudit(safety);
    _save(SAASSAFE_KEY, safety);

    const snap = _computeSaasReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      saasDashboardScore, survivabilityScore, gracePeriodActive,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < SAASREADY_TTL)
        .slice(0, SAASREADY_MAX);
      _save(SAASREADY_KEY, next);
      return next;
    });
  }, [saasDashboardScore, survivabilityScore, gracePeriodActive]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(SAASPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < SAASPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(SAASSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < SAASSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(SAASREADY_KEY, []).filter(s => now - (s.ts || 0) < SAASREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  // Calm pill — hidden when SaaS ready (Phase 1136 UX)
  const saasReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "SAAS",
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
    saasReadinessPill,
    readinessTrend,
    evaluate,
  };
}
