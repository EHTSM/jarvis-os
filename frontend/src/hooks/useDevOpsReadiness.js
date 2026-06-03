// Phase 1272-1275: Execution performance audit + operational safety audit +
// DevOps operations validation + foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const DEVOPSPERF_KEY  = "jarvis_devops_perf_audit";
const DEVOPSSAFE_KEY  = "jarvis_devops_safety_audit";
const DEVOPSREADY_KEY = "jarvis_devops_readiness";

const DEVOPSREADY_MAX = 20;

const DEVOPSPERF_TTL  = 24 * 60 * 60 * 1000;
const DEVOPSSAFE_TTL  = 24 * 60 * 60 * 1000;
const DEVOPSREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1272: Execution performance audit ───────────────────────────────────

function _runDevOpsPerfAudit() {
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
  if (jarvisKeys > 200)        findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_600_000)  findings.push({ id: "storage",    severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB storage` });
  if (largestArray > 500)      findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Pipeline duplication check
  try {
    const pipes = JSON.parse(localStorage.getItem("jarvis_cicd_pipelines") || "[]");
    const ids   = pipes.map(p => p.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "pipeline_duplication", severity: "high", msg: `${dupes} duplicate pipeline IDs` });
  } catch {}

  // Active provision overflow check
  try {
    const provs  = JSON.parse(localStorage.getItem("jarvis_infra_provisions") || "[]");
    const active = provs.filter(p => !["ready", "failed"].includes(p.stage));
    if (active.length > 5) findings.push({ id: "provision_overflow", severity: "medium", msg: `${active.length} active provisions` });
  } catch {}

  // Release duplication check
  try {
    const rels   = JSON.parse(localStorage.getItem("jarvis_release_approvals") || "[]");
    const active = rels.filter(r => !["complete", "reverted"].includes(r.stage));
    if (active.length > 3) findings.push({ id: "release_overflow", severity: "medium", msg: `${active.length} active releases` });
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

// ── Phase 1273: Operational safety audit ─────────────────────────────────────

const DEVOPS_SAFETY_RULES = [
  {
    id:    "no_hidden_release_escalation",
    label: "No hidden release escalation",
    check: () => {
      try {
        const rels = JSON.parse(localStorage.getItem("jarvis_release_approvals") || "[]");
        return rels
          .filter(r => ["deploying", "complete"].includes(r.stage))
          .every(r => r.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_provisioning",
    label: "No unsafe auto-provisioning",
    check: () => ["jarvis_auto_provision", "jarvis_infra_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const pipes = JSON.parse(localStorage.getItem("jarvis_cicd_pipelines") || "[]");
        const stale = pipes.filter(p =>
          ["building", "testing"].includes(p.stage)
          && Date.now() - (p.ts || 0) > 2 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_automation_loops",
    label: "No recursive automation loops",
    check: () => {
      try {
        const syncs  = JSON.parse(localStorage.getItem("jarvis_env_sync") || "[]");
        const recent = syncs.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_devops_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "deployments_approval_gated",
    label: "All deployments approval-gated",
    check: () => {
      try {
        const pipes = JSON.parse(localStorage.getItem("jarvis_cicd_pipelines") || "[]");
        return pipes
          .filter(p => ["deploying", "verifying", "complete"].includes(p.stage))
          .every(p => p.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "devops_isolation_clean",
    label: "DevOps isolation clean",
    check: () => {
      try {
        const violations = JSON.parse(localStorage.getItem("jarvis_devops_isolation") || "[]");
        const recent = violations.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
];

function _runDevOpsSafetyAudit() {
  const results = DEVOPS_SAFETY_RULES.map(rule => ({
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

// ── Phase 1274-1275: Validation + foundation complete ────────────────────────

function _computeDevOpsReadiness({
  perfScore        = 100,
  safetyScore      = 100,
  devOpsScore      = 100,
  pipelineHealth   = 100,
  buildSurvivability = 100,
  envSyncScore     = 100,
  isoViolations    = 0,
  activePipelines  = 0,
} = {}) {
  const composite = Math.round(
    safetyScore        * 0.25 +
    devOpsScore        * 0.20 +
    pipelineHealth     * 0.20 +
    buildSurvivability * 0.15 +
    envSyncScore       * 0.10 +
    perfScore          * 0.10
  )
  - (isoViolations   > 0 ? 10 : 0)
  - (activePipelines > 4 ? 5  : 0)
  + (safetyScore === 100 ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)          blockers.push("Safety audit failures");
  if (pipelineHealth < 50)        blockers.push("Pipeline health critical");
  if (buildSurvivability < 50)    blockers.push("Build survivability low");
  if (envSyncScore < 50)          blockers.push("Environment sync degraded");
  if (isoViolations > 0)          blockers.push("DevOps isolation violations");
  if (activePipelines > 4)        blockers.push(`${activePipelines} concurrent pipelines`);

  return {
    score,
    label:   score >= 80 ? "DEVOPS READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useDevOpsReadiness({
  devOpsScore        = 100,
  pipelineHealth     = 100,
  buildSurvivability = 100,
  envSyncScore       = 100,
  isoViolations      = 0,
  activePipelines    = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runDevOpsPerfAudit();
    setPerfAudit(perf);
    _save(DEVOPSPERF_KEY, perf);

    const safety = _runDevOpsSafetyAudit();
    setSafetyAudit(safety);
    _save(DEVOPSSAFE_KEY, safety);

    const snap = _computeDevOpsReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      devOpsScore, pipelineHealth, buildSurvivability,
      envSyncScore, isoViolations, activePipelines,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < DEVOPSREADY_TTL)
        .slice(0, DEVOPSREADY_MAX);
      _save(DEVOPSREADY_KEY, next);
      return next;
    });
  }, [devOpsScore, pipelineHealth, buildSurvivability, envSyncScore, isoViolations, activePipelines]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(DEVOPSPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < DEVOPSPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(DEVOPSSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < DEVOPSSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(DEVOPSREADY_KEY, []).filter(s => now - (s.ts || 0) < DEVOPSREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const devOpsReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "DEVOPS",
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
    devOpsReadinessPill,
    readinessTrend,
    evaluate,
  };
}
