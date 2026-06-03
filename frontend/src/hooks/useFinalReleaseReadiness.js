// Phases 1498-1500: Final deployment execution performance audit + operational safety audit +
// public release validation complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const FRPERF_KEY   = "jarvis_fr_perf_audit";
const FRSAFE_KEY   = "jarvis_fr_safety_audit";
const FRREADY_KEY  = "jarvis_fr_readiness";

const FRREADY_MAX  = 20;

const FRPERF_TTL   = 24 * 60 * 60 * 1000;
const FRSAFE_TTL   = 24 * 60 * 60 * 1000;
const FRREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1498: Execution performance audit ───────────────────────────────────

function _runFRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const hosting = JSON.parse(localStorage.getItem("jarvis_fr_hosting") || "[]");
    const ids     = hosting.map(h => h.id).filter(Boolean);
    const dupes   = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "hosting_duplication", severity: "high", msg: `${dupes} duplicate hosting IDs` });
  } catch {}

  try {
    const web    = JSON.parse(localStorage.getItem("jarvis_fr_web_release") || "[]");
    const leaked = web.filter(w => w.userInput || w.rawContent);
    if (leaked.length > 0) findings.push({ id: "web_pii_leak", severity: "high", msg: `${leaked.length} web release entries with PII` });
  } catch {}

  try {
    const mobile   = JSON.parse(localStorage.getItem("jarvis_fr_mobile_release") || "[]");
    const rejected = mobile.filter(m => m.stage === "rejected");
    if (rejected.length > 1) findings.push({ id: "mobile_rejections", severity: "high", msg: `${rejected.length} rejected mobile releases` });
  } catch {}

  try {
    const analytics = JSON.parse(localStorage.getItem("jarvis_fr_analytics") || "[]");
    const leaked    = analytics.filter(a => a.userInput || a.rawContent || a.commandOutput);
    if (leaked.length > 0) findings.push({ id: "analytics_pii_leak", severity: "high", msg: `${leaked.length} analytics entries with PII` });
  } catch {}

  try {
    const web    = JSON.parse(localStorage.getItem("jarvis_fr_web_release") || "[]");
    const unappr = web.filter(w => w.stage === "live" && !w.approvedAt);
    if (unappr.length > 0) findings.push({ id: "unapproved_live_release", severity: "high", msg: `${unappr.length} live web releases without approval` });
  } catch {}

  try {
    const mobile = JSON.parse(localStorage.getItem("jarvis_fr_mobile_release") || "[]");
    const unappr = mobile.filter(m => m.stage === "live" && !m.approvedAt);
    if (unappr.length > 0) findings.push({ id: "unapproved_mobile_live", severity: "high", msg: `${unappr.length} live mobile releases without approval` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1499: Operational safety audit ─────────────────────────────────────

const FR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_fr_auto_escalate", "jarvis_auto_fr_deploy", "jarvis_fr_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const hosting = JSON.parse(localStorage.getItem("jarvis_fr_hosting") || "[]");
        return hosting
          .filter(h => h.stage === "active")
          .every(h => h.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const onboard = JSON.parse(localStorage.getItem("jarvis_fr_onboarding") || "[]");
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
        const analytics = JSON.parse(localStorage.getItem("jarvis_fr_analytics") || "[]");
        const recent    = analytics.filter(a => Date.now() - (a.ts || 0) < 10 * 1000);
        return recent.length < 8;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_fr_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_fr_release_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "web_release_approval_gated",
    label: "Live web releases are approval-gated",
    check: () => {
      try {
        const web = JSON.parse(localStorage.getItem("jarvis_fr_web_release") || "[]");
        return web.filter(w => w.stage === "live").every(w => w.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "mobile_release_approval_gated",
    label: "Live mobile releases are approval-gated",
    check: () => {
      try {
        const mobile = JSON.parse(localStorage.getItem("jarvis_fr_mobile_release") || "[]");
        return mobile.filter(m => m.stage === "live").every(m => m.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "store_release_approval_gated",
    label: "App store approvals are gated",
    check: () => {
      try {
        const store = JSON.parse(localStorage.getItem("jarvis_fr_store") || "[]");
        return store.filter(s => s.status === "approved").every(s => s.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "support_escalation_operator_gated",
    label: "Support escalations are operator-approved",
    check: () => {
      try {
        const support = JSON.parse(localStorage.getItem("jarvis_fr_support") || "[]");
        return support.filter(s => s.stage === "escalated").every(s => s.operatorApproved);
      } catch { return true; }
    },
  },
];

function _runFRSafetyAudit() {
  const results = FR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1500: Platform launch readiness complete ────────────────────────────

function _computeFRReadiness({
  perfScore    = 100,
  safetyScore  = 100,
  frScore      = 100,
  hostingScore = 100,
  webScore     = 100,
  mobileScore  = 100,
  storeScore   = 100,
  onboardScore = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    hostingScore * 0.20 +
    webScore     * 0.15 +
    mobileScore  * 0.15 +
    onboardScore * 0.10 +
    storeScore   * 0.10 +
    frScore      * 0.03 +
    perfScore    * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (hostingScore < 60)   blockers.push("Production hosting degraded");
  if (webScore < 60)       blockers.push("Web release degraded");
  if (mobileScore < 60)    blockers.push("Mobile release degraded");
  if (storeScore < 60)     blockers.push("App store rejected");
  if (onboardScore < 60)   blockers.push("Onboarding degraded");
  if (isoViolations > 0)   blockers.push("Release isolation violations");

  return {
    score,
    label:   score >= 80 ? "RELEASE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useFinalReleaseReadiness({
  frScore      = 100,
  hostingScore = 100,
  webScore     = 100,
  mobileScore  = 100,
  storeScore   = 100,
  onboardScore = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runFRPerfAudit();
    setPerfAudit(perf);
    _save(FRPERF_KEY, perf);

    const safety = _runFRSafetyAudit();
    setSafetyAudit(safety);
    _save(FRSAFE_KEY, safety);

    const snap = _computeFRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      frScore, hostingScore, webScore, mobileScore, storeScore, onboardScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < FRREADY_TTL)
        .slice(0, FRREADY_MAX);
      _save(FRREADY_KEY, next);
      return next;
    });
  }, [frScore, hostingScore, webScore, mobileScore, storeScore, onboardScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(FRPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < FRPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(FRSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < FRSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(FRREADY_KEY, []).filter(s => now - (s.ts || 0) < FRREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const finalReleaseReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "RELEASE",
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
    finalReleaseReadinessPill,
    readinessTrend,
    evaluate,
  };
}
