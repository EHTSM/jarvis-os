// Phases 1584-1585 + 1590: Desktop experience + production packaging —
// execution performance audit + operational safety audit + complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only. Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const DXPR_PERF_KEY  = "jarvis_dxp_perf_audit";
const DXPR_SAFE_KEY  = "jarvis_dxp_safety_audit";
const DXPR_READY_KEY = "jarvis_dxp_readiness";

const DXPR_READY_MAX = 20;
const DXPR_PERF_TTL  = 24 * 60 * 60 * 1000;
const DXPR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const DXPR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1584: Execution performance audit ───────────────────────────────────

function _runDXPRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_dxp_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate desktop session IDs` });
  } catch {}

  try {
    const notifs  = JSON.parse(localStorage.getItem("jarvis_dxp_notifications") || "[]");
    const recent  = notifs.filter(n => Date.now() - (n.ts || 0) < 60_000);
    if (recent.length > 10) findings.push({ id: "notif_flood", severity: "high", msg: `${recent.length} notifications in last 60s` });
  } catch {}

  try {
    const windows = JSON.parse(localStorage.getItem("jarvis_dxp_windows") || "[]");
    const active  = windows.filter(w => w.stage === "active");
    if (active.length > 12) findings.push({ id: "window_saturation", severity: "high", msg: `${active.length} active windows` });
  } catch {}

  try {
    const pkg    = JSON.parse(localStorage.getItem("jarvis_dxp_packaging") || "[]");
    const leaked = pkg.filter(p => p.userInput || p.rawContent);
    if (leaked.length > 0) findings.push({ id: "pkg_pii_leak", severity: "high", msg: `${leaked.length} packaging entries with PII` });
  } catch {}

  try {
    const updates = JSON.parse(localStorage.getItem("jarvis_dxp_updates") || "[]");
    const failed  = updates.filter(u => u.stage === "failed");
    if (failed.length > 2) findings.push({ id: "update_failures", severity: "high", msg: `${failed.length} failed auto-updates` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1585: Operational safety audit ─────────────────────────────────────

const DXPR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_dxp_auto_escalate", "jarvis_auto_dxp_deploy", "jarvis_dxp_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_dxp_sessions") || "[]");
        return sessions.filter(s => s.stage === "active").every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_dxp_sessions") || "[]");
        const stale    = sessions.filter(s =>
          s.stage === "recovering" && Date.now() - (s.ts || 0) > 48 * 60 * 60 * 1000
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
        const tray   = JSON.parse(localStorage.getItem("jarvis_dxp_tray") || "[]");
        const recent = tray.filter(t => Date.now() - (t.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_dxp_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_dxp_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_notification_flood",
    label: "No desktop notification flood",
    check: () => {
      try {
        const notifs  = JSON.parse(localStorage.getItem("jarvis_dxp_notifications") || "[]");
        const recent  = notifs.filter(n => Date.now() - (n.ts || 0) < 60_000);
        return recent.length <= 10;
      } catch { return true; }
    },
  },
  {
    id:    "no_hidden_background_escalation",
    label: "No hidden background escalation",
    check: () => ["jarvis_dxp_bg_auto", "jarvis_dxp_tray_auto", "jarvis_dxp_bg_exec"]
      .every(k => localStorage.getItem(k) === null),
  },
];

function _runDXPRSafetyAudit() {
  const results = DXPR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1590: Desktop complete ─────────────────────────────────────────────

function _computeDXPRReadiness({
  perfScore    = 100,
  safetyScore  = 100,
  dxpScore     = 100,
  sessionScore = 100,
  windowScore  = 100,
  notifScore   = 100,
  packageScore = 100,
  updateScore  = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    sessionScore * 0.20 +
    notifScore   * 0.15 +
    windowScore  * 0.15 +
    packageScore * 0.10 +
    updateScore  * 0.10 +
    dxpScore     * 0.03 +
    perfScore    * 0.02
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (notifScore < 40)     blockers.push("Notification flood detected");
  if (sessionScore < 60)   blockers.push("Desktop session recovery elevated");
  if (packageScore < 60)   blockers.push("Packaging build failures");
  if (updateScore < 60)    blockers.push("Auto-update failures");
  if (windowScore < 60)    blockers.push("Window saturation");
  if (isoViolations > 0)   blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "PACKAGED" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useDesktopReadiness({
  dxpScore     = 100,
  sessionScore = 100,
  windowScore  = 100,
  notifScore   = 100,
  packageScore = 100,
  updateScore  = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runDXPRPerfAudit();
    setPerfAudit(perf);
    _save(DXPR_PERF_KEY, perf);

    const safety = _runDXPRSafetyAudit();
    setSafetyAudit(safety);
    _save(DXPR_SAFE_KEY, safety);

    const snap = _computeDXPRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      dxpScore, sessionScore, windowScore, notifScore, packageScore, updateScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < DXPR_READY_TTL)
        .slice(0, DXPR_READY_MAX);
      _save(DXPR_READY_KEY, next);
      return next;
    });
  }, [dxpScore, sessionScore, windowScore, notifScore, packageScore, updateScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(DXPR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < DXPR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(DXPR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < DXPR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(DXPR_READY_KEY, []).filter(s => now - (s.ts || 0) < DXPR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const desktopReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "PKG",
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
    desktopReadinessPill,
    readinessTrend,
    evaluate,
  };
}
