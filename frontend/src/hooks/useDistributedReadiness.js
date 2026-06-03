// Phase 1211-1215: Execution performance audit + operational safety audit +
// distributed operations validation + audit + foundation complete.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const DISTPERF_KEY  = "jarvis_dist_perf_audit";
const DISTSAFE_KEY  = "jarvis_dist_safety_audit";
const DISTREADY_KEY = "jarvis_dist_readiness";

const DISTREADY_MAX = 20;

const DISTPERF_TTL  = 24 * 60 * 60 * 1000;
const DISTSAFE_TTL  = 24 * 60 * 60 * 1000;
const DISTREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1211: Execution performance audit ───────────────────────────────────

function _runDistPerfAudit() {
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
  if (jarvisKeys > 150)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_200_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Node duplication check
  try {
    const nodes = JSON.parse(localStorage.getItem("jarvis_distributed_nodes") || "[]");
    const ids = nodes.map(n => n.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "node_duplication", severity: "high", msg: `${dupes} duplicate node IDs` });
  } catch {}

  // Queue duplication check
  try {
    const queue = JSON.parse(localStorage.getItem("jarvis_dist_queue") || "[]");
    const ids = queue.map(q => q.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "queue_duplication", severity: "medium", msg: `${dupes} duplicate queue entries` });
  } catch {}

  // Cloud deployment count check
  try {
    const deps = JSON.parse(localStorage.getItem("jarvis_cloud_deployments") || "[]");
    const activeDeps = deps.filter(d => !["complete", "rolled_back"].includes(d.stage));
    if (activeDeps.length > 5) findings.push({ id: "dep_saturation", severity: "medium", msg: `${activeDeps.length} active cloud deployments` });
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

// ── Phase 1212: Operational safety audit ─────────────────────────────────────

const DIST_SAFETY_RULES = [
  {
    id:    "no_hidden_distributed_escalation",
    label: "No hidden distributed escalation",
    check: () => {
      try {
        const execs = JSON.parse(localStorage.getItem("jarvis_remote_exec") || "[]");
        return execs.every(e => !e.autoEscalate && !e.bypassApproval);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_remote_execution",
    label: "No unsafe remote execution patterns",
    check: () => ["jarvis_auto_remote", "jarvis_distributed_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_failed_replay",
    label: "Stale failed replays not accumulating",
    check: () => {
      try {
        const replays = JSON.parse(localStorage.getItem("jarvis_distributed_replay") || "[]");
        const stale = replays.filter(
          r => r.result !== "success" && Date.now() - (r.ts || 0) > 60 * 60 * 1000
        );
        return stale.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_coordination_loops",
    label: "No recursive coordination loops",
    check: () => {
      try {
        const nodes = JSON.parse(localStorage.getItem("jarvis_distributed_nodes") || "[]");
        const recentUpdates = nodes.filter(n => Date.now() - (n.lastSeen || 0) < 5 * 1000);
        return recentUpdates.length < nodes.length; // not all nodes updated within 5s — coordination loop risk
      } catch { return true; }
    },
  },
  {
    id:    "queue_bounded",
    label: "Distributed queue bounded",
    check: () => {
      try {
        const queue = JSON.parse(localStorage.getItem("jarvis_dist_queue") || "[]");
        return Array.isArray(queue) && queue.length <= 25;
      } catch { return true; }
    },
  },
  {
    id:    "region_isolation_clean",
    label: "Region isolation violations clean",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_region_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "cloud_deployments_gated",
    label: "Cloud deployments require approval gate",
    check: () => {
      try {
        const deps = JSON.parse(localStorage.getItem("jarvis_cloud_deployments") || "[]");
        // All deployments at 'deploy' stage or beyond must have approvedAt set
        return deps
          .filter(d => ["deploy", "verify", "complete"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
];

function _runDistSafetyAudit() {
  const results = DIST_SAFETY_RULES.map(rule => ({
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

// ── Phase 1213-1215: Validation + audit + foundation complete ────────────────

function _computeDistReadiness({
  perfScore          = 100,
  safetyScore        = 100,
  nodeHealth         = 100,
  replaySurvivability = 100,
  redundancyScore    = 100,
  regionViolations   = 0,
  stressHighCount    = 0,
} = {}) {
  const composite = Math.round(
    safetyScore          * 0.30 +
    nodeHealth           * 0.25 +
    replaySurvivability  * 0.20 +
    redundancyScore      * 0.15 +
    perfScore            * 0.10
  )
  - (regionViolations > 0 ? 10 : 0)
  - (stressHighCount > 0  ? Math.min(20, stressHighCount * 10) : 0)
  + (safetyScore === 100  ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)         blockers.push("Safety audit failures");
  if (nodeHealth < 50)           blockers.push("Node health critical");
  if (replaySurvivability < 60)  blockers.push("Replay survivability low");
  if (redundancyScore < 40)      blockers.push("Redundancy insufficient");
  if (regionViolations > 0)      blockers.push("Region isolation violations");
  if (stressHighCount > 0)       blockers.push(`${stressHighCount} high-severity stress findings`);

  return {
    score,
    label:   score >= 80 ? "DISTRIBUTED READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useDistributedReadiness({
  nodeHealth          = 100,
  replaySurvivability = 100,
  redundancyScore     = 100,
  regionViolations    = 0,
  stressHighCount     = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runDistPerfAudit();
    setPerfAudit(perf);
    _save(DISTPERF_KEY, perf);

    const safety = _runDistSafetyAudit();
    setSafetyAudit(safety);
    _save(DISTSAFE_KEY, safety);

    const snap = _computeDistReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      nodeHealth, replaySurvivability, redundancyScore,
      regionViolations, stressHighCount,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < DISTREADY_TTL)
        .slice(0, DISTREADY_MAX);
      _save(DISTREADY_KEY, next);
      return next;
    });
  }, [nodeHealth, replaySurvivability, redundancyScore, regionViolations, stressHighCount]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(DISTPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < DISTPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(DISTSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < DISTSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(DISTREADY_KEY, []).filter(s => now - (s.ts || 0) < DISTREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const distributedReadinessPill = useMemo(() => {
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
    distributedReadinessPill,
    readinessTrend,
    evaluate,
  };
}
