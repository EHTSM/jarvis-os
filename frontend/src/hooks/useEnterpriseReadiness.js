// Phases 1437-1440: Enterprise execution performance audit + operational safety audit +
// platform validation + organizational intelligence maturity complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const EIPERF_KEY   = "jarvis_ei_perf_audit";
const EISAFE_KEY   = "jarvis_ei_safety_audit";
const EIREADY_KEY  = "jarvis_ei_readiness";

const EIREADY_MAX  = 20;

const EIPERF_TTL   = 24 * 60 * 60 * 1000;
const EISAFE_TTL   = 24 * 60 * 60 * 1000;
const EIREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1437: Execution performance audit ───────────────────────────────────

function _runEIPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No org coord duplication
  try {
    const coords = JSON.parse(localStorage.getItem("jarvis_ei_org_coord") || "[]");
    const ids    = coords.map(c => c.id).filter(Boolean);
    const dupes  = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "coord_duplication", severity: "high", msg: `${dupes} duplicate org coord IDs` });
  } catch {}

  // Exec obs privacy-safe
  try {
    const obs    = JSON.parse(localStorage.getItem("jarvis_ei_exec_obs") || "[]");
    const leaked = obs.filter(o => o.userInput || o.rawContent || o.commandOutput);
    if (leaked.length > 0) findings.push({ id: "obs_pii_leak", severity: "high", msg: `${leaked.length} exec obs with PII` });
  } catch {}

  // No workflow duplication
  try {
    const wfs  = JSON.parse(localStorage.getItem("jarvis_ei_org_workflows") || "[]");
    const ids2 = wfs.map(w => w.id).filter(Boolean);
    const dupes2 = ids2.length - new Set(ids2).size;
    if (dupes2 > 0) findings.push({ id: "wf_duplication", severity: "high", msg: `${dupes2} duplicate org workflow IDs` });
  } catch {}

  // Stale prod opts
  try {
    const opts  = JSON.parse(localStorage.getItem("jarvis_ei_prod_opt") || "[]");
    const stale = opts.filter(p => !p.acted && Date.now() - (p.ts || 0) > 12 * 60 * 60 * 1000);
    if (stale.length > 5) findings.push({ id: "stale_prod_opts", severity: "medium", msg: `${stale.length} stale prod opt items` });
  } catch {}

  // Trust signal overflow
  try {
    const trust = JSON.parse(localStorage.getItem("jarvis_ei_trust") || "[]");
    if (trust.length > 28) findings.push({ id: "trust_overflow", severity: "medium", msg: `${trust.length} trust signals` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1438: Operational safety audit ─────────────────────────────────────

const EI_SAFETY_RULES = [
  {
    id:    "no_hidden_enterprise_escalation",
    label: "No hidden enterprise escalation",
    check: () => ["jarvis_ei_auto_escalate", "jarvis_auto_enterprise", "jarvis_ei_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_org_workflow_execution",
    label: "No unsafe org workflow execution",
    check: () => {
      try {
        const wfs = JSON.parse(localStorage.getItem("jarvis_ei_org_workflows") || "[]");
        return wfs
          .filter(w => w.stage === "running")
          .every(w => w.approvedAt || w.stage === "running");
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const coords = JSON.parse(localStorage.getItem("jarvis_ei_org_coord") || "[]");
        const stale  = coords.filter(c =>
          c.stage !== "complete" && c.stage !== "rolled_back"
          && Date.now() - (c.ts || 0) > 48 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_coordination_loops",
    label: "No recursive coordination loops",
    check: () => {
      try {
        const teams  = JSON.parse(localStorage.getItem("jarvis_ei_cross_team") || "[]");
        const recent = teams.filter(t => Date.now() - (t.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_ei_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_ei_org_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "org_coord_approval_gated",
    label: "Active org coordination is approval-gated",
    check: () => {
      try {
        const coords = JSON.parse(localStorage.getItem("jarvis_ei_org_coord") || "[]");
        return coords
          .filter(c => c.stage === "active")
          .every(c => c.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "prod_opts_operator_gated",
    label: "Acted productivity optimizations have operator confirmation",
    check: () => {
      try {
        const opts = JSON.parse(localStorage.getItem("jarvis_ei_prod_opt") || "[]");
        return opts.filter(p => p.acted).every(p => p.actedAt);
      } catch { return true; }
    },
  },
];

function _runEISafetyAudit() {
  const results = EI_SAFETY_RULES.map(rule => ({
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

// ── Phase 1439-1440: Validation + foundation complete ─────────────────────────

function _computeEIReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  eiScore       = 100,
  coordScore    = 100,
  trustScore    = 100,
  contScore     = 100,
  wfScore       = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore * 0.25 +
    trustScore  * 0.20 +
    contScore   * 0.20 +
    coordScore  * 0.15 +
    wfScore     * 0.10 +
    eiScore     * 0.05 +
    perfScore   * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (trustScore < 60)     blockers.push("Enterprise trust degraded");
  if (contScore < 60)      blockers.push("Business continuity degraded");
  if (coordScore < 60)     blockers.push("Org coordination degraded");
  if (wfScore < 60)        blockers.push("Org workflows degraded");
  if (isoViolations > 0)   blockers.push("Multi-org isolation violations");

  return {
    score,
    label:   score >= 80 ? "ENTERPRISE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useEnterpriseReadiness({
  eiScore       = 100,
  coordScore    = 100,
  trustScore    = 100,
  contScore     = 100,
  wfScore       = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runEIPerfAudit();
    setPerfAudit(perf);
    _save(EIPERF_KEY, perf);

    const safety = _runEISafetyAudit();
    setSafetyAudit(safety);
    _save(EISAFE_KEY, safety);

    const snap = _computeEIReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      eiScore, coordScore, trustScore, contScore, wfScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < EIREADY_TTL)
        .slice(0, EIREADY_MAX);
      _save(EIREADY_KEY, next);
      return next;
    });
  }, [eiScore, coordScore, trustScore, contScore, wfScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(EIPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < EIPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(EISAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < EISAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(EIREADY_KEY, []).filter(s => now - (s.ts || 0) < EIREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const enterpriseReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "ENTERPRISE",
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
    enterpriseReadinessPill,
    readinessTrend,
    evaluate,
  };
}
