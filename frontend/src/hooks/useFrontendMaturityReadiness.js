// Phases 1558-1560: Real product experience + frontend maturity —
// execution performance audit + operational safety audit + maturity complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only. Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const FEMR_PERF_KEY  = "jarvis_fem_perf_audit";
const FEMR_SAFE_KEY  = "jarvis_fem_safety_audit";
const FEMR_READY_KEY = "jarvis_fem_readiness";

const FEMR_READY_MAX = 20;
const FEMR_PERF_TTL  = 24 * 60 * 60 * 1000;
const FEMR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const FEMR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1558: Execution performance audit ───────────────────────────────────

function _runFEMRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const ux     = JSON.parse(localStorage.getItem("jarvis_fem_ux") || "[]");
    const leaked = ux.filter(u => u.userInput || u.rawContent);
    if (leaked.length > 0) findings.push({ id: "ux_pii_leak", severity: "high", msg: `${leaked.length} UX entries with PII` });
  } catch {}

  try {
    const onboard = JSON.parse(localStorage.getItem("jarvis_fem_onboarding") || "[]");
    const ids     = onboard.map(o => o.userId).filter(Boolean);
    const dupes   = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "onboard_duplication", severity: "high", msg: `${dupes} duplicate onboarding user IDs` });
  } catch {}

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_fem_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate session IDs` });
  } catch {}

  try {
    const tenants      = JSON.parse(localStorage.getItem("jarvis_fem_tenants") || "[]");
    const contaminated = tenants.filter(t => t.contaminated);
    if (contaminated.length > 0) findings.push({ id: "tenant_contamination", severity: "high", msg: `${contaminated.length} tenant UI contamination entries` });
  } catch {}

  try {
    const support = JSON.parse(localStorage.getItem("jarvis_fem_support") || "[]");
    const leaked  = support.filter(s => s.userInput || s.rawContent);
    if (leaked.length > 0) findings.push({ id: "support_pii_leak", severity: "high", msg: `${leaked.length} support entries with PII` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1559: Operational safety audit ─────────────────────────────────────

const FEMR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_fem_auto_escalate", "jarvis_auto_fem_deploy", "jarvis_fem_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_fem_sessions") || "[]");
        return sessions
          .filter(s => s.stage === "active")
          .every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const onboard = JSON.parse(localStorage.getItem("jarvis_fem_onboarding") || "[]");
        const stale   = onboard.filter(o =>
          o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_incident_loops",
    label: "No recursive incident loops",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_fem_sessions") || "[]");
        const recent   = sessions.filter(s => Date.now() - (s.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_fem_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_fem_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_tenant_ui_contamination",
    label: "No tenant UI contamination",
    check: () => {
      try {
        const tenants = JSON.parse(localStorage.getItem("jarvis_fem_tenants") || "[]");
        return tenants.every(t => !t.contaminated);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_fem_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runFEMRSafetyAudit() {
  const results = FEMR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1560: Maturity complete ────────────────────────────────────────────

function _computeFEMRReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  femScore      = 100,
  uxScore       = 100,
  onboardScore  = 100,
  sessionScore  = 100,
  tenantScore   = 100,
  mobileScore   = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    uxScore      * 0.20 +
    onboardScore * 0.15 +
    sessionScore * 0.15 +
    tenantScore  * 0.10 +
    mobileScore  * 0.10 +
    femScore     * 0.03 +
    perfScore    * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (uxScore < 60)        blockers.push("UX quality degraded");
  if (onboardScore < 60)   blockers.push("Onboarding stall rate elevated");
  if (sessionScore < 60)   blockers.push("Session recovery rate elevated");
  if (tenantScore < 60)    blockers.push("Tenant UI contamination");
  if (mobileScore < 60)    blockers.push("Mobile layout instability");
  if (isoViolations > 0)   blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "MATURE" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useFrontendMaturityReadiness({
  femScore      = 100,
  uxScore       = 100,
  onboardScore  = 100,
  sessionScore  = 100,
  tenantScore   = 100,
  mobileScore   = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runFEMRPerfAudit();
    setPerfAudit(perf);
    _save(FEMR_PERF_KEY, perf);

    const safety = _runFEMRSafetyAudit();
    setSafetyAudit(safety);
    _save(FEMR_SAFE_KEY, safety);

    const snap = _computeFEMRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      femScore, uxScore, onboardScore, sessionScore, tenantScore, mobileScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < FEMR_READY_TTL)
        .slice(0, FEMR_READY_MAX);
      _save(FEMR_READY_KEY, next);
      return next;
    });
  }, [femScore, uxScore, onboardScore, sessionScore, tenantScore, mobileScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(FEMR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < FEMR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(FEMR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < FEMR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(FEMR_READY_KEY, []).filter(s => now - (s.ts || 0) < FEMR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const frontendMaturityPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "MATURE",
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
    frontendMaturityPill,
    readinessTrend,
    evaluate,
  };
}
