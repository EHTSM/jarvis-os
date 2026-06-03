// Phases 1452-1455: Production rollout execution performance audit + operational safety audit +
// platform validation + excellence complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const PRPERF_KEY   = "jarvis_pr_perf_audit";
const PRSAFE_KEY   = "jarvis_pr_safety_audit";
const PRREADY_KEY  = "jarvis_pr_readiness";

const PRREADY_MAX  = 20;

const PRPERF_TTL   = 24 * 60 * 60 * 1000;
const PRSAFE_TTL   = 24 * 60 * 60 * 1000;
const PRREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1452: Execution performance audit ───────────────────────────────────

function _runPRPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No rollout duplication
  try {
    const rollouts = JSON.parse(localStorage.getItem("jarvis_pr_rollout") || "[]");
    const ids      = rollouts.map(r => r.id).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "rollout_duplication", severity: "high", msg: `${dupes} duplicate rollout IDs` });
  } catch {}

  // Trust signals privacy-safe
  try {
    const trust  = JSON.parse(localStorage.getItem("jarvis_pr_trust") || "[]");
    const leaked = trust.filter(t => t.userInput || t.rawContent || t.commandOutput);
    if (leaked.length > 0) findings.push({ id: "trust_pii_leak", severity: "high", msg: `${leaked.length} trust entries with PII` });
  } catch {}

  // Rollout saturation
  try {
    const rollouts = JSON.parse(localStorage.getItem("jarvis_pr_rollout") || "[]");
    const active   = rollouts.filter(r => ["rolling", "canary", "staged"].includes(r.stage));
    if (active.length > 6) findings.push({ id: "rollout_saturation", severity: "high", msg: `${active.length} active rollouts` });
  } catch {}

  // Support overflow
  try {
    const support = JSON.parse(localStorage.getItem("jarvis_pr_support") || "[]");
    const open    = support.filter(s => s.stage === "open");
    if (open.length > 8) findings.push({ id: "support_overflow", severity: "medium", msg: `${open.length} open support items` });
  } catch {}

  // Eco stability privacy-safe
  try {
    const eco    = JSON.parse(localStorage.getItem("jarvis_pr_eco_stability") || "[]");
    const leaked = eco.filter(e => e.userInput || e.rawContent);
    if (leaked.length > 0) findings.push({ id: "eco_pii_leak", severity: "high", msg: `${leaked.length} eco entries with PII` });
  } catch {}

  // Onboarding stale overflow
  try {
    const ob    = JSON.parse(localStorage.getItem("jarvis_pr_onboarding") || "[]");
    const stale = ob.filter(o => o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000);
    if (stale.length > 3) findings.push({ id: "stale_onboarding", severity: "medium", msg: `${stale.length} stale onboarding sessions` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1453: Operational safety audit ─────────────────────────────────────

const PR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_pr_auto_escalate", "jarvis_auto_pr_deploy", "jarvis_pr_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_plugin_execution",
    label: "No unsafe plugin execution",
    check: () => {
      try {
        const plugins = JSON.parse(localStorage.getItem("jarvis_pr_plugin_quality") || "[]");
        return plugins.every(p => !p.unsafeExec);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const ob    = JSON.parse(localStorage.getItem("jarvis_pr_onboarding") || "[]");
        const stale = ob.filter(o =>
          o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_runtime_loops",
    label: "No recursive runtime loops",
    check: () => {
      try {
        const eco    = JSON.parse(localStorage.getItem("jarvis_pr_eco_stability") || "[]");
        const recent = eco.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_pr_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_pr_tenant_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "rollout_approval_gated",
    label: "Active rollouts are approval-gated",
    check: () => {
      try {
        const rollouts = JSON.parse(localStorage.getItem("jarvis_pr_rollout") || "[]");
        return rollouts
          .filter(r => ["rolling", "canary"].includes(r.stage))
          .every(r => r.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_pr_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runPRSafetyAudit() {
  const results = PR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1454-1455: Validation + excellence complete ─────────────────────────

function _computePRReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  prScore       = 100,
  rolloutScore  = 100,
  trustScore    = 100,
  onboardScore  = 100,
  ecoScore      = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    trustScore   * 0.20 +
    rolloutScore * 0.20 +
    onboardScore * 0.15 +
    ecoScore     * 0.10 +
    prScore      * 0.05 +
    perfScore    * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (trustScore < 60)     blockers.push("Platform trust degraded");
  if (rolloutScore < 60)   blockers.push("Rollout health degraded");
  if (onboardScore < 60)   blockers.push("Onboarding degraded");
  if (ecoScore < 60)       blockers.push("Ecosystem stability degraded");
  if (isoViolations > 0)   blockers.push("Multi-tenant isolation violations");

  return {
    score,
    label:   score >= 80 ? "ROLLOUT READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useProductionRolloutReadiness({
  prScore       = 100,
  rolloutScore  = 100,
  trustScore    = 100,
  onboardScore  = 100,
  ecoScore      = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runPRPerfAudit();
    setPerfAudit(perf);
    _save(PRPERF_KEY, perf);

    const safety = _runPRSafetyAudit();
    setSafetyAudit(safety);
    _save(PRSAFE_KEY, safety);

    const snap = _computePRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      prScore, rolloutScore, trustScore, onboardScore, ecoScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < PRREADY_TTL)
        .slice(0, PRREADY_MAX);
      _save(PRREADY_KEY, next);
      return next;
    });
  }, [prScore, rolloutScore, trustScore, onboardScore, ecoScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(PRPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < PRPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(PRSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < PRSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(PRREADY_KEY, []).filter(s => now - (s.ts || 0) < PRREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const rolloutReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "ROLLOUT",
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
    rolloutReadinessPill,
    readinessTrend,
    evaluate,
  };
}
