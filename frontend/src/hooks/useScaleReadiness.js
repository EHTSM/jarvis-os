// Phase 1151-1155: Execution performance audit + operational safety audit +
// multi-user validation + scale operations audit + foundation complete.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 perf samples, 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const SCPERF_KEY  = "jarvis_scale_perf_audit";
const SCSAFE_KEY  = "jarvis_scale_safety_audit";
const SCREADY_KEY = "jarvis_scale_readiness";

const SCPERF_MAX  = 20;
const SCREADY_MAX = 20;

const SCPERF_TTL  = 24 * 60 * 60 * 1000;
const SCSAFE_TTL  = 24 * 60 * 60 * 1000;
const SCREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1151: Execution performance audit ───────────────────────────────────

function _runScalePerfAudit() {
  const now = Date.now();
  let jarvisKeys = 0;
  let totalBytes = 0;
  let largestArray = 0;
  let duplicateIds = 0;

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
        // Check for duplicate IDs in bounded arrays
        const ids = parsed.map(item => item?.id).filter(Boolean);
        duplicateIds += ids.length - new Set(ids).size;
      }
    }
  } catch {}

  const findings = [];
  if (jarvisKeys > 120)       findings.push({ id: "key_count",   severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 900_000)   findings.push({ id: "storage",     severity: "medium", msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)     findings.push({ id: "array_size",  severity: "high",   msg: `Array of ${largestArray} items` });
  if (duplicateIds > 0)       findings.push({ id: "duplicates",  severity: "high",   msg: `${duplicateIds} duplicate IDs across arrays` });

  // Queue duplication check
  try {
    const q = JSON.parse(localStorage.getItem("jarvis_scale_queue") || "[]");
    const qIds = q.map(e => e.id);
    const qDupes = qIds.length - new Set(qIds).size;
    if (qDupes > 0) findings.push({ id: "queue_duplication", severity: "high", msg: `${qDupes} duplicate queue entries` });
  } catch {}

  return {
    ts:          now,
    jarvisKeys,
    totalBytes,
    largestArray,
    duplicateIds,
    findings,
    highCount:   findings.filter(f => f.severity === "high").length,
    score:       findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1152: Operational safety audit ─────────────────────────────────────

const SCALE_SAFETY_RULES = [
  {
    id:    "no_hidden_escalation",
    label: "No hidden execution escalation",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_self_run"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_collaboration",
    label: "No unsafe collaboration continuation",
    check: () => {
      try {
        const collab = JSON.parse(localStorage.getItem("jarvis_collab_state") || "[]");
        // Collaboration events should have wsId — undefined wsId = bad state
        return collab.every(e => typeof e.wsId === "string" && e.wsId.length > 0);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_under_load",
    label: "No stale replay under active load",
    check: () => {
      try {
        const load = JSON.parse(localStorage.getItem("jarvis_load_samples") || "[]");
        const latestLoad = load[0];
        if (!latestLoad || latestLoad.pressure < 50) return true; // only check when under load
        const snap = JSON.parse(localStorage.getItem("jarvis_replay_state") || "null");
        if (!snap) return true;
        const ageMins = (Date.now() - (snap.ts || 0)) / 60000;
        return ageMins < 30;
      } catch { return true; }
    },
  },
  {
    id:    "no_queue_overflow",
    label: "Queue within bounds",
    check: () => {
      try {
        const q = JSON.parse(localStorage.getItem("jarvis_scale_queue") || "[]");
        return Array.isArray(q) && q.length <= 30;
      } catch { return true; }
    },
  },
  {
    id:    "workspace_count_bounded",
    label: "Workspace count bounded",
    check: () => {
      try {
        const ws = JSON.parse(localStorage.getItem("jarvis_ws_coordination") || "[]");
        return Array.isArray(ws) && ws.length <= 10;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_collab",
    label: "No recursive collaboration loops",
    check: () => {
      try {
        const collab = JSON.parse(localStorage.getItem("jarvis_collab_state") || "[]");
        const recentJoins = collab.filter(
          e => e.type === "workspace_joined" && Date.now() - (e.ts || 0) < 60 * 1000
        );
        return recentJoins.length < 5; // max 5 joins per minute
      } catch { return true; }
    },
  },
];

function _runScaleSafetyAudit() {
  const results = SCALE_SAFETY_RULES.map(rule => ({
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

// ── Phase 1153-1155: Validation + audit + foundation complete ─────────────────

function _computeScaleReadiness({
  perfScore           = 100,
  safetyScore         = 100,
  survivabilityScore  = 100,
  backpressureLevel   = "none",
  isoViolations       = 0,
} = {}) {
  const composite = Math.round(
    safetyScore        * 0.30 +
    survivabilityScore * 0.35 +
    perfScore          * 0.20
  )
  - (backpressureLevel === "hard" ? 20 : backpressureLevel === "soft" ? 10 : 0)
  - (isoViolations > 0 ? 10 : 0)
  + (safetyScore === 100 ? 15 : 0); // bonus for full safety pass

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)          blockers.push("Safety audit failures");
  if (backpressureLevel === "hard") blockers.push("Hard backpressure active");
  if (survivabilityScore < 60)     blockers.push("Survivability degraded");
  if (isoViolations > 0)           blockers.push("Isolation violations");

  return {
    score,
    label:   score >= 80 ? "SCALE READY" : score >= 60 ? "NEEDS WORK" : "NOT READY",
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

export function useScaleReadiness({
  survivabilityScore = 100,
  backpressureLevel  = "none",
  isoViolations      = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runScalePerfAudit();
    setPerfAudit(perf);
    _save(SCPERF_KEY, perf);

    const safety = _runScaleSafetyAudit();
    setSafetyAudit(safety);
    _save(SCSAFE_KEY, safety);

    const snap = _computeScaleReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      survivabilityScore, backpressureLevel, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < SCREADY_TTL)
        .slice(0, SCREADY_MAX);
      _save(SCREADY_KEY, next);
      return next;
    });
  }, [survivabilityScore, backpressureLevel, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(SCPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < SCPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(SCSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < SCSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(SCREADY_KEY, []).filter(s => now - (s.ts || 0) < SCREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  // Calm pill — hidden when scale ready (Phase 1150 UX)
  const scaleReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "SCALE",
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
    scaleReadinessPill,
    readinessTrend,
    evaluate,
  };
}
