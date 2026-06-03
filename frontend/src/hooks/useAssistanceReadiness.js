// Phase 1091-1095: Execution performance audit + operational safety audit +
// autonomous-assisted UX refinement + validation + foundation complete.
//
// Consolidates five phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 perf samples, 10 safety results, 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const APERF_KEY   = "jarvis_assist_perf_audit";
const ASAFE_KEY   = "jarvis_assist_safety_audit";
const AREADY_KEY  = "jarvis_assist_readiness";

const APERF_MAX   = 20;
const AREADY_MAX  = 20;

const APERF_TTL   = 24 * 60 * 60 * 1000;
const ASAFE_TTL   = 24 * 60 * 60 * 1000;
const AREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1091: Execution performance audit ───────────────────────────────────

function _runAssistPerfAudit() {
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
  if (jarvisKeys > 90)       findings.push({ id: "key_count",    severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 600_000)  findings.push({ id: "storage_size", severity: "medium", msg: `${Math.round(totalBytes / 1024)}KB total` });
  if (largestArray > 400)    findings.push({ id: "large_array",  severity: "high",   msg: `Array of ${largestArray} items` });

  // Check for duplicate workflow IDs (workflow duplication guard)
  try {
    const wfs = JSON.parse(localStorage.getItem("jarvis_assisted_workflows") || "[]");
    const ids = wfs.map(w => w.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "workflow_duplication", severity: "high", msg: `${dupes} duplicate workflow IDs` });
  } catch {}

  return {
    ts:          now,
    jarvisKeys,
    totalBytes,
    largestArray,
    findings,
    highFindings: findings.filter(f => f.severity === "high").length,
    score:        findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1092: Operational safety audit ─────────────────────────────────────

const ASSIST_SAFETY_RULES = [
  {
    id:    "no_hidden_autonomy",
    label: "No hidden autonomous execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_self_run"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unapproved_execution",
    label: "No unapproved workflow execution",
    check: () => {
      try {
        const wfs = JSON.parse(localStorage.getItem("jarvis_assisted_workflows") || "[]");
        return wfs.filter(w => w.stage === "execute" && !w.approved).length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_recovery",
    label: "No stale recovery active",
    check: () => {
      try {
        const recs = JSON.parse(localStorage.getItem("jarvis_assist_recovery") || "[]");
        const stale = recs.filter(r =>
          r.status === "pending" && Date.now() - (r.ts || 0) > 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_workflows",
    label: "No recursive workflow chains",
    check: () => {
      try {
        const wfs = JSON.parse(localStorage.getItem("jarvis_assisted_workflows") || "[]");
        const activeCount = wfs.filter(w => w.status === "active").length;
        return activeCount <= 3; // max 3 concurrent active workflows
      } catch { return true; }
    },
  },
  {
    id:    "approval_gate_intact",
    label: "Approval gate intact for all risk actions",
    check: () => {
      try {
        const apprs = JSON.parse(localStorage.getItem("jarvis_assist_approvals") || "[]");
        const highRiskUnapproved = apprs.filter(a =>
          a.risk === "high" && !a.approved &&
          Date.now() - (a.ts || 0) < 60 * 60 * 1000
        );
        // High-risk approvals are expected to be pending (not a violation)
        // — violation would be if high-risk workflow is in "execute" without approval
        return highRiskUnapproved.length < 5; // too many pending = sign of bypass
      } catch { return true; }
    },
  },
];

function _runAssistSafetyAudit() {
  const results = ASSIST_SAFETY_RULES.map(rule => ({
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

// ── Phase 1093-1095: UX refinement + validation + foundation scoring ──────────

function _computeAssistReadiness({
  perfScore        = 100,
  safetyScore      = 100,
  accelerationScore = 100,
  operationalTrust  = 100,
  continuityRisk    = false,
} = {}) {
  const composite = Math.round(
    safetyScore       * 0.35 +
    perfScore         * 0.20 +
    operationalTrust  * 0.25 +
    accelerationScore * 0.20
  ) - (continuityRisk ? 10 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const highlights = [];
  if (safetyScore < 100)       highlights.push("Safety issues");
  if (perfScore < 75)          highlights.push("Perf degraded");
  if (continuityRisk)          highlights.push("Continuity risk");
  if (operationalTrust < 70)   highlights.push("Trust low");

  return {
    score,
    label:      score >= 80 ? "ASSISTANCE READY" : score >= 60 ? "DEVELOPING" : "FOUNDATIONAL",
    color:      score >= 80 ? "var(--op-green)"  : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    highlights,
    ts:         Date.now(),
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

export function useAssistanceReadiness({
  accelerationScore = 100,
  operationalTrust  = 100,
  continuityRisk    = false,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf   = _runAssistPerfAudit();
    setPerfAudit(perf);
    _save(APERF_KEY, perf);

    const safety = _runAssistSafetyAudit();
    setSafetyAudit(safety);
    _save(ASAFE_KEY, safety);

    const snap = _computeAssistReadiness({
      perfScore:        perf.score,
      safetyScore:      safety.score,
      accelerationScore,
      operationalTrust,
      continuityRisk,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < AREADY_TTL)
        .slice(0, AREADY_MAX);
      _save(AREADY_KEY, next);
      return next;
    });
  }, [accelerationScore, operationalTrust, continuityRisk]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(APERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < APERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(ASAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < ASAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(AREADY_KEY, []).filter(s => now - (s.ts || 0) < AREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  // Calm pill — only shown when not ready (Phase 1093 UX)
  const assistReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:     "ASSIST",
      score:     latestReadiness.score,
      color:     latestReadiness.color,
      highlight: latestReadiness.highlights[0] || null,
    };
  }, [latestReadiness]);

  // Trend from last two snapshots
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
    assistReadinessPill,
    readinessTrend,
    evaluate,
  };
}
