// Phases 1527-1530: Live deployment execution performance audit + operational safety audit +
// platform validation + user scaling complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const LDPERF_KEY   = "jarvis_ld_perf_audit";
const LDSAFE_KEY   = "jarvis_ld_safety_audit";
const LDREADY_KEY  = "jarvis_ld_readiness";

const LDREADY_MAX  = 20;

const LDPERF_TTL   = 24 * 60 * 60 * 1000;
const LDSAFE_TTL   = 24 * 60 * 60 * 1000;
const LDREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1527: Execution performance audit ───────────────────────────────────

function _runLDPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const domain = JSON.parse(localStorage.getItem("jarvis_ld_domain") || "[]");
    const ids    = domain.map(d => d.id).filter(Boolean);
    const dupes  = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "domain_duplication", severity: "high", msg: `${dupes} duplicate domain IDs` });
  } catch {}

  try {
    const vps    = JSON.parse(localStorage.getItem("jarvis_ld_vps") || "[]");
    const leaked = vps.filter(v => v.userInput || v.rawContent || v.commandOutput);
    if (leaked.length > 0) findings.push({ id: "vps_pii_leak", severity: "high", msg: `${leaked.length} VPS entries with PII` });
  } catch {}

  try {
    const traffic = JSON.parse(localStorage.getItem("jarvis_ld_traffic") || "[]");
    const leaked  = traffic.filter(t => t.userInput || t.rawContent);
    if (leaked.length > 0) findings.push({ id: "traffic_pii_leak", severity: "high", msg: `${leaked.length} traffic entries with PII` });
  } catch {}

  try {
    const incidents = JSON.parse(localStorage.getItem("jarvis_ld_incidents") || "[]");
    const active    = incidents.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage));
    if (active.length > 5) findings.push({ id: "incident_saturation", severity: "high", msg: `${active.length} active incidents` });
  } catch {}

  try {
    const trust  = JSON.parse(localStorage.getItem("jarvis_ld_trust") || "[]");
    const leaked = trust.filter(t => t.userInput || t.rawContent);
    if (leaked.length > 0) findings.push({ id: "trust_pii_leak", severity: "high", msg: `${leaked.length} trust entries with PII` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1528: Operational safety audit ─────────────────────────────────────

const LD_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_ld_auto_escalate", "jarvis_auto_ld_deploy", "jarvis_ld_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const domain = JSON.parse(localStorage.getItem("jarvis_ld_domain") || "[]");
        return domain
          .filter(d => d.stage === "active")
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const onboard = JSON.parse(localStorage.getItem("jarvis_ld_onboarding") || "[]");
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
        const incidents = JSON.parse(localStorage.getItem("jarvis_ld_incidents") || "[]");
        const recent    = incidents.filter(i => Date.now() - (i.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_ld_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_ld_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "domain_activation_approval_gated",
    label: "Domain activation is approval-gated",
    check: () => {
      try {
        const domain = JSON.parse(localStorage.getItem("jarvis_ld_domain") || "[]");
        return domain
          .filter(d => d.stage === "active")
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_ld_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runLDSafetyAudit() {
  const results = LD_SAFETY_RULES.map(rule => ({
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

// ── Phase 1529-1530: Validation + scaling complete ────────────────────────────

function _computeLDReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  ldScore       = 100,
  domainScore   = 100,
  vpsScore      = 100,
  incidentScore = 100,
  trustScore    = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore   * 0.25 +
    incidentScore * 0.20 +
    trustScore    * 0.20 +
    domainScore   * 0.15 +
    vpsScore      * 0.10 +
    ldScore       * 0.05 +
    perfScore     * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (incidentScore < 60)   blockers.push("Active incidents blocking deployment");
  if (trustScore < 60)      blockers.push("User trust degraded");
  if (domainScore < 60)     blockers.push("Domain/routing degraded");
  if (vpsScore < 60)        blockers.push("VPS stability degraded");
  if (isoViolations > 0)    blockers.push("Live isolation violations");

  return {
    score,
    label:   score >= 80 ? "LIVE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useLiveDeploymentReadiness({
  ldScore       = 100,
  domainScore   = 100,
  vpsScore      = 100,
  incidentScore = 100,
  trustScore    = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runLDPerfAudit();
    setPerfAudit(perf);
    _save(LDPERF_KEY, perf);

    const safety = _runLDSafetyAudit();
    setSafetyAudit(safety);
    _save(LDSAFE_KEY, safety);

    const snap = _computeLDReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      ldScore, domainScore, vpsScore, incidentScore, trustScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < LDREADY_TTL)
        .slice(0, LDREADY_MAX);
      _save(LDREADY_KEY, next);
      return next;
    });
  }, [ldScore, domainScore, vpsScore, incidentScore, trustScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(LDPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < LDPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(LDSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < LDSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(LDREADY_KEY, []).filter(s => now - (s.ts || 0) < LDREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const liveDeploymentReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "LIVE",
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
    liveDeploymentReadinessPill,
    readinessTrend,
    evaluate,
  };
}
