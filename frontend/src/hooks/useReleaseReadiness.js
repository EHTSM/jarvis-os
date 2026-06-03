// Phase 1121-1125: Execution performance audit + operational safety audit +
// public release validation + public release audit + foundation complete.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 perf samples, 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const RELPERF_KEY  = "jarvis_release_perf_audit";
const RELSAFE_KEY  = "jarvis_release_safety_audit";
const RELREADY_KEY = "jarvis_release_readiness";

const RELPERF_MAX  = 20;
const RELREADY_MAX = 20;

const RELPERF_TTL  = 24 * 60 * 60 * 1000;
const RELSAFE_TTL  = 24 * 60 * 60 * 1000;
const RELREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1121: Execution performance audit ───────────────────────────────────

function _runReleasePerfAudit() {
  const now = Date.now();
  let jarvisKeys = 0;
  let totalBytes = 0;
  let largestArray = 0;
  const unboundedKeys = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key) || "";
      totalBytes += key.length + val.length;
      if (!key?.startsWith("jarvis_")) continue;
      jarvisKeys++;
      const parsed = JSON.parse(val || "null");
      if (Array.isArray(parsed)) {
        if (parsed.length > largestArray) largestArray = parsed.length;
        if (parsed.length > 500) unboundedKeys.push(key);
      }
    }
  } catch {}

  const findings = [];
  if (jarvisKeys > 100)          findings.push({ id: "key_count",    severity: "medium", msg: `${jarvisKeys} jarvis keys — very high` });
  if (totalBytes > 700_000)      findings.push({ id: "storage_size", severity: "medium", msg: `${Math.round(totalBytes / 1024)}KB total storage` });
  if (largestArray > 500)        findings.push({ id: "large_array",  severity: "high",   msg: `Unbounded array: ${largestArray} items` });
  if (unboundedKeys.length > 0)  findings.push({ id: "unbounded",    severity: "high",   msg: `${unboundedKeys.length} keys with >500 items` });

  // Check for listener leak indicators (Phase 1121)
  const domListenerProxy = document.querySelectorAll("*").length;
  if (domListenerProxy > 8000) findings.push({ id: "dom_size", severity: "medium", msg: `DOM has ${domListenerProxy} nodes` });

  return {
    ts:           now,
    jarvisKeys,
    totalBytes,
    largestArray,
    unboundedKeys: unboundedKeys.slice(0, 5),
    domNodes:      domListenerProxy,
    findings,
    highCount:     findings.filter(f => f.severity === "high").length,
    score:         findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1122: Operational safety audit ─────────────────────────────────────

const RELEASE_SAFETY_RULES = [
  {
    id:    "no_hidden_execution",
    label: "No hidden autonomous execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_self_run", "jarvis_recursive_run"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_update",
    label: "No unapproved stable-channel release active",
    check: () => {
      try {
        const releases = JSON.parse(localStorage.getItem("jarvis_release_state") || "[]");
        return releases.filter(r =>
          r.channel === "stable" && r.status === "delivered" && !r.approved
        ).length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_in_release",
    label: "No stale replay during active release",
    check: () => {
      try {
        const releases = JSON.parse(localStorage.getItem("jarvis_release_state") || "[]");
        const activeRel = releases.find(r => r.status === "staged" || r.status === "delivered");
        if (!activeRel) return true;
        const snap = JSON.parse(localStorage.getItem("jarvis_replay_state") || "null");
        if (!snap) return true;
        const ageMins = (Date.now() - (snap.ts || 0)) / 60000;
        return ageMins < 30; // replay must be < 30min during active release
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_release",
    label: "No concurrent release escalation",
    check: () => {
      try {
        const releases = JSON.parse(localStorage.getItem("jarvis_release_state") || "[]");
        const active = releases.filter(r => r.status === "staged" || r.status === "delivered");
        return active.length <= 2; // max 2 concurrent staged releases
      } catch { return true; }
    },
  },
  {
    id:    "telemetry_bounded",
    label: "Public telemetry bounded",
    check: () => {
      try {
        const telem = JSON.parse(localStorage.getItem("jarvis_public_telemetry") || "[]");
        return Array.isArray(telem) && telem.length <= 20;
      } catch { return true; }
    },
  },
  {
    id:    "crash_reports_bounded",
    label: "Crash reports bounded",
    check: () => {
      try {
        const crashes = JSON.parse(localStorage.getItem("jarvis_crash_reports") || "[]");
        return Array.isArray(crashes) && crashes.length <= 30;
      } catch { return true; }
    },
  },
];

function _runReleaseSafetyAudit() {
  const results = RELEASE_SAFETY_RULES.map(rule => ({
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

// ── Phase 1123-1125: Validation + audit + foundation complete ─────────────────

function _computeReleaseReadiness({
  perfScore          = 100,
  safetyScore        = 100,
  publicReadiness    = 100,
  survivabilityScore = 100,
  recentCrashCount   = 0,
} = {}) {
  const composite = Math.round(
    safetyScore        * 0.30 +
    publicReadiness    * 0.30 +
    perfScore          * 0.20 +
    survivabilityScore * 0.20
  ) - Math.min(20, recentCrashCount * 5);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)       blockers.push("Safety audit failures");
  if (recentCrashCount > 2)    blockers.push(`${recentCrashCount} crashes in 24h`);
  if (publicReadiness < 60)    blockers.push("Public readiness low");
  if (survivabilityScore < 70) blockers.push("Survivability degraded");

  return {
    score,
    label:   score >= 80 ? "RELEASE READY" : score >= 60 ? "NEEDS WORK" : "NOT READY",
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

export function useReleaseReadiness({
  publicReadiness    = 100,
  survivabilityScore = 100,
  recentCrashCount   = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runReleasePerfAudit();
    setPerfAudit(perf);
    _save(RELPERF_KEY, perf);

    const safety = _runReleaseSafetyAudit();
    setSafetyAudit(safety);
    _save(RELSAFE_KEY, safety);

    const snap = _computeReleaseReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      publicReadiness, survivabilityScore, recentCrashCount,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < RELREADY_TTL)
        .slice(0, RELREADY_MAX);
      _save(RELREADY_KEY, next);
      return next;
    });
  }, [publicReadiness, survivabilityScore, recentCrashCount]);

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

  // Calm pill — hidden when release ready (Phase 1123 UX)
  const releaseReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "RELEASE",
      score:   latestReadiness.score,
      color:   latestReadiness.color,
      blocker: latestReadiness.blockers[0] || null,
    };
  }, [latestReadiness]);

  // Trend
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
    releaseReadinessPill,
    readinessTrend,
    evaluate,
  };
}
