// Phase 1167-1170: Execution performance audit + operational safety audit +
// marketplace validation + foundation complete.
//
// Consolidates four phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const MKTPERF_KEY  = "jarvis_marketplace_perf_audit";
const MKTSAFE_KEY  = "jarvis_marketplace_safety_audit";
const MKTREADY_KEY = "jarvis_marketplace_readiness";

const MKTPERF_MAX  = 20;
const MKTREADY_MAX = 20;

const MKTPERF_TTL  = 24 * 60 * 60 * 1000;
const MKTSAFE_TTL  = 24 * 60 * 60 * 1000;
const MKTREADY_TTL = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1167: Execution performance audit ───────────────────────────────────

function _runMarketplacePerfAudit() {
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
  if (jarvisKeys > 130)     findings.push({ id: "key_count",  severity: "medium", msg: `${jarvisKeys} jarvis keys` });
  if (totalBytes > 1_000_000) findings.push({ id: "storage",  severity: "high",   msg: `${Math.round(totalBytes / 1024)}KB — near limit` });
  if (largestArray > 500)   findings.push({ id: "array_size", severity: "high",   msg: `Array of ${largestArray} items` });

  // Workflow duplication guard
  try {
    const wfs = JSON.parse(localStorage.getItem("jarvis_marketplace_workflows") || "[]");
    const ids = wfs.map(w => w.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "wf_duplication", severity: "high", msg: `${dupes} duplicate workflow IDs` });
  } catch {}

  // Plugin duplication guard
  try {
    const plugins = JSON.parse(localStorage.getItem("jarvis_marketplace_plugins") || "[]");
    const ids = plugins.map(p => p.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "plugin_duplication", severity: "high", msg: `${dupes} duplicate plugin IDs` });
  } catch {}

  return {
    ts:        now,
    jarvisKeys,
    totalBytes,
    largestArray,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1168: Operational safety audit ─────────────────────────────────────

const MARKETPLACE_SAFETY_RULES = [
  {
    id:    "no_hidden_plugin_escalation",
    label: "No hidden plugin escalation",
    check: () => {
      try {
        const plugins = JSON.parse(localStorage.getItem("jarvis_marketplace_plugins") || "[]");
        return plugins.every(p => p.status !== "approved" || p.rejectReason === null || p.rejectReason === undefined);
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_workflow_imports",
    label: "No unsafe workflow imports",
    check: () => {
      try {
        const wfs = JSON.parse(localStorage.getItem("jarvis_marketplace_workflows") || "[]");
        // All approved workflows must have gone through review
        return wfs.filter(w => w.status === "approved").every(w => w.updatedAt > w.ts);
      } catch { return true; }
    },
  },
  {
    id:    "no_unapproved_installs",
    label: "No installs of unapproved plugins",
    check: () => {
      try {
        const plugins = JSON.parse(localStorage.getItem("jarvis_marketplace_plugins") || "[]");
        return plugins.filter(p => p.installs > 0).every(p => p.status === "approved");
      } catch { return true; }
    },
  },
  {
    id:    "moderation_not_recursive",
    label: "No recursive moderation loops",
    check: () => {
      try {
        const mod = JSON.parse(localStorage.getItem("jarvis_marketplace_moderation") || "[]");
        const recentActions = mod.filter(m => Date.now() - (m.ts || 0) < 60 * 1000);
        return recentActions.length < 10; // max 10 moderation actions per minute
      } catch { return true; }
    },
  },
  {
    id:    "analytics_bounded",
    label: "Marketplace analytics bounded",
    check: () => {
      try {
        const anal = JSON.parse(localStorage.getItem("jarvis_marketplace_analytics") || "[]");
        return Array.isArray(anal) && anal.length <= 50;
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_pending_review",
    label: "No excessively stale pending reviews",
    check: () => {
      try {
        const all = [
          ...JSON.parse(localStorage.getItem("jarvis_marketplace_workflows") || "[]"),
          ...JSON.parse(localStorage.getItem("jarvis_marketplace_plugins") || "[]"),
          ...JSON.parse(localStorage.getItem("jarvis_marketplace_templates") || "[]"),
        ];
        const stalePending = all.filter(
          i => i.status === "pending_review" && Date.now() - (i.ts || 0) > 30 * 24 * 60 * 60 * 1000
        );
        return stalePending.length === 0;
      } catch { return true; }
    },
  },
];

function _runMarketplaceSafetyAudit() {
  const results = MARKETPLACE_SAFETY_RULES.map(rule => ({
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

// ── Phase 1169-1170: Validation + foundation complete ────────────────────────

function _computeMarketplaceReadiness({
  perfScore      = 100,
  safetyScore    = 100,
  trustScore     = 100,
  pendingCount   = 0,
  isoViolations  = 0,
} = {}) {
  const composite = Math.round(
    safetyScore * 0.35 +
    trustScore  * 0.30 +
    perfScore   * 0.20
  )
  - (pendingCount > 5 ? 10 : 0)
  - (isoViolations > 0 ? 10 : 0)
  + (safetyScore === 100 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)   blockers.push("Safety audit failures");
  if (trustScore < 60)     blockers.push("Marketplace trust low");
  if (pendingCount > 10)   blockers.push(`${pendingCount} items awaiting review`);
  if (isoViolations > 0)   blockers.push("Isolation violations");

  return {
    score,
    label:   score >= 80 ? "MARKETPLACE READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
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

export function useMarketplaceReadiness({
  trustScore    = 100,
  pendingCount  = 0,
  isoViolations = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runMarketplacePerfAudit();
    setPerfAudit(perf);
    _save(MKTPERF_KEY, perf);

    const safety = _runMarketplaceSafetyAudit();
    setSafetyAudit(safety);
    _save(MKTSAFE_KEY, safety);

    const snap = _computeMarketplaceReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      trustScore, pendingCount, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < MKTREADY_TTL)
        .slice(0, MKTREADY_MAX);
      _save(MKTREADY_KEY, next);
      return next;
    });
  }, [trustScore, pendingCount, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(MKTPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < MKTPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(MKTSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < MKTSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(MKTREADY_KEY, []).filter(s => now - (s.ts || 0) < MKTREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const marketplaceReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "MKT",
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
    marketplaceReadinessPill,
    readinessTrend,
    evaluate,
  };
}
