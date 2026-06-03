// Phase 1302-1305: Execution performance audit + operational safety audit +
// reliability operations validation + foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const RELPERF_KEY  = "jarvis_rel_perf_audit";
const RELSAFE_KEY  = "jarvis_rel_safety_audit";
const RELREADY_KEY = "jarvis_rel_readiness";

const RELREADY_MAX = 20;

const RELPERF_TTL  = 24 * 60 * 60 * 1000;
const RELSAFE_TTL  = 24 * 60 * 60 * 1000;
const RELREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1302: Execution performance audit ───────────────────────────────────

function _runRelPerfAudit() {
  const now = Date.now();
  let jarvisKeys = 0;
  let totalBytes = 0;
  let largestArray = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key) || "";
      totalBytes += key.length + val.length;
      if (!key?.startsWith("jarvis_")) continue;
      jarvisKeys++;
      const parsed = JSON.parse(val || "null");
      if (Array.isArray(parsed) && parsed.length > largestArray) largestArray = parsed.length;
    }
  } catch {}

  const findings = [];
  if (jarvisKeys > 230)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_800_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Incident duplication check
  try {
    const incs = JSON.parse(localStorage.getItem("jarvis_incidents") || "[]");
    const ids  = incs.map(i => i.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "incident_duplication", severity: "high", msg: `${dupes} duplicate incident IDs` });
  } catch {}

  // Active incident overflow
  try {
    const incs   = JSON.parse(localStorage.getItem("jarvis_incidents") || "[]");
    const active = incs.filter(i => !["resolved","closed"].includes(i.stage));
    if (active.length > 5) findings.push({ id: "incident_overflow", severity: "medium", msg: `${active.length} active incidents` });
  } catch {}

  // Outage signal burst check
  try {
    const signals = JSON.parse(localStorage.getItem("jarvis_outage_signals") || "[]");
    const burst   = signals.filter(s => Date.now() - (s.ts || 0) < 10 * 1000);
    if (burst.length > 3) findings.push({ id: "outage_burst", severity: "medium", msg: `${burst.length} outage signals in 10s` });
  } catch {}

  return {
    ts:          now,
    jarvisKeys,
    totalBytes,
    largestArray,
    findings,
    highCount:   findings.filter(f => f.severity === "high").length,
    score:       findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1303: Operational safety audit ─────────────────────────────────────

const REL_SAFETY_RULES = [
  {
    id:    "no_hidden_remediation_escalation",
    label: "No hidden remediation escalation",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_incident_recovery") || "[]");
        return recs
          .filter(r => ["executing","verifying","complete"].includes(r.stage))
          .every(r => r.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_rollback",
    label: "No unsafe auto-rollback execution",
    check: () => ["jarvis_auto_rollback", "jarvis_rollback_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const incs = JSON.parse(localStorage.getItem("jarvis_incidents") || "[]");
        const staleReplay = incs.filter(i =>
          i.type === "replay_failure"
          && !["resolved","closed"].includes(i.stage)
          && Date.now() - (i.ts || 0) > 4 * 60 * 60 * 1000
        );
        return staleReplay.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_recovery_loops",
    label: "No recursive recovery loops",
    check: () => {
      try {
        const recs   = JSON.parse(localStorage.getItem("jarvis_incident_recovery") || "[]");
        const recent = recs.filter(r => Date.now() - (r.updatedAt || r.ts || 0) < 10 * 1000);
        return recent.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_rel_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "incident_isolation_clean",
    label: "Incident isolation clean",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_incident_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "analytics_privacy_safe",
    label: "Incident analytics are privacy-safe",
    check: () => {
      try {
        const anal = JSON.parse(localStorage.getItem("jarvis_incident_analytics") || "[]");
        return anal.every(s => !s.rawContent && !s.commandOutput && !s.userInput);
      } catch { return true; }
    },
  },
];

function _runRelSafetyAudit() {
  const results = REL_SAFETY_RULES.map(rule => ({
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

// ── Phase 1304-1305: Validation + foundation complete ────────────────────────

function _computeRelReadiness({
  perfScore        = 100,
  safetyScore      = 100,
  relScore         = 100,
  continuityScore  = 100,
  outageSeverity   = 100,
  rollbackScore    = 100,
  isoViolations    = 0,
  critIncidents    = 0,
  forecastRisk     = "low",
} = {}) {
  const forecastPenalty = forecastRisk === "high" ? 15 : forecastRisk === "medium" ? 5 : 0;

  const composite = Math.round(
    safetyScore     * 0.25 +
    relScore        * 0.20 +
    continuityScore * 0.20 +
    outageSeverity  * 0.15 +
    rollbackScore   * 0.10 +
    perfScore       * 0.10
  )
  - forecastPenalty
  - (isoViolations > 0 ? 10 : 0)
  - (critIncidents > 0 ? Math.min(30, critIncidents * 15) : 0)
  + (safetyScore === 100 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)      blockers.push("Safety audit failures");
  if (critIncidents > 0)      blockers.push(`${critIncidents} critical incident${critIncidents > 1 ? "s" : ""} active`);
  if (continuityScore < 60)   blockers.push("Operational continuity degraded");
  if (outageSeverity < 50)    blockers.push("Outage severity critical");
  if (forecastRisk === "high") blockers.push("Reliability forecast high risk");
  if (isoViolations > 0)      blockers.push("Incident isolation violations");

  return {
    score,
    label:   score >= 80 ? "RELIABILITY READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useReliabilityReadiness({
  relScore        = 100,
  continuityScore = 100,
  outageSeverity  = 100,
  rollbackScore   = 100,
  isoViolations   = 0,
  critIncidents   = 0,
  forecastRisk    = "low",
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runRelPerfAudit();
    setPerfAudit(perf);
    _save(RELPERF_KEY, perf);

    const safety = _runRelSafetyAudit();
    setSafetyAudit(safety);
    _save(RELSAFE_KEY, safety);

    const snap = _computeRelReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      relScore, continuityScore, outageSeverity,
      rollbackScore, isoViolations, critIncidents, forecastRisk,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < RELREADY_TTL)
        .slice(0, RELREADY_MAX);
      _save(RELREADY_KEY, next);
      return next;
    });
  }, [relScore, continuityScore, outageSeverity, rollbackScore, isoViolations, critIncidents, forecastRisk]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(RELPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < RELPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(RELSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < RELSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(RELREADY_KEY, []).filter(s => now - (s.ts || 0) < RELREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const reliabilityReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "REL",
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
    reliabilityReadinessPill,
    readinessTrend,
    evaluate,
  };
}
