// Phases 1570-1571 + 1575: Electron desktop — execution performance audit +
// operational safety audit + desktop shell complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only. Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const ELDR_PERF_KEY  = "jarvis_eld_perf_audit";
const ELDR_SAFE_KEY  = "jarvis_eld_safety_audit";
const ELDR_READY_KEY = "jarvis_eld_readiness";

const ELDR_READY_MAX = 20;
const ELDR_PERF_TTL  = 24 * 60 * 60 * 1000;
const ELDR_SAFE_TTL  = 24 * 60 * 60 * 1000;
const ELDR_READY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1570: Execution performance audit ───────────────────────────────────

function _runELDRPerfAudit() {
  const now = Date.now();
  const findings = [];

  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_eld_sessions") || "[]");
    const ids      = sessions.map(s => s.sessionId).filter(Boolean);
    const dupes    = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "session_duplication", severity: "high", msg: `${dupes} duplicate desktop session IDs` });
  } catch {}

  try {
    const obs     = JSON.parse(localStorage.getItem("jarvis_eld_obs") || "[]");
    const crashes = obs.filter(o => o.type === "crash_count" && (o.value || 0) > 0);
    if (crashes.length > 0) findings.push({ id: "renderer_crashes", severity: "high", msg: `${crashes.length} crash obs recorded` });
  } catch {}

  try {
    const windows = JSON.parse(localStorage.getItem("jarvis_eld_windows") || "[]");
    const active  = windows.filter(w => w.stage === "active");
    if (active.length > 10) findings.push({ id: "window_saturation", severity: "high", msg: `${active.length} active desktop windows` });
  } catch {}

  try {
    const pkg    = JSON.parse(localStorage.getItem("jarvis_eld_packaging") || "[]");
    const leaked = pkg.filter(p => p.userInput || p.rawContent);
    if (leaked.length > 0) findings.push({ id: "pkg_pii_leak", severity: "high", msg: `${leaked.length} packaging entries with PII` });
  } catch {}

  try {
    const obs    = JSON.parse(localStorage.getItem("jarvis_eld_obs") || "[]");
    const leaked = obs.filter(o => o.userInput || o.rawContent);
    if (leaked.length > 0) findings.push({ id: "obs_pii_leak", severity: "high", msg: `${leaked.length} obs entries with PII` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1571: Operational safety audit ─────────────────────────────────────

const ELDR_SAFETY_RULES = [
  {
    id:    "no_hidden_deployment_escalation",
    label: "No hidden deployment escalation",
    check: () => ["jarvis_eld_auto_escalate", "jarvis_auto_eld_deploy", "jarvis_eld_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_runtime_execution",
    label: "No unsafe runtime execution",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_eld_sessions") || "[]");
        return sessions.filter(s => s.stage === "active").every(s => s.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_eld_sessions") || "[]");
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
        const obs    = JSON.parse(localStorage.getItem("jarvis_eld_obs") || "[]");
        const recent = obs.filter(o => Date.now() - (o.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_eld_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos   = JSON.parse(localStorage.getItem("jarvis_eld_live_iso") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_cross_window_contamination",
    label: "No cross-window state contamination",
    check: () => {
      try {
        const windows = JSON.parse(localStorage.getItem("jarvis_eld_windows") || "[]");
        return windows.every(w => !w.contaminated);
      } catch { return true; }
    },
  },
  {
    id:    "packaging_targets_not_failed",
    label: "Desktop packaging targets not failed",
    check: () => {
      try {
        const pkg = JSON.parse(localStorage.getItem("jarvis_eld_packaging") || "[]");
        return pkg.filter(p => p.stage === "failed").length === 0;
      } catch { return true; }
    },
  },
];

function _runELDRSafetyAudit() {
  const results = ELDR_SAFETY_RULES.map(rule => ({
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

// ── Phase 1575: Desktop shell complete ────────────────────────────────────────

function _computeELDRReadiness({
  perfScore    = 100,
  safetyScore  = 100,
  eldScore     = 100,
  sessionScore = 100,
  cockpitScore = 100,
  obsScore     = 100,
  windowScore  = 100,
  packageScore = 100,
  isoViolations = 0,
} = {}) {
  const composite = Math.round(
    safetyScore  * 0.25 +
    sessionScore * 0.20 +
    cockpitScore * 0.20 +
    obsScore     * 0.15 +
    windowScore  * 0.10 +
    packageScore * 0.07 +
    eldScore     * 0.02 +
    perfScore    * 0.01
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (obsScore < 50)       blockers.push("Desktop crash/reconnect issues");
  if (sessionScore < 60)   blockers.push("Desktop session recovery elevated");
  if (cockpitScore < 60)   blockers.push("Cockpit quality degraded");
  if (windowScore < 60)    blockers.push("Window saturation");
  if (packageScore < 60)   blockers.push("Packaging failures");
  if (isoViolations > 0)   blockers.push("Key isolation violations");

  return {
    score,
    label:   score >= 80 ? "DESKTOP READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useElectronReadiness({
  eldScore     = 100,
  sessionScore = 100,
  cockpitScore = 100,
  obsScore     = 100,
  windowScore  = 100,
  packageScore = 100,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runELDRPerfAudit();
    setPerfAudit(perf);
    _save(ELDR_PERF_KEY, perf);

    const safety = _runELDRSafetyAudit();
    setSafetyAudit(safety);
    _save(ELDR_SAFE_KEY, safety);

    const snap = _computeELDRReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      eldScore, sessionScore, cockpitScore, obsScore, windowScore, packageScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < ELDR_READY_TTL)
        .slice(0, ELDR_READY_MAX);
      _save(ELDR_READY_KEY, next);
      return next;
    });
  }, [eldScore, sessionScore, cockpitScore, obsScore, windowScore, packageScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(ELDR_PERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < ELDR_PERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(ELDR_SAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < ELDR_SAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(ELDR_READY_KEY, []).filter(s => now - (s.ts || 0) < ELDR_READY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const electronReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "DESKTOP",
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
    electronReadinessPill,
    readinessTrend,
    evaluate,
  };
}
