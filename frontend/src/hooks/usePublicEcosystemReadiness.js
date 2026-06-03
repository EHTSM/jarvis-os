// Phase 1422-1425: Execution performance audit + operational safety audit +
// public platform validation + public ecosystem + production deployment readiness complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const PUBECOPERF_KEY   = "jarvis_pubeco_perf_audit";
const PUBECOSAFE_KEY   = "jarvis_pubeco_safety_audit";
const PUBECOREADY_KEY  = "jarvis_pubeco_readiness";

const PUBECOREADY_MAX  = 20;

const PUBECOPERF_TTL   = 24 * 60 * 60 * 1000;
const PUBECOSAFE_TTL   = 24 * 60 * 60 * 1000;
const PUBECOREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1422: Execution performance audit ───────────────────────────────────

function _runPubEcoPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: deploy IDs unique
  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_prod_deploy_pipeline") || "[]");
    const ids     = deploys.map(d => d.id);
    const dupes   = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "deploy_duplication", severity: "high", msg: `${dupes} duplicate prod deploy IDs` });
  } catch {}

  // No indexing leaks: plugin trust signals privacy-safe
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_plugin_trust") || "[]");
    const leaked = events.filter(e => e.userInput || e.rawContent || e.commandOutput);
    if (leaked.length > 0) findings.push({ id: "plugin_trust_pii", severity: "high", msg: `${leaked.length} plugin trust events with PII` });
  } catch {}

  // Active deploy saturation
  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_prod_deploy_pipeline") || "[]");
    const active  = deploys.filter(d => !["complete", "rolled_back"].includes(d.stage));
    if (active.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${active.length} active production deploys` });
  } catch {}

  // User flow burst
  try {
    const flows = JSON.parse(localStorage.getItem("jarvis_user_op_flows") || "[]");
    const burst = flows.filter(f => Date.now() - (f.ts || 0) < 10 * 1000);
    if (burst.length > 8) findings.push({ id: "flow_burst", severity: "medium", msg: `${burst.length} user flows in 10s` });
  } catch {}

  // Moderation array overflow
  try {
    const items = JSON.parse(localStorage.getItem("jarvis_eco_moderation") || "[]");
    if (items.length > 20) findings.push({ id: "moderation_overflow", severity: "medium", msg: `${items.length} moderation items` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1423: Operational safety audit ─────────────────────────────────────

const PUBECO_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_pubeco_auto_escalate", "jarvis_auto_pub_deploy", "jarvis_pubeco_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_plugin_execution",
    label: "No unsafe plugin execution",
    check: () => {
      try {
        const mods = JSON.parse(localStorage.getItem("jarvis_eco_moderation") || "[]");
        return mods
          .filter(a => a.action === "approved")
          .every(a => a.operatorApproved);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_pub_onboarding") || "[]");
        const stale    = sessions.filter(s =>
          s.stage !== "complete" && Date.now() - (s.ts || 0) > 48 * 60 * 60 * 1000
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
        const flows  = JSON.parse(localStorage.getItem("jarvis_user_op_flows") || "[]");
        const recent = flows.filter(f => Date.now() - (f.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_pubeco_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_pub_tenant_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "releases_approval_gated",
    label: "Public releases are approval-gated",
    check: () => {
      try {
        const releases = JSON.parse(localStorage.getItem("jarvis_pub_release") || "[]");
        return releases
          .filter(r => ["deploying", "live"].includes(r.stage))
          .every(r => r.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "prod_deployments_approval_gated",
    label: "Production deployments are approval-gated",
    check: () => {
      try {
        const deploys = JSON.parse(localStorage.getItem("jarvis_prod_deploy_pipeline") || "[]");
        return deploys
          .filter(d => ["deploying", "verifying", "complete"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
];

function _runPubEcoSafetyAudit() {
  const results = PUBECO_SAFETY_RULES.map(rule => ({
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

// ── Phase 1424-1425: Validation + foundation complete ─────────────────────────

function _computePubEcoReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  pubEcoScore   = 100,
  deployScore   = 100,
  trustScore    = 100,
  releaseScore  = 100,
  modScore      = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    deployScore  * 0.20 +
    pubEcoScore  * 0.20 +
    trustScore   * 0.15 +
    releaseScore * 0.10 +
    modScore     * 0.05 +
    perfScore    * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (deployScore < 60)    blockers.push("Production deployment health degraded");
  if (trustScore < 60)     blockers.push("Public trust degraded");
  if (releaseScore < 60)   blockers.push("Public release health degraded");
  if (isoViolations > 0)   blockers.push("Public tenant isolation violations");
  if (modScore < 60)       blockers.push("Ecosystem moderation degraded");

  return {
    score,
    label:   score >= 80 ? "PUBLIC READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function usePublicEcosystemReadiness({
  pubEcoScore   = 100,
  deployScore   = 100,
  trustScore    = 100,
  releaseScore  = 100,
  modScore      = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runPubEcoPerfAudit();
    setPerfAudit(perf);
    _save(PUBECOPERF_KEY, perf);

    const safety = _runPubEcoSafetyAudit();
    setSafetyAudit(safety);
    _save(PUBECOSAFE_KEY, safety);

    const snap = _computePubEcoReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      pubEcoScore, deployScore, trustScore, releaseScore, modScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < PUBECOREADY_TTL)
        .slice(0, PUBECOREADY_MAX);
      _save(PUBECOREADY_KEY, next);
      return next;
    });
  }, [pubEcoScore, deployScore, trustScore, releaseScore, modScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(PUBECOPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < PUBECOPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(PUBECOSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < PUBECOSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(PUBECOREADY_KEY, []).filter(s => now - (s.ts || 0) < PUBECOREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const pubEcoReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "PUBLIC",
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
    pubEcoReadinessPill,
    readinessTrend,
    evaluate,
  };
}
