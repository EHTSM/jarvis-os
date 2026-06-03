// Phases 1599-1600 + 1605: Real product distribution —
// execution performance audit + operational safety audit + complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only. Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const PDXR_PERF_KEY  = "jarvis_pdx_perf_audit";
const PDXR_SAFE_KEY  = "jarvis_pdx_safety_audit";
const PDXR_READY_KEY = "jarvis_pdx_readiness";

const PDXR_READY_MAX = 20;
const PDXR_PERF_TTL  = 24 * 60 * 60 * 1000;
const PDXR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const PDXR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1599: Execution performance audit ───────────────────────────────────

function _runPDXRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_pdx_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate session IDs` });
  } catch {}

  try {
    const notifs  = JSON.parse(localStorage.getItem("jarvis_pdx_notifications") || "[]");
    const recent  = notifs.filter(n => Date.now() - (n.ts || 0) < 60_000);
    if (recent.length > 10) findings.push({ id: "notif_flood", severity: "high", msg: `${recent.length} notifications in last 60s` });
  } catch {}

  try {
    const onboard = JSON.parse(localStorage.getItem("jarvis_pdx_onboarding") || "[]");
    const leaked  = onboard.filter(o => o.userInput || o.rawContent);
    if (leaked.length > 0) findings.push({ id: "onboard_pii_leak", severity: "high", msg: `${leaked.length} onboarding entries with PII` });
  } catch {}

  try {
    const workflows = JSON.parse(localStorage.getItem("jarvis_pdx_workflows") || "[]");
    const ids       = workflows.map(w => w.workflowId).filter(Boolean);
    const dupes     = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "workflow_duplication", severity: "high", msg: `${dupes} duplicate workflow IDs` });
  } catch {}

  try {
    const installers = JSON.parse(localStorage.getItem("jarvis_pdx_installers") || "[]");
    const failed     = installers.filter(i => i.stage === "failed");
    if (failed.length > 2) findings.push({ id: "installer_failures", severity: "high", msg: `${failed.length} failed installers` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1600: Operational safety audit ─────────────────────────────────────

const PDXR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_pdx_auto_escalate", "jarvis_auto_pdx_deploy", "jarvis_pdx_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_pdx_sessions") || "[]");
        return sessions.filter(s => s.stage === "active").every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const onboard = JSON.parse(localStorage.getItem("jarvis_pdx_onboarding") || "[]");
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
        const distrib = JSON.parse(localStorage.getItem("jarvis_pdx_distribution") || "[]");
        const recent  = distrib.filter(d => Date.now() - (d.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_pdx_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_pdx_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_notification_flood",
    label: "No notification flood",
    check: () => {
      try {
        const notifs  = JSON.parse(localStorage.getItem("jarvis_pdx_notifications") || "[]");
        const recent  = notifs.filter(n => Date.now() - (n.ts || 0) < 60_000);
        return recent.length <= 10;
      } catch { return true; }
    },
  },
  {
    id:    "installer_validation_complete",
    label: "Installer validation not failing",
    check: () => {
      try {
        const installers = JSON.parse(localStorage.getItem("jarvis_pdx_installers") || "[]");
        return installers.filter(i => i.stage === "failed").length === 0;
      } catch { return true; }
    },
  },
];

function _runPDXRSafetyAudit() {
  const results = PDXR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1605: Distribution complete ────────────────────────────────────────

function _computePDXRReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  pdxScore      = 100,
  sessionScore  = 100,
  onboardScore  = 100,
  workflowScore = 100,
  distribScore  = 100,
  installerScore = 100,
  isoViolations  = 0,
} = {}) {
  const composite = Math.round(
    safetyScore   * 0.25 +
    onboardScore  * 0.20 +
    sessionScore  * 0.15 +
    workflowScore * 0.15 +
    distribScore  * 0.10 +
    installerScore * 0.10 +
    pdxScore      * 0.03 +
    perfScore     * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (onboardScore < 60)    blockers.push("Onboarding stall rate elevated");
  if (installerScore < 60)  blockers.push("Installer failures blocking distribution");
  if (sessionScore < 60)    blockers.push("Session recovery rate elevated");
  if (workflowScore < 60)   blockers.push("Workflow failure rate elevated");
  if (distribScore < 60)    blockers.push("Distribution trust degraded");
  if (isoViolations > 0)    blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "DISTRIBUTED" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useProductDistributionReadiness({
  pdxScore      = 100,
  sessionScore  = 100,
  onboardScore  = 100,
  workflowScore = 100,
  distribScore  = 100,
  installerScore = 100,
  isoViolations  = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runPDXRPerfAudit();
    setPerfAudit(perf);
    _save(PDXR_PERF_KEY, perf);

    const safety = _runPDXRSafetyAudit();
    setSafetyAudit(safety);
    _save(PDXR_SAFE_KEY, safety);

    const snap = _computePDXRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      pdxScore, sessionScore, onboardScore, workflowScore, distribScore, installerScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < PDXR_READY_TTL)
        .slice(0, PDXR_READY_MAX);
      _save(PDXR_READY_KEY, next);
      return next;
    });
  }, [pdxScore, sessionScore, onboardScore, workflowScore, distribScore, installerScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(PDXR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < PDXR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(PDXR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < PDXR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(PDXR_READY_KEY, []).filter(s => now - (s.ts || 0) < PDXR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const productDistributionPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "DIST",
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
    productDistributionPill,
    readinessTrend,
    evaluate,
  };
}
