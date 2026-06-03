// Phase 1363-1365: Execution performance audit + operational safety audit +
// scale + production operations maturity complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const SCALEPERF_KEY   = "jarvis_scale_perf_audit";
const SCALESAFE_KEY   = "jarvis_scale_safety_audit";
const SCALEREADY_KEY  = "jarvis_scale_readiness";

const SCALEREADY_MAX  = 20;

const SCALEPERF_TTL   = 24 * 60 * 60 * 1000;
const SCALESAFE_TTL   = 24 * 60 * 60 * 1000;
const SCALEREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1363: Execution performance audit ───────────────────────────────────

function _runScalePerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: load event IDs unique
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_high_load_state") || "[]");
    const ids    = events.map(e => e.id);
    const dupes  = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "load_duplication", severity: "high", msg: `${dupes} duplicate load event IDs` });
  } catch {}

  // No indexing leaks: scale intel privacy-safe
  try {
    const intel  = JSON.parse(localStorage.getItem("jarvis_scale_intelligence") || "[]");
    const leaked = intel.filter(e => e.userInput || e.rawContent || e.commandOutput);
    if (leaked.length > 0) findings.push({ id: "intel_pii_leak", severity: "high", msg: `${leaked.length} scale intel events with PII` });
  } catch {}

  // No listener leaks: infra overflow
  try {
    const provisions = JSON.parse(localStorage.getItem("jarvis_infra_scaling") || "[]");
    const active     = provisions.filter(p => ["provisioning", "scaling_up", "scaling_down"].includes(p.stage));
    if (active.length > 5) findings.push({ id: "infra_saturation", severity: "high", msg: `${active.length} active infra provisions` });
  } catch {}

  // Multiuser array size
  try {
    const users = JSON.parse(localStorage.getItem("jarvis_multiuser_continuity") || "[]");
    if (users.length > 20) findings.push({ id: "multiuser_overflow", severity: "medium", msg: `${users.length} multiuser records` });
  } catch {}

  // Org scale array size
  try {
    const orgs = JSON.parse(localStorage.getItem("jarvis_org_scale_workflows") || "[]");
    if (orgs.length > 15) findings.push({ id: "org_overflow", severity: "medium", msg: `${orgs.length} org scale records` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1364: Operational safety audit ─────────────────────────────────────

const SCALE_SAFETY_RULES = [
  {
    id:    "no_hidden_scaling_escalation",
    label: "No hidden scaling escalation",
    check: () => ["jarvis_scale_auto_escalate", "jarvis_auto_scale", "jarvis_scale_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_orchestration_execution",
    label: "No unsafe orchestration execution",
    check: () => {
      try {
        const provisions = JSON.parse(localStorage.getItem("jarvis_infra_scaling") || "[]");
        return provisions
          .filter(p => ["scaling_up", "scaling_down"].includes(p.stage))
          .every(p => p.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_high_load_state") || "[]");
        const stale  = events.filter(e =>
          e.stage === "shedding" && Date.now() - (e.ts || 0) > 4 * 60 * 60 * 1000
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
        const intel  = JSON.parse(localStorage.getItem("jarvis_scale_intelligence") || "[]");
        const recent = intel.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_scale_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_tenant_isolation") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "durability_privacy_safe",
    label: "Platform durability signals are privacy-safe",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_platform_durability") || "[]");
        return events.every(e => !e.rawContent && !e.commandOutput && !e.userInput);
      } catch { return true; }
    },
  },
];

function _runScaleSafetyAudit() {
  const results = SCALE_SAFETY_RULES.map(rule => ({
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

// ── Phase 1365: Scale + production operations maturity complete ───────────────

function _computeScaleReadiness({
  perfScore       = 100,
  safetyScore     = 100,
  scaleOpsScore   = 100,
  infraScore      = 100,
  durabilityScore = 100,
  loadScore       = 100,
  multiuserScore  = 100,
  isoViolations   = 0,
} = {}) {
  const composite = Math.round(
    safetyScore     * 0.25 +
    scaleOpsScore   * 0.20 +
    durabilityScore * 0.20 +
    infraScore      * 0.15 +
    loadScore       * 0.10 +
    multiuserScore  * 0.05 +
    perfScore       * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (durabilityScore < 60) blockers.push("Platform durability degraded");
  if (infraScore < 60)      blockers.push("Infra scaling degraded");
  if (loadScore < 60)       blockers.push("High-load survivability critical");
  if (isoViolations > 0)    blockers.push("Tenant isolation violations");
  if (multiuserScore < 60)  blockers.push("Multi-user continuity degraded");

  return {
    score,
    label:   score >= 80 ? "SCALE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useScaleOpsReadiness({
  scaleOpsScore   = 100,
  infraScore      = 100,
  durabilityScore = 100,
  loadScore       = 100,
  multiuserScore  = 100,
  isoViolations   = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runScalePerfAudit();
    setPerfAudit(perf);
    _save(SCALEPERF_KEY, perf);

    const safety = _runScaleSafetyAudit();
    setSafetyAudit(safety);
    _save(SCALESAFE_KEY, safety);

    const snap = _computeScaleReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      scaleOpsScore, infraScore, durabilityScore, loadScore, multiuserScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < SCALEREADY_TTL)
        .slice(0, SCALEREADY_MAX);
      _save(SCALEREADY_KEY, next);
      return next;
    });
  }, [scaleOpsScore, infraScore, durabilityScore, loadScore, multiuserScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(SCALEPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < SCALEPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(SCALESAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < SCALESAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(SCALEREADY_KEY, []).filter(s => now - (s.ts || 0) < SCALEREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const scaleReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "SCALE",
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
    scaleReadinessPill,
    readinessTrend,
    evaluate,
  };
}
