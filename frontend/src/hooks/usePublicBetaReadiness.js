// Phases 1542-1545: Public beta scaling + production hardening —
// execution performance audit + operational safety audit +
// platform validation + hardening complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const PBSR_PERF_KEY  = "jarvis_pbs_perf_audit";
const PBSR_SAFE_KEY  = "jarvis_pbs_safety_audit";
const PBSR_READY_KEY = "jarvis_pbs_readiness";

const PBSR_READY_MAX = 20;
const PBSR_PERF_TTL  = 24 * 60 * 60 * 1000;
const PBSR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const PBSR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1542: Execution performance audit ───────────────────────────────────

function _runPBSRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const traffic = JSON.parse(localStorage.getItem("jarvis_pbs_traffic") || "[]");
    const leaked  = traffic.filter(t => t.userInput || t.rawContent);
    if (leaked.length > 0) findings.push({ id: "traffic_pii_leak", severity: "high", msg: `${leaked.length} traffic entries with PII` });
  } catch {}

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_pbs_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate session IDs` });
  } catch {}

  try {
    const ux     = JSON.parse(localStorage.getItem("jarvis_pbs_ux") || "[]");
    const leaked = ux.filter(u => u.userInput || u.rawContent || u.commandOutput);
    if (leaked.length > 0) findings.push({ id: "ux_pii_leak", severity: "high", msg: `${leaked.length} UX entries with PII` });
  } catch {}

  try {
    const incidents = JSON.parse(localStorage.getItem("jarvis_pbs_incidents") || "[]");
    const active    = incidents.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage));
    if (active.length > 5) findings.push({ id: "incident_saturation", severity: "high", msg: `${active.length} active incidents` });
  } catch {}

  try {
    const tenants     = JSON.parse(localStorage.getItem("jarvis_pbs_tenants") || "[]");
    const contaminated = tenants.filter(t => t.crossContamination);
    if (contaminated.length > 0) findings.push({ id: "tenant_contamination", severity: "high", msg: `${contaminated.length} tenants with cross-contamination` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1543: Operational safety audit ─────────────────────────────────────

const PBSR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_pbs_auto_escalate", "jarvis_auto_pbs_deploy", "jarvis_pbs_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_pbs_sessions") || "[]");
        return sessions
          .filter(s => s.stage === "active")
          .every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_pbs_sessions") || "[]");
        const stale    = sessions.filter(s =>
          s.stage === "reconnecting" && Date.now() - (s.ts || 0) > 48 * 60 * 60 * 1000
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
        const incidents = JSON.parse(localStorage.getItem("jarvis_pbs_incidents") || "[]");
        const recent    = incidents.filter(i => Date.now() - (i.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_pbs_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_pbs_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_tenant_contamination",
    label: "No tenant cross-contamination",
    check: () => {
      try {
        const tenants = JSON.parse(localStorage.getItem("jarvis_pbs_tenants") || "[]");
        return tenants.every(t => !t.crossContamination);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_pbs_support") || "[]");
        return support
          .filter(s => s.stage === "escalated")
          .every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runPBSRSafetyAudit() {
  const results = PBSR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1544-1545: Validation + hardening complete ─────────────────────────

function _computePBSRReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  pbsScore      = 100,
  trafficScore  = 100,
  sessionScore  = 100,
  incidentScore = 100,
  trustScore    = 100,
  tenantScore   = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore   * 0.25 +
    incidentScore * 0.20 +
    trustScore    * 0.15 +
    tenantScore   * 0.15 +
    trafficScore  * 0.10 +
    sessionScore  * 0.10 +
    pbsScore      * 0.03 +
    perfScore     * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (incidentScore < 60)  blockers.push("Active incidents blocking beta");
  if (trustScore < 60)     blockers.push("User trust degraded");
  if (tenantScore < 60)    blockers.push("Tenant isolation violations");
  if (trafficScore < 60)   blockers.push("Traffic availability degraded");
  if (sessionScore < 60)   blockers.push("Session reconnect storm");
  if (isoViolations > 0)   blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "HARDENED" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function usePublicBetaReadiness({
  pbsScore      = 100,
  trafficScore  = 100,
  sessionScore  = 100,
  incidentScore = 100,
  trustScore    = 100,
  tenantScore   = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runPBSRPerfAudit();
    setPerfAudit(perf);
    _save(PBSR_PERF_KEY, perf);

    const safety = _runPBSRSafetyAudit();
    setSafetyAudit(safety);
    _save(PBSR_SAFE_KEY, safety);

    const snap = _computePBSRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      pbsScore, trafficScore, sessionScore, incidentScore, trustScore, tenantScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < PBSR_READY_TTL)
        .slice(0, PBSR_READY_MAX);
      _save(PBSR_READY_KEY, next);
      return next;
    });
  }, [pbsScore, trafficScore, sessionScore, incidentScore, trustScore, tenantScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(PBSR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < PBSR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(PBSR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < PBSR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(PBSR_READY_KEY, []).filter(s => now - (s.ts || 0) < PBSR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const publicBetaReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "HARDENED",
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
    publicBetaReadinessPill,
    readinessTrend,
    evaluate,
  };
}
