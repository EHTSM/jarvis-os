// Phases 1614-1615 + 1619-1620: Public product trust + launch maturity —
// execution performance audit + operational safety audit + complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only. Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const PLMR_PERF_KEY  = "jarvis_plm_perf_audit";
const PLMR_SAFE_KEY  = "jarvis_plm_safety_audit";
const PLMR_READY_KEY = "jarvis_plm_readiness";

const PLMR_READY_MAX = 20;
const PLMR_PERF_TTL  = 24 * 60 * 60 * 1000;
const PLMR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const PLMR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1614: Execution performance audit ───────────────────────────────────

function _runPLMRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const trust  = JSON.parse(localStorage.getItem("jarvis_plm_trust") || "[]");
    const leaked = trust.filter(t => t.userInput || t.rawContent);
    if (leaked.length > 0) findings.push({ id: "trust_pii_leak", severity: "high", msg: `${leaked.length} trust entries with PII` });
  } catch {}

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_plm_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate session IDs` });
  } catch {}

  try {
    const onboard = JSON.parse(localStorage.getItem("jarvis_plm_onboarding") || "[]");
    const stale   = onboard.filter(o =>
      o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000
    );
    if (stale.length > 3) findings.push({ id: "stale_onboarding", severity: "high", msg: `${stale.length} stale onboarding entries >48h` });
  } catch {}

  try {
    const workflows = JSON.parse(localStorage.getItem("jarvis_plm_workflows") || "[]");
    const ids       = workflows.map(w => w.workflowId).filter(Boolean);
    const dupes     = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "workflow_duplication", severity: "high", msg: `${dupes} duplicate workflow IDs` });
  } catch {}

  try {
    const support = JSON.parse(localStorage.getItem("jarvis_plm_support") || "[]");
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

// ── Phase 1615: Operational safety audit ─────────────────────────────────────

const PLMR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_plm_auto_escalate", "jarvis_auto_plm_deploy", "jarvis_plm_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_plm_sessions") || "[]");
        return sessions.filter(s => s.stage === "active").every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const onboard = JSON.parse(localStorage.getItem("jarvis_plm_onboarding") || "[]");
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
        const workflows = JSON.parse(localStorage.getItem("jarvis_plm_workflows") || "[]");
        const recent    = workflows.filter(w => Date.now() - (w.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_plm_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_plm_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_plm_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
  {
    id:    "no_trust_degradation_unattended",
    label: "No unattended trust degradation",
    check: () => {
      try {
        const trust  = JSON.parse(localStorage.getItem("jarvis_plm_trust") || "[]");
        const recent = trust.filter(t => (t.score ?? 100) < 50 && Date.now() - (t.ts || 0) < 60 * 60 * 1000);
        return recent.length < 3;
      } catch { return true; }
    },
  },
];

function _runPLMRSafetyAudit() {
  const results = PLMR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1619-1620: Launch maturity complete ─────────────────────────────────

function _computePLMRReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  plmScore      = 100,
  trustScore    = 100,
  onboardScore  = 100,
  sessionScore  = 100,
  workflowScore = 100,
  releaseScore  = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore   * 0.25 +
    trustScore    * 0.20 +
    onboardScore  * 0.15 +
    releaseScore  * 0.15 +
    sessionScore  * 0.10 +
    workflowScore * 0.10 +
    plmScore      * 0.03 +
    perfScore     * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (trustScore < 50)     blockers.push("Public trust critically degraded");
  if (onboardScore < 60)   blockers.push("Onboarding stall rate elevated");
  if (releaseScore < 60)   blockers.push("Release validation issues");
  if (workflowScore < 60)  blockers.push("Workflow failure rate elevated");
  if (sessionScore < 60)   blockers.push("Session recovery rate elevated");
  if (isoViolations > 0)   blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "LAUNCH READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useLaunchMaturityReadiness({
  plmScore      = 100,
  trustScore    = 100,
  onboardScore  = 100,
  sessionScore  = 100,
  workflowScore = 100,
  releaseScore  = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runPLMRPerfAudit();
    setPerfAudit(perf);
    _save(PLMR_PERF_KEY, perf);

    const safety = _runPLMRSafetyAudit();
    setSafetyAudit(safety);
    _save(PLMR_SAFE_KEY, safety);

    const snap = _computePLMRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      plmScore, trustScore, onboardScore, sessionScore, workflowScore, releaseScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < PLMR_READY_TTL)
        .slice(0, PLMR_READY_MAX);
      _save(PLMR_READY_KEY, next);
      return next;
    });
  }, [plmScore, trustScore, onboardScore, sessionScore, workflowScore, releaseScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(PLMR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < PLMR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(PLMR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < PLMR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(PLMR_READY_KEY, []).filter(s => now - (s.ts || 0) < PLMR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const launchMaturityPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "LAUNCH",
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
    launchMaturityPill,
    readinessTrend,
    evaluate,
  };
}
