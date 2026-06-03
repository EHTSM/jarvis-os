// Phase 1288-1290: Execution performance audit + operational safety audit +
// security + compliance foundation complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const SECPERF_KEY  = "jarvis_sec_perf_audit";
const SECSAFE_KEY  = "jarvis_sec_safety_audit";
const SECREADY_KEY = "jarvis_sec_readiness";

const SECREADY_MAX = 20;

const SECPERF_TTL  = 24 * 60 * 60 * 1000;
const SECSAFE_TTL  = 24 * 60 * 60 * 1000;
const SECREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1288: Execution performance audit ───────────────────────────────────

function _runSecPerfAudit() {
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
  if (jarvisKeys > 215)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_700_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Audit trail duplication check
  try {
    const audit = JSON.parse(localStorage.getItem("jarvis_audit_trail") || "[]");
    const now2  = Date.now();
    const burst = audit.filter(e => now2 - (e.ts || 0) < 5 * 1000);
    if (burst.length > 5)
      findings.push({ id: "audit_burst", severity: "medium", msg: `${burst.length} audit events in 5s` });
  } catch {}

  // Threat signal overflow check
  try {
    const threats = JSON.parse(localStorage.getItem("jarvis_threat_signals") || "[]");
    const crit    = threats.filter(t => t.severity === "critical");
    if (crit.length > 3)
      findings.push({ id: "critical_threats", severity: "high", msg: `${crit.length} critical threats unresolved` });
  } catch {}

  // Access escalation count check
  try {
    const access  = JSON.parse(localStorage.getItem("jarvis_access_governance") || "[]");
    const recent  = access.filter(e => Date.now() - (e.ts || 0) < 60 * 60 * 1000);
    const escAttempts = recent.filter(e => e.action === "escalate_attempt").length;
    if (escAttempts > 3)
      findings.push({ id: "access_escalations", severity: "high", msg: `${escAttempts} escalation attempts in 1h` });
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

// ── Phase 1289: Operational safety audit ─────────────────────────────────────

const SEC_SAFETY_RULES = [
  {
    id:    "no_hidden_mitigation_escalation",
    label: "No hidden mitigation escalation",
    check: () => {
      try {
        const threats = JSON.parse(localStorage.getItem("jarvis_threat_signals") || "[]");
        return threats.every(t => !t.autoMitigate && !t.autoRemediate);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_authorization",
    label: "No unsafe auto-authorization",
    check: () => ["jarvis_auto_auth", "jarvis_auto_access", "jarvis_sec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const deps = JSON.parse(localStorage.getItem("jarvis_secure_deployments") || "[]");
        const stale = deps.filter(d =>
          ["pending", "validated"].includes(d.stage)
          && Date.now() - (d.ts || 0) > 4 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_remediation",
    label: "No recursive remediation loops",
    check: () => {
      try {
        const anomalies = JSON.parse(localStorage.getItem("jarvis_security_anomalies") || "[]");
        const recent    = anomalies.filter(a => Date.now() - (a.ts || 0) < 10 * 1000);
        return recent.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_sec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "secure_deployments_gated",
    label: "Secure deployments approval-gated",
    check: () => {
      try {
        const deps = JSON.parse(localStorage.getItem("jarvis_secure_deployments") || "[]");
        return deps
          .filter(d => ["deploying", "complete"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "security_isolation_clean",
    label: "Security isolation clean",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_security_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "audit_privacy_safe",
    label: "Audit trail is privacy-safe",
    check: () => {
      try {
        const audit = JSON.parse(localStorage.getItem("jarvis_audit_trail") || "[]");
        return audit.every(e => !e.rawContent && !e.userInput && !e.commandOutput);
      } catch { return true; }
    },
  },
];

function _runSecSafetyAudit() {
  const results = SEC_SAFETY_RULES.map(rule => ({
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

// ── Phase 1290: Foundation complete ──────────────────────────────────────────

function _computeSecReadiness({
  perfScore        = 100,
  safetyScore      = 100,
  secScore         = 100,
  complianceScore  = 100,
  threatScore      = 100,
  accessGovScore   = 100,
  isoViolations    = 0,
  critThreats      = 0,
} = {}) {
  const composite = Math.round(
    safetyScore     * 0.25 +
    secScore        * 0.20 +
    complianceScore * 0.20 +
    threatScore     * 0.15 +
    accessGovScore  * 0.10 +
    perfScore       * 0.10
  )
  - (isoViolations > 0 ? 10 : 0)
  - (critThreats   > 0 ? Math.min(30, critThreats * 15) : 0)
  + (safetyScore === 100 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)      blockers.push("Safety audit failures");
  if (critThreats > 0)        blockers.push(`${critThreats} critical threat${critThreats > 1 ? "s" : ""}`);
  if (complianceScore < 60)   blockers.push("Compliance degraded");
  if (accessGovScore < 50)    blockers.push("Access governance low");
  if (isoViolations > 0)      blockers.push("Security isolation violations");

  return {
    score,
    label:   score >= 80 ? "SECURITY READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useSecurityReadiness({
  secScore        = 100,
  complianceScore = 100,
  threatScore     = 100,
  accessGovScore  = 100,
  isoViolations   = 0,
  critThreats     = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runSecPerfAudit();
    setPerfAudit(perf);
    _save(SECPERF_KEY, perf);

    const safety = _runSecSafetyAudit();
    setSafetyAudit(safety);
    _save(SECSAFE_KEY, safety);

    const snap = _computeSecReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      secScore, complianceScore, threatScore,
      accessGovScore, isoViolations, critThreats,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < SECREADY_TTL)
        .slice(0, SECREADY_MAX);
      _save(SECREADY_KEY, next);
      return next;
    });
  }, [secScore, complianceScore, threatScore, accessGovScore, isoViolations, critThreats]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(SECPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < SECPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(SECSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < SECSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(SECREADY_KEY, []).filter(s => now - (s.ts || 0) < SECREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const securityReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "SEC",
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
    securityReadinessPill,
    readinessTrend,
    evaluate,
  };
}
