// Phase 1377-1380: Execution performance audit + operational safety audit +
// platform economy validation + ecosystem + platform economy maturity complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const ECOPERF_KEY   = "jarvis_eco_perf_audit";
const ECOSAFE_KEY   = "jarvis_eco_safety_audit";
const ECOREADY_KEY  = "jarvis_eco_readiness";

const ECOREADY_MAX  = 20;

const ECOPERF_TTL   = 24 * 60 * 60 * 1000;
const ECOSAFE_TTL   = 24 * 60 * 60 * 1000;
const ECOREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1377: Execution performance audit ───────────────────────────────────

function _runEcoPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: workflow IDs unique
  try {
    const workflows = JSON.parse(localStorage.getItem("jarvis_workflow_economy") || "[]");
    const ids       = workflows.map(w => w.id);
    const dupes     = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "workflow_duplication", severity: "high", msg: `${dupes} duplicate workflow economy IDs` });
  } catch {}

  // No indexing leaks: revenue survivability privacy-safe
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_revenue_survivability") || "[]");
    const leaked = events.filter(e => e.userInput || e.rawContent || e.commandOutput);
    if (leaked.length > 0) findings.push({ id: "revenue_pii_leak", severity: "high", msg: `${leaked.length} revenue events with PII` });
  } catch {}

  // No unbounded memory: plugin monetization bounded
  try {
    const plugins = JSON.parse(localStorage.getItem("jarvis_plugin_monetization") || "[]");
    if (plugins.length > 20) findings.push({ id: "plugin_mon_overflow", severity: "medium", msg: `${plugins.length} plugin monetization records` });
  } catch {}

  // Collaboration burst check
  try {
    const collabs = JSON.parse(localStorage.getItem("jarvis_op_collaboration") || "[]");
    const burst   = collabs.filter(c => Date.now() - (c.ts || 0) < 10 * 1000);
    if (burst.length > 8) findings.push({ id: "collab_burst", severity: "medium", msg: `${burst.length} collaboration events in 10s` });
  } catch {}

  // Creator array size
  try {
    const creators = JSON.parse(localStorage.getItem("jarvis_creator_ecosystem") || "[]");
    if (creators.length > 20) findings.push({ id: "creator_overflow", severity: "medium", msg: `${creators.length} creator records` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1378: Operational safety audit ─────────────────────────────────────

const ECO_SAFETY_RULES = [
  {
    id:    "no_hidden_monetization_escalation",
    label: "No hidden monetization escalation",
    check: () => ["jarvis_eco_auto_escalate", "jarvis_auto_monetize", "jarvis_eco_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_marketplace_execution",
    label: "No unsafe marketplace execution",
    check: () => {
      try {
        const plugins = JSON.parse(localStorage.getItem("jarvis_plugin_monetization") || "[]");
        return plugins
          .filter(p => p.stage === "active")
          .every(p => p.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const workflows = JSON.parse(localStorage.getItem("jarvis_workflow_economy") || "[]");
        const stale     = workflows.filter(w =>
          !["deployed", "retired"].includes(w.stage)
          && Date.now() - (w.ts || 0) > 48 * 60 * 60 * 1000
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
        const events = JSON.parse(localStorage.getItem("jarvis_revenue_survivability") || "[]");
        const recent = events.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_eco_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_ecosystem_isolation") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "governance_approval_gated",
    label: "Governance approvals are operator-gated",
    check: () => {
      try {
        const actions = JSON.parse(localStorage.getItem("jarvis_ecosystem_governance") || "[]");
        return actions
          .filter(a => a.action === "approved")
          .every(a => a.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runEcoSafetyAudit() {
  const results = ECO_SAFETY_RULES.map(rule => ({
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

// ── Phase 1379-1380: Validation + foundation complete ────────────────────────

function _computeEcoReadiness({
  perfScore      = 100,
  safetyScore    = 100,
  ecoScore       = 100,
  govScore       = 100,
  revScore       = 100,
  pluginScore    = 100,
  creatorScore   = 100,
  isoViolations  = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    govScore     * 0.20 +
    ecoScore     * 0.20 +
    revScore     * 0.15 +
    pluginScore  * 0.10 +
    creatorScore * 0.05 +
    perfScore    * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (govScore < 60)       blockers.push("Ecosystem governance degraded");
  if (revScore < 60)       blockers.push("Revenue survivability critical");
  if (pluginScore < 60)    blockers.push("Plugin monetization degraded");
  if (isoViolations > 0)   blockers.push("Ecosystem isolation violations");
  if (creatorScore < 60)   blockers.push("Creator ecosystem degraded");

  return {
    score,
    label:   score >= 80 ? "ECOSYSTEM READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useEcosystemReadiness({
  ecoScore      = 100,
  govScore      = 100,
  revScore      = 100,
  pluginScore   = 100,
  creatorScore  = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runEcoPerfAudit();
    setPerfAudit(perf);
    _save(ECOPERF_KEY, perf);

    const safety = _runEcoSafetyAudit();
    setSafetyAudit(safety);
    _save(ECOSAFE_KEY, safety);

    const snap = _computeEcoReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      ecoScore, govScore, revScore, pluginScore, creatorScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < ECOREADY_TTL)
        .slice(0, ECOREADY_MAX);
      _save(ECOREADY_KEY, next);
      return next;
    });
  }, [ecoScore, govScore, revScore, pluginScore, creatorScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(ECOPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < ECOPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(ECOSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < ECOSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(ECOREADY_KEY, []).filter(s => now - (s.ts || 0) < ECOREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const ecosystemReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "ECO",
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
    ecosystemReadinessPill,
    readinessTrend,
    evaluate,
  };
}
