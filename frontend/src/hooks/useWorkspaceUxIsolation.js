// Phase 1059-1064: Multi-workspace UX isolation + perf audit + safety audit +
// UX refinement + session validation + daily-driver readiness.
//
// Consolidates six phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 15 UX isolation events, 20 perf samples, 10 safety events, 5 workspace UX profiles.

import { useState, useEffect, useCallback, useMemo } from "react";

const UXISO_KEY   = "jarvis_ux_isolation";
const UXPERF_KEY  = "jarvis_dd_perf";
const UXSAFE_KEY  = "jarvis_dd_safety";
const UXPROF_KEY  = "jarvis_ux_ws_profiles";

const UXISO_MAX   = 15;
const UXPERF_MAX  = 20;
const UXSAFE_MAX  = 10;
const UXPROF_MAX  = 5;

const UXISO_TTL   = 7  * 24 * 60 * 60 * 1000;
const UXPERF_TTL  = 24 * 60 * 60 * 1000;
const UXSAFE_TTL  = 24 * 60 * 60 * 1000;
const DD_TTL      = 30 * 24 * 60 * 60 * 1000;

// ── Phase 1059: Multi-workspace UX isolation ──────────────────────────────────

// UX-state keys that must not bleed across workspaces
const UX_ISOLATED_PREFIXES = [
  "jarvis_daily_driver_",
  "jarvis_dd_assistance_",
  "jarvis_op_smoothness_",
  "jarvis_dd_prod_obs_",
  "jarvis_workflow_accel_",
];

function _scanUxIsolation(activeWsId, allWsIds) {
  if (!activeWsId || allWsIds.length <= 1) return [];
  const violations = [];
  allWsIds.forEach(wsId => {
    if (wsId === activeWsId) return;
    UX_ISOLATED_PREFIXES.forEach(prefix => {
      const key = `${prefix}${wsId}`;
      if (localStorage.getItem(key) !== null) {
        violations.push({ wsId, key, reason: "Cross-workspace UX state bleed" });
      }
    });
  });
  return violations.slice(0, 5);
}

// Per-workspace UX profile
function _buildUxProfile(wsId) {
  return {
    wsId,
    updatedAt: Date.now(),
    smoothnessScore: null,
    assistCount: 0,
    shortcutUsageCount: 0,
  };
}

// ── Phase 1060: Performance audit ─────────────────────────────────────────────

function _samplePerfMetrics() {
  const now = Date.now();
  const snap = {
    ts: now,
    domNodes: document.querySelectorAll("*").length,
    localStorageKeys: (() => {
      try { return localStorage.length; } catch { return 0; }
    })(),
    jarvisKeyCount: (() => {
      try {
        let c = 0;
        for (let i = 0; i < localStorage.length; i++) {
          if (localStorage.key(i)?.startsWith("jarvis_")) c++;
        }
        return c;
      } catch { return 0; }
    })(),
  };

  // Perf health: flag if jarvis keys growing excessively or DOM too large
  snap.perfHealth = snap.jarvisKeyCount > 60
    ? "degraded"
    : snap.domNodes > 5000
    ? "degraded"
    : "healthy";

  return snap;
}

// ── Phase 1061: Safety audit ───────────────────────────────────────────────────

const SAFETY_CHECKS = [
  {
    id: "no_raw_output",
    label: "No raw output in storage",
    check: () => {
      try {
        for (let i = 0; i < Math.min(localStorage.length, 50); i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("jarvis_")) continue;
          const val = localStorage.getItem(key) || "";
          // Flag if value looks like raw command output (long lines, shell chars)
          if (val.length > 5000 && (val.includes("$") || val.includes("\n\n\n"))) return false;
        }
        return true;
      } catch { return true; }
    },
  },
  {
    id: "bounded_arrays",
    label: "Storage arrays bounded",
    check: () => {
      try {
        for (let i = 0; i < Math.min(localStorage.length, 50); i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("jarvis_")) continue;
          const parsed = JSON.parse(localStorage.getItem(key) || "null");
          if (Array.isArray(parsed) && parsed.length > 500) return false;
        }
        return true;
      } catch { return true; }
    },
  },
  {
    id: "no_autonomous_flags",
    label: "No autonomous execution flags",
    check: () => {
      const autonomousKeys = ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_self_run"];
      return autonomousKeys.every(k => localStorage.getItem(k) === null);
    },
  },
];

function _runSafetyAudit() {
  const results = SAFETY_CHECKS.map(check => ({
    id: check.id,
    label: check.label,
    passed: check.check(),
    ts: Date.now(),
  }));
  const passCount = results.filter(r => r.passed).length;
  return {
    results,
    passCount,
    total: results.length,
    allPassed: passCount === results.length,
    score: Math.round((passCount / results.length) * 100),
  };
}

// ── Phase 1062: UX refinement + session validation ─────────────────────────────

function _validateSessionHealth({ smoothness, sessionContinuity, debugCtx } = {}) {
  const issues = [];

  if (smoothness != null && smoothness < 50) {
    issues.push({ id: "low_smoothness", label: "Operator smoothness low", severity: "medium" });
  }
  if (sessionContinuity?.corruptedKeys?.length > 0) {
    issues.push({ id: "corrupted_keys", label: "Session keys corrupted", severity: "high" });
  }
  if (sessionContinuity?.dedupRisk) {
    issues.push({ id: "dedup_risk", label: "Dedup risk detected", severity: "low" });
  }
  if (debugCtx?.recentFailCount > 5) {
    issues.push({ id: "high_fail_rate", label: "High recent failure rate", severity: "medium" });
  }

  const severity = issues.some(i => i.severity === "high")
    ? "high"
    : issues.some(i => i.severity === "medium")
    ? "medium"
    : issues.length > 0
    ? "low"
    : "none";

  return { issues, severity, healthy: severity === "none" };
}

