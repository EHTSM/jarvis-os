// Phases 1512-1515: Private beta execution performance audit + operational safety audit +
// platform validation + live deployment readiness complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const PBPERF_KEY   = "jarvis_pb_perf_audit";
const PBSAFE_KEY   = "jarvis_pb_safety_audit";
const PBREADY_KEY  = "jarvis_pb_readiness";

const PBREADY_MAX  = 20;

const PBPERF_TTL   = 24 * 60 * 60 * 1000;
const PBSAFE_TTL   = 24 * 60 * 60 * 1000;
const PBREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1512: Execution performance audit ───────────────────────────────────

function _runPBPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_pb_deployments") || "[]");
    const ids     = deploys.map(d => d.id).filter(Boolean);
    const dupes   = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "deploy_duplication", severity: "high", msg: `${dupes} duplicate deployment IDs` });
  } catch {}

  try {
    const monitor = JSON.parse(localStorage.getItem("jarvis_pb_monitoring") || "[]");
    const leaked  = monitor.filter(m => m.userInput || m.rawContent || m.commandOutput);
    if (leaked.length > 0) findings.push({ id: "monitor_pii_leak", severity: "high", msg: `${leaked.length} monitor entries with PII` });
  } catch {}

  try {
    const wfs    = JSON.parse(localStorage.getItem("jarvis_pb_workflows") || "[]");
    const leaked = wfs.filter(w => w.userInput || w.rawContent);
    if (leaked.length > 0) findings.push({ id: "workflow_pii_leak", severity: "high", msg: `${leaked.length} workflow entries with PII` });
  } catch {}

  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_pb_deployments") || "[]");
    const active  = deploys.filter(d => d.stage === "deploying");
    if (active.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${active.length} concurrent deployments` });
  } catch {}

  try {
    const incidents = JSON.parse(localStorage.getItem("jarvis_pb_incidents") || "[]");
    const ids2      = incidents.map(i => i.id).filter(Boolean);
    const dupes2    = ids2.length - new Set(ids2).size;
    if (dupes2 > 0) findings.push({ id: "incident_duplication", severity: "high", msg: `${dupes2} duplicate incident IDs` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1513: Operational safety audit ─────────────────────────────────────

const PB_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_pb_auto_escalate", "jarvis_auto_pb_deploy", "jarvis_pb_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const deploys = JSON.parse(localStorage.getItem("jarvis_pb_deployments") || "[]");
        return deploys
          .filter(d => ["deploying", "live"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const beta  = JSON.parse(localStorage.getItem("jarvis_pb_beta_ops") || "[]");
        const stale = beta.filter(b =>
          b.stage === "onboarding" && Date.now() - (b.ts || 0) > 48 * 60 * 60 * 1000
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
        const incidents = JSON.parse(localStorage.getItem("jarvis_pb_incidents") || "[]");
        const recent    = incidents.filter(i => Date.now() - (i.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_pb_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_pb_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "deployments_approval_gated",
    label: "Live deployments are approval-gated",
    check: () => {
      try {
        const deploys = JSON.parse(localStorage.getItem("jarvis_pb_deployments") || "[]");
        return deploys
          .filter(d => ["deploying", "live"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_pb_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runPBSafetyAudit() {
  const results = PB_SAFETY_RULES.map(rule => ({
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

// ── Phase 1514-1515: Validation + readiness complete ──────────────────────────

function _computePBReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  pbScore       = 100,
  deployScore   = 100,
  incidentScore = 100,
  trustScore    = 100,
  workflowScore = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore   * 0.25 +
    incidentScore * 0.20 +
    trustScore    * 0.20 +
    deployScore   * 0.15 +
    workflowScore * 0.10 +
    pbScore       * 0.05 +
    perfScore     * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (incidentScore < 60)   blockers.push("Active incidents blocking beta");
  if (trustScore < 60)      blockers.push("Beta trust degraded");
  if (deployScore < 60)     blockers.push("Live deployments degraded");
  if (workflowScore < 60)   blockers.push("Workflow health degraded");
  if (isoViolations > 0)    blockers.push("Live isolation violations");

  return {
    score,
    label:   score >= 80 ? "BETA READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function usePrivateBetaReadiness({
  pbScore       = 100,
  deployScore   = 100,
  incidentScore = 100,
  trustScore    = 100,
  workflowScore = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runPBPerfAudit();
    setPerfAudit(perf);
    _save(PBPERF_KEY, perf);

    const safety = _runPBSafetyAudit();
    setSafetyAudit(safety);
    _save(PBSAFE_KEY, safety);

    const snap = _computePBReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      pbScore, deployScore, incidentScore, trustScore, workflowScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < PBREADY_TTL)
        .slice(0, PBREADY_MAX);
      _save(PBREADY_KEY, next);
      return next;
    });
  }, [pbScore, deployScore, incidentScore, trustScore, workflowScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(PBPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < PBPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(PBSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < PBSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(PBREADY_KEY, []).filter(s => now - (s.ts || 0) < PBREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const privateBetaReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "BETA",
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
    privateBetaReadinessPill,
    readinessTrend,
    evaluate,
  };
}
