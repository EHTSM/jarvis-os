// Phase 1242-1245: Execution performance audit + operational safety audit +
// customer operations validation + foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const CUSTPERF_KEY  = "jarvis_cust_perf_audit";
const CUSTSAFE_KEY  = "jarvis_cust_safety_audit";
const CUSTREADY_KEY = "jarvis_cust_readiness";

const CUSTREADY_MAX = 20;

const CUSTPERF_TTL  = 24 * 60 * 60 * 1000;
const CUSTSAFE_TTL  = 24 * 60 * 60 * 1000;
const CUSTREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1242: Execution performance audit ───────────────────────────────────

function _runCustPerfAudit() {
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
  if (jarvisKeys > 170)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_400_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Org duplication check
  try {
    const orgs = JSON.parse(localStorage.getItem("jarvis_orgs") || "[]");
    const ids  = orgs.map(o => o.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "org_duplication", severity: "high", msg: `${dupes} duplicate org IDs` });
  } catch {}

  // Escalation count check
  try {
    const escs   = JSON.parse(localStorage.getItem("jarvis_support_escalations") || "[]");
    const active = escs.filter(e => !["resolved", "closed"].includes(e.stage));
    if (active.length > 5) findings.push({ id: "escalation_bloat", severity: "medium", msg: `${active.length} active escalations` });
  } catch {}

  // Onboarding duplication check
  try {
    const obs  = JSON.parse(localStorage.getItem("jarvis_org_onboarding") || "[]");
    const active = obs.filter(o => o.stage !== "complete");
    const orgIds = active.map(o => o.orgId);
    const dupes  = orgIds.length - new Set(orgIds).size;
    if (dupes > 0) findings.push({ id: "onboarding_duplication", severity: "medium", msg: `${dupes} duplicate active onboardings` });
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

// ── Phase 1243: Operational safety audit ─────────────────────────────────────

const CUST_SAFETY_RULES = [
  {
    id:    "no_hidden_onboarding_escalation",
    label: "No hidden onboarding escalation",
    check: () => {
      try {
        const obs = JSON.parse(localStorage.getItem("jarvis_org_onboarding") || "[]");
        return obs.every(o => !o.autoEscalate && !o.bypassApproval);
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
    label: "No stale replay restoration active",
    check: () => {
      try {
        const escs = JSON.parse(localStorage.getItem("jarvis_support_escalations") || "[]");
        const staleReplay = escs.filter(
          e => e.type === "replay_failure"
            && !["resolved", "closed"].includes(e.stage)
            && Date.now() - (e.ts || 0) > 4 * 60 * 60 * 1000
        );
        return staleReplay.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_coordination",
    label: "No recursive org coordination loops",
    check: () => {
      try {
        const orgs = JSON.parse(localStorage.getItem("jarvis_orgs") || "[]");
        const recentUpdates = orgs.filter(o => Date.now() - (o.updatedAt || 0) < 5 * 1000);
        return recentUpdates.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_cross_org_contamination",
    label: "No cross-org contamination",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_org_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "productivity_privacy_safe",
    label: "Productivity data is privacy-safe",
    check: () => {
      try {
        const prod = JSON.parse(localStorage.getItem("jarvis_team_productivity") || "[]");
        return prod.every(s => !s.rawContent && !s.commandOutput && !s.userInput);
      } catch { return true; }
    },
  },
  {
    id:    "escalations_bounded",
    label: "Escalations bounded",
    check: () => {
      try {
        const escs = JSON.parse(localStorage.getItem("jarvis_support_escalations") || "[]");
        return Array.isArray(escs) && escs.length <= 15;
      } catch { return true; }
    },
  },
];

function _runCustSafetyAudit() {
  const results = CUST_SAFETY_RULES.map(rule => ({
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

// ── Phase 1244-1245: Validation + foundation complete ────────────────────────

function _computeCustReadiness({
  perfScore          = 100,
  safetyScore        = 100,
  opsScore           = 100,
  customerHealth     = 100,
  adoptionScore      = 100,
  survivabilityScore = 100,
  isoViolations      = 0,
  activeEscalations  = 0,
} = {}) {
  const composite = Math.round(
    safetyScore        * 0.25 +
    opsScore           * 0.20 +
    customerHealth     * 0.20 +
    adoptionScore      * 0.15 +
    survivabilityScore * 0.10 +
    perfScore          * 0.10
  )
  - (isoViolations    > 0 ? 10 : 0)
  - (activeEscalations > 3 ? 5  : 0)
  + (safetyScore === 100   ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)        blockers.push("Safety audit failures");
  if (customerHealth < 60)      blockers.push("Customer health critical");
  if (adoptionScore < 50)       blockers.push("Adoption score low");
  if (survivabilityScore < 60)  blockers.push("Account survivability low");
  if (isoViolations > 0)        blockers.push("Org isolation violations");
  if (activeEscalations > 5)    blockers.push(`${activeEscalations} active escalations`);

  return {
    score,
    label:   score >= 80 ? "CUSTOMER OPS READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useCustomerOpsReadiness({
  opsScore           = 100,
  customerHealth     = 100,
  adoptionScore      = 100,
  survivabilityScore = 100,
  isoViolations      = 0,
  activeEscalations  = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runCustPerfAudit();
    setPerfAudit(perf);
    _save(CUSTPERF_KEY, perf);

    const safety = _runCustSafetyAudit();
    setSafetyAudit(safety);
    _save(CUSTSAFE_KEY, safety);

    const snap = _computeCustReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      opsScore, customerHealth, adoptionScore,
      survivabilityScore, isoViolations, activeEscalations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < CUSTREADY_TTL)
        .slice(0, CUSTREADY_MAX);
      _save(CUSTREADY_KEY, next);
      return next;
    });
  }, [opsScore, customerHealth, adoptionScore, survivabilityScore, isoViolations, activeEscalations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(CUSTPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < CUSTPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(CUSTSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < CUSTSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(CUSTREADY_KEY, []).filter(s => now - (s.ts || 0) < CUSTREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const customerOpsReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "CUST",
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
    customerOpsReadinessPill,
    readinessTrend,
    evaluate,
  };
}