// ── Phase 1063: Daily-driver readiness ───────────────────────────────────────

function _computeDdReadiness({
  smoothnessScore   = 100,
  safetyScore       = 100,
  perfHealth        = "healthy",
  isolationViolations = 0,
  sessionHealthy    = true,
} = {}) {
  let score = 100;
  if (smoothnessScore < 60)     score -= 20;
  else if (smoothnessScore < 80) score -= 10;
  if (safetyScore < 100)        score -= 15;
  if (perfHealth === "degraded") score -= 15;
  if (isolationViolations > 0)  score -= 10;
  if (!sessionHealthy)          score -= 15;
  score = Math.max(0, score);

  return {
    score,
    label: score >= 80 ? "DAILY-DRIVER READY" : score >= 60 ? "NEEDS ATTENTION" : "NOT READY",
    color: score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
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

export function useWorkspaceUxIsolation({
  smoothness        = null,
  sessionContinuity = null,
  debugCtx          = null,
} = {}) {
  const [uxIsoEvents,   setUxIsoEvents]   = useState([]);
  const [perfSamples,   setPerfSamples]   = useState([]);
  const [safetyAudit,   setSafetyAudit]   = useState(null);
  const [uxWsProfiles,  setUxWsProfiles]  = useState({});
  const [initialized,   setInitialized]   = useState(false);

  const activeWsId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();

    // Workspace UX isolation scan
    const allWsIds = (() => {
      try {
        return Object.keys(
          JSON.parse(localStorage.getItem("jarvis_mwc_state") || "{}").workspaces || {}
        );
      } catch { return []; }
    })();
    const violations = _scanUxIsolation(activeWsId, allWsIds);
    if (violations.length > 0) {
      setUxIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev]
          .filter(e => now - (e.ts || 0) < UXISO_TTL)
          .slice(0, UXISO_MAX);
        _save(UXISO_KEY, next);
        return next;
      });
    }

    // Perf sample
    const sample = _samplePerfMetrics();
    setPerfSamples(prev => {
      const next = [sample, ...prev]
        .filter(s => now - (s.ts || 0) < UXPERF_TTL)
        .slice(0, UXPERF_MAX);
      _save(UXPERF_KEY, next);
      return next;
    });

    // Safety audit
    const audit = _runSafetyAudit();
    setSafetyAudit(audit);
    _save(UXSAFE_KEY, { ...audit, ts: now });
  }, [activeWsId]);

  useEffect(() => {
    const now = Date.now();
    setUxIsoEvents(_load(UXISO_KEY, []).filter(e => now - (e.ts || 0) < UXISO_TTL));
    setPerfSamples(_load(UXPERF_KEY, []).filter(s => now - (s.ts || 0) < UXPERF_TTL));
    const cached = _load(UXSAFE_KEY, null);
    if (cached?.results) setSafetyAudit(cached);
    setUxWsProfiles(_load(UXPROF_KEY, {}));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Update workspace UX profile
  const updateUxProfile = useCallback((wsId, updates = {}) => {
    setUxWsProfiles(prev => {
      const profiles = { ...prev };
      if (Object.keys(profiles).length >= UXPROF_MAX && !profiles[wsId]) {
        const oldest = Object.keys(profiles).sort(
          (a, b) => (profiles[a].updatedAt || 0) - (profiles[b].updatedAt || 0)
        )[0];
        delete profiles[oldest];
      }
      profiles[wsId] = {
        ...(profiles[wsId] || _buildUxProfile(wsId)),
        ...updates,
        updatedAt: Date.now(),
      };
      _save(UXPROF_KEY, profiles);
      return profiles;
    });
  }, []);

  // Session health validation (Phase 1062)
  const sessionHealth = useMemo(
    () => _validateSessionHealth({ smoothness, sessionContinuity, debugCtx }),
    [smoothness, sessionContinuity, debugCtx]
  );

  // Latest perf sample
  const latestPerf = useMemo(() => perfSamples[0] || null, [perfSamples]);

  // Recent isolation violations (last hour)
  const recentIsoViolations = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return uxIsoEvents.filter(e => (e.ts || 0) > cutoff).length;
  }, [uxIsoEvents]);

  // Daily-driver readiness (Phase 1063)
  const ddReadiness = useMemo(() => _computeDdReadiness({
    smoothnessScore:     smoothness ?? 100,
    safetyScore:         safetyAudit?.score ?? 100,
    perfHealth:          latestPerf?.perfHealth ?? "healthy",
    isolationViolations: recentIsoViolations,
    sessionHealthy:      sessionHealth.healthy,
  }), [smoothness, safetyAudit, latestPerf, recentIsoViolations, sessionHealth.healthy]);

  // Operator bar pill (only shown when not ready)
  const ddIsoBar = useMemo(() => {
    if (ddReadiness.score >= 80 && sessionHealth.healthy) return null;
    const topIssue = sessionHealth.issues[0];
    return {
      label: "DD-UX",
      score: ddReadiness.score,
      color: ddReadiness.color,
      detail: topIssue?.label || (latestPerf?.perfHealth === "degraded" ? "Perf degraded" : null),
    };
  }, [ddReadiness, sessionHealth, latestPerf]);

  return {
    initialized,
    uxIsoEvents,
    perfSamples,
    safetyAudit,
    uxWsProfiles,
    sessionHealth,
    latestPerf,
    ddReadiness,
    ddIsoBar,
    // Actions
    evaluate,
    updateUxProfile,
  };
}
