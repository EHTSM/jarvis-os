// Phases 1467-1470: Launch execution monetization performance audit + operational safety audit +
// platform validation + maturity complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const MIPERF_KEY   = "jarvis_mi_perf_audit";
const MISAFE_KEY   = "jarvis_mi_safety_audit";
const MIREADY_KEY  = "jarvis_mi_readiness";

const MIREADY_MAX  = 20;

const MIPERF_TTL   = 24 * 60 * 60 * 1000;
const MISAFE_TTL   = 24 * 60 * 60 * 1000;
const MIREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1467: Execution performance audit ───────────────────────────────────

function _runMIPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const subs  = JSON.parse(localStorage.getItem("jarvis_mi_subscriptions") || "[]");
    const ids   = subs.map(s => s.id).filter(Boolean);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "sub_duplication", severity: "high", msg: `${dupes} duplicate subscription IDs` });
  } catch {}

  try {
    const txns   = JSON.parse(localStorage.getItem("jarvis_mi_transactions") || "[]");
    const leaked = txns.filter(t => t.cardNumber || t.cvv || t.rawPayload);
    if (leaked.length > 0) findings.push({ id: "txn_pii_leak", severity: "high", msg: `${leaked.length} transactions with PII` });
  } catch {}

  try {
    const billing = JSON.parse(localStorage.getItem("jarvis_mi_billing") || "[]");
    const failed  = billing.filter(b => b.stage === "failed");
    if (failed.length > 3) findings.push({ id: "billing_failures", severity: "high", msg: `${failed.length} failed billing events` });
  } catch {}

  try {
    const creator = JSON.parse(localStorage.getItem("jarvis_mi_creator_revenue") || "[]");
    const leaked  = creator.filter(c => c.userInput || c.rawContent);
    if (leaked.length > 0) findings.push({ id: "creator_pii_leak", severity: "high", msg: `${leaked.length} creator entries with PII` });
  } catch {}

  const TTL_24H = 24 * 60 * 60 * 1000;
  try {
    const txns    = JSON.parse(localStorage.getItem("jarvis_mi_transactions") || "[]");
    const recent  = txns.filter(t => Date.now() - (t.ts || 0) < TTL_24H);
    const refunds = recent.filter(t => t.type === "refund").length;
    if (recent.length > 0 && refunds / recent.length > 0.3) {
      findings.push({ id: "refund_spike", severity: "medium", msg: `High refund rate: ${refunds}/${recent.length}` });
    }
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1468: Operational safety audit ─────────────────────────────────────

const MI_SAFETY_RULES = [
  {
    id:    "no_hidden_billing_escalation",
    label: "No hidden billing escalation",
    check: () => ["jarvis_mi_auto_escalate", "jarvis_auto_billing", "jarvis_mi_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_marketplace_execution",
    label: "No unsafe marketplace execution",
    check: () => {
      try {
        const creator = JSON.parse(localStorage.getItem("jarvis_mi_creator_revenue") || "[]");
        return creator
          .filter(c => c.type === "payout")
          .every(c => c.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const subs  = JSON.parse(localStorage.getItem("jarvis_mi_subscriptions") || "[]");
        const stale = subs.filter(s =>
          s.stage === "trialing" && Date.now() - (s.ts || 0) > 48 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_monetization_loops",
    label: "No recursive monetization loops",
    check: () => {
      try {
        const growth = JSON.parse(localStorage.getItem("jarvis_mi_growth") || "[]");
        const recent = growth.filter(g => Date.now() - (g.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_mi_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_mi_billing_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "subscriptions_approval_gated",
    label: "Active subscriptions are approval-gated",
    check: () => {
      try {
        const subs = JSON.parse(localStorage.getItem("jarvis_mi_subscriptions") || "[]");
        return subs
          .filter(s => s.stage === "active")
          .every(s => s.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "billing_privacy_safe",
    label: "Billing state is privacy-safe",
    check: () => {
      try {
        const billing = JSON.parse(localStorage.getItem("jarvis_mi_billing") || "[]");
        return billing.every(b => !b.cardNumber && !b.cvv && !b.rawPayload);
      } catch { return true; }
    },
  },
];

function _runMISafetyAudit() {
  const results = MI_SAFETY_RULES.map(rule => ({
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

// ── Phase 1469-1470: Validation + maturity complete ───────────────────────────

function _computeMIReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  miScore       = 100,
  subScore      = 100,
  billingScore  = 100,
  txnScore      = 100,
  revSurvScore  = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    billingScore * 0.20 +
    subScore     * 0.20 +
    txnScore     * 0.15 +
    revSurvScore * 0.10 +
    miScore      * 0.05 +
    perfScore    * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (billingScore < 60)   blockers.push("Billing health degraded");
  if (subScore < 60)       blockers.push("Subscription health degraded");
  if (txnScore < 60)       blockers.push("Marketplace transactions degraded");
  if (revSurvScore < 60)   blockers.push("Revenue survivability degraded");
  if (isoViolations > 0)   blockers.push("Billing isolation violations");

  return {
    score,
    label:   score >= 80 ? "MONETIZATION READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useMonetizationReadiness({
  miScore       = 100,
  subScore      = 100,
  billingScore  = 100,
  txnScore      = 100,
  revSurvScore  = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runMIPerfAudit();
    setPerfAudit(perf);
    _save(MIPERF_KEY, perf);

    const safety = _runMISafetyAudit();
    setSafetyAudit(safety);
    _save(MISAFE_KEY, safety);

    const snap = _computeMIReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      miScore, subScore, billingScore, txnScore, revSurvScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < MIREADY_TTL)
        .slice(0, MIREADY_MAX);
      _save(MIREADY_KEY, next);
      return next;
    });
  }, [miScore, subScore, billingScore, txnScore, revSurvScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(MIPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < MIPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(MISAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < MISAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(MIREADY_KEY, []).filter(s => now - (s.ts || 0) < MIREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const monetizationReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "MONETIZE",
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
    monetizationReadinessPill,
    readinessTrend,
    evaluate,
  };
}
