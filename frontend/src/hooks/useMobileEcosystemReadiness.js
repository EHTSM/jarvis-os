// Phases 1629-1630 + 1635: Mobile ecosystem + native experience —
// execution performance audit + operational safety audit + maturity complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only. Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const MOBR_PERF_KEY  = "jarvis_mob_perf_audit";
const MOBR_SAFE_KEY  = "jarvis_mob_safety_audit";
const MOBR_READY_KEY = "jarvis_mob_readiness";

const MOBR_READY_MAX = 20;
const MOBR_PERF_TTL  = 24 * 60 * 60 * 1000;
const MOBR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const MOBR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1629: Execution performance audit ───────────────────────────────────

function _runMOBRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_mob_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate mobile session IDs` });
  } catch {}

  try {
    const notifs  = JSON.parse(localStorage.getItem("jarvis_mob_notifications") || "[]");
    const recent  = notifs.filter(n => Date.now() - (n.ts || 0) < 60_000);
    if (recent.length > 10) findings.push({ id: "notif_flood", severity: "high", msg: `${recent.length} mobile notifications in last 60s` });
  } catch {}

  try {
    const onboard = JSON.parse(localStorage.getItem("jarvis_mob_onboarding") || "[]");
    const leaked  = onboard.filter(o => o.userInput || o.rawContent);
    if (leaked.length > 0) findings.push({ id: "onboard_pii_leak", severity: "high", msg: `${leaked.length} onboarding entries with PII` });
  } catch {}

  try {
    const workflows = JSON.parse(localStorage.getItem("jarvis_mob_workflows") || "[]");
    const ids       = workflows.map(w => w.workflowId).filter(Boolean);
    const dupes     = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "workflow_duplication", severity: "high", msg: `${dupes} duplicate mobile workflow IDs` });
  } catch {}

  try {
    const trust  = JSON.parse(localStorage.getItem("jarvis_mob_trust") || "[]");
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

// ── Phase 1630: Operational safety audit ─────────────────────────────────────

const MOBR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_mob_auto_escalate", "jarvis_auto_mob_deploy", "jarvis_mob_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_mob_sessions") || "[]");
        return sessions.filter(s => s.stage === "active").every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_mob_sessions") || "[]");
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
        const sessions = JSON.parse(localStorage.getItem("jarvis_mob_sessions") || "[]");
        const recent   = sessions.filter(s => Date.now() - (s.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_mob_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_mob_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_notification_flood",
    label: "No mobile notification flood",
    check: () => {
      try {
        const notifs  = JSON.parse(localStorage.getItem("jarvis_mob_notifications") || "[]");
        const recent  = notifs.filter(n => Date.now() - (n.ts || 0) < 60_000);
        return recent.length <= 10;
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_onboarding",
    label: "No stale mobile onboarding",
    check: () => {
      try {
        const onboard = JSON.parse(localStorage.getItem("jarvis_mob_onboarding") || "[]");
        const stale   = onboard.filter(o =>
          o.stage !== "complete" && Date.now() - (o.ts || 0) > 48 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
];

function _runMOBRSafetyAudit() {
  const results = MOBR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1635: Mobile maturity complete ─────────────────────────────────────

function _computeMOBRReadiness({
  perfScore     = 100,
  safetyScore   = 100,
  mobScore      = 100,
  sessionScore  = 100,
  onboardScore  = 100,
  workflowScore = 100,
  trustScore    = 100,
  workspaceScore = 100,
  isoViolations  = 0,
} = {}) {
  const composite = Math.round(
    safetyScore    * 0.25 +
    trustScore     * 0.20 +
    onboardScore   * 0.15 +
    sessionScore   * 0.15 +
    workflowScore  * 0.10 +
    workspaceScore * 0.10 +
    mobScore       * 0.03 +
    perfScore      * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (trustScore < 60)     blockers.push("Mobile trust degraded");
  if (onboardScore < 60)   blockers.push("Mobile onboarding stall rate elevated");
  if (sessionScore < 60)   blockers.push("Mobile reconnect storm");
  if (workflowScore < 60)  blockers.push("Mobile workflow failures elevated");
  if (workspaceScore < 60) blockers.push("Mobile workspace quality degraded");
  if (isoViolations > 0)   blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "MOBILE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useMobileEcosystemReadiness({
  mobScore      = 100,
  sessionScore  = 100,
  onboardScore  = 100,
  workflowScore = 100,
  trustScore    = 100,
  workspaceScore = 100,
  isoViolations  = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runMOBRPerfAudit();
    setPerfAudit(perf);
    _save(MOBR_PERF_KEY, perf);

    const safety = _runMOBRSafetyAudit();
    setSafetyAudit(safety);
    _save(MOBR_SAFE_KEY, safety);

    const snap = _computeMOBRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      mobScore, sessionScore, onboardScore, workflowScore, trustScore, workspaceScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < MOBR_READY_TTL)
        .slice(0, MOBR_READY_MAX);
      _save(MOBR_READY_KEY, next);
      return next;
    });
  }, [mobScore, sessionScore, onboardScore, workflowScore, trustScore, workspaceScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(MOBR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < MOBR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(MOBR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < MOBR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(MOBR_READY_KEY, []).filter(s => now - (s.ts || 0) < MOBR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const mobileReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "MOBILE",
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
    mobileReadinessPill,
    readinessTrend,
    evaluate,
  };
}
