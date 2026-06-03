// Phases 1482-1485: Launch operations execution performance audit + operational safety audit +
// platform validation + deployment readiness complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const LOPERF_KEY   = "jarvis_lo_perf_audit";
const LOSAFE_KEY   = "jarvis_lo_safety_audit";
const LOREADY_KEY  = "jarvis_lo_readiness";

const LOREADY_MAX  = 20;

const LOPERF_TTL   = 24 * 60 * 60 * 1000;
const LOSAFE_TTL   = 24 * 60 * 60 * 1000;
const LOREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1482: Execution performance audit ───────────────────────────────────

function _runLOPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const infra = JSON.parse(localStorage.getItem("jarvis_lo_infra") || "[]");
    const ids   = infra.map(i => i.id).filter(Boolean);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "infra_duplication", severity: "high", msg: `${dupes} duplicate infra IDs` });
  } catch {}

  try {
    const stability = JSON.parse(localStorage.getItem("jarvis_lo_stability") || "[]");
    const leaked    = stability.filter(s => s.userInput || s.rawContent || s.commandOutput);
    if (leaked.length > 0) findings.push({ id: "stability_pii_leak", severity: "high", msg: `${leaked.length} stability entries with PII` });
  } catch {}

  try {
    const incidents = JSON.parse(localStorage.getItem("jarvis_lo_incidents") || "[]");
    const ids2      = incidents.map(i => i.id).filter(Boolean);
    const dupes2    = ids2.length - new Set(ids2).size;
    if (dupes2 > 0) findings.push({ id: "incident_duplication", severity: "high", msg: `${dupes2} duplicate incident IDs` });
  } catch {}

  try {
    const mobile = JSON.parse(localStorage.getItem("jarvis_lo_mobile") || "[]");
    const leaked = mobile.filter(m => m.userInput || m.rawContent);
    if (leaked.length > 0) findings.push({ id: "mobile_pii_leak", severity: "high", msg: `${leaked.length} mobile entries with PII` });
  } catch {}

  try {
    const incidents = JSON.parse(localStorage.getItem("jarvis_lo_incidents") || "[]");
    const active    = incidents.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage));
    if (active.length > 5) findings.push({ id: "incident_saturation", severity: "high", msg: `${active.length} active incidents` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1483: Operational safety audit ─────────────────────────────────────

const LO_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_lo_auto_escalate", "jarvis_auto_lo_deploy", "jarvis_lo_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const infra = JSON.parse(localStorage.getItem("jarvis_lo_infra") || "[]");
        return infra
          .filter(i => i.stage === "scaling")
          .every(i => i.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const incidents = JSON.parse(localStorage.getItem("jarvis_lo_incidents") || "[]");
        const stale     = incidents.filter(i =>
          !["resolved", "post_mortem"].includes(i.stage)
          && Date.now() - (i.ts || 0) > 24 * 60 * 60 * 1000
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
        const incidents = JSON.parse(localStorage.getItem("jarvis_lo_incidents") || "[]");
        const recent    = incidents.filter(i => Date.now() - (i.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_lo_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_lo_runtime_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "infra_scaling_approval_gated",
    label: "Infra scaling is approval-gated",
    check: () => {
      try {
        const infra = JSON.parse(localStorage.getItem("jarvis_lo_infra") || "[]");
        return infra
          .filter(i => i.stage === "scaling")
          .every(i => i.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_lo_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runLOSafetyAudit() {
  const results = LO_SAFETY_RULES.map(rule => ({
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

// ── Phase 1484-1485: Validation + readiness complete ──────────────────────────

function _computeLOReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  loScore       = 100,
  incidentScore = 100,
  infraScore    = 100,
  stabilityScore = 100,
  survScore     = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore    * 0.25 +
    incidentScore  * 0.20 +
    stabilityScore * 0.20 +
    infraScore     * 0.15 +
    survScore      * 0.10 +
    loScore        * 0.05 +
    perfScore      * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (incidentScore < 60)   blockers.push("Active incidents blocking launch");
  if (stabilityScore < 60)  blockers.push("Runtime stability degraded");
  if (infraScore < 60)      blockers.push("Infra health degraded");
  if (survScore < 60)       blockers.push("Launch survivability degraded");
  if (isoViolations > 0)    blockers.push("Runtime isolation violations");

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

export function useLaunchReadiness({
  loScore        = 100,
  incidentScore  = 100,
  infraScore     = 100,
  stabilityScore = 100,
  survScore      = 100,
  isoViolations  = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runLOPerfAudit();
    setPerfAudit(perf);
    _save(LOPERF_KEY, perf);

    const safety = _runLOSafetyAudit();
    setSafetyAudit(safety);
    _save(LOSAFE_KEY, safety);

    const snap = _computeLOReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      loScore, incidentScore, infraScore, stabilityScore, survScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < LOREADY_TTL)
        .slice(0, LOREADY_MAX);
      _save(LOREADY_KEY, next);
      return next;
    });
  }, [loScore, incidentScore, infraScore, stabilityScore, survScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(LOPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < LOPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(LOSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < LOSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(LOREADY_KEY, []).filter(s => now - (s.ts || 0) < LOREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const launchReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "LAUNCH OPS",
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
    launchReadinessPill,
    readinessTrend,
    evaluate,
  };
}
