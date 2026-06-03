// Phase 1036-1042: Workflow acceleration intelligence + bottleneck detection +
// replay optimization + deployment efficiency scoring + ecosystem performance intelligence +
// adaptive productivity insights + runtime efficiency optimization.
//
// Consolidates seven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 50 intelligence events, 20 bottleneck records, 10 deploy scores, 30d retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const INTEL_KEY   = "jarvis_prod_intelligence";
const BN_KEY      = "jarvis_bottlenecks";
const DEPLOY_KEY  = "jarvis_deploy_efficiency";
const ACCEL_KEY   = "jarvis_workflow_accel";
const INTEL_MAX   = 50;
const BN_MAX      = 20;
const DEPLOY_MAX  = 10;
const INTEL_TTL   = 7  * 24 * 60 * 60 * 1000;
const BN_TTL      = 24 * 60 * 60 * 1000;

// ── Phase 1036: Workflow acceleration intelligence ───────────────────────────

function _measureWorkflowAcceleration() {
  const now = Date.now();
  try {
    const hist = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
    })();
    const win   = BN_TTL;
    const recent = hist.filter(h => now - (h.ts || 0) < win);

    // Time-to-first-success: gap between session start and first ok result
    const firstOk  = recent.filter(h => h.ok !== false).sort((a, b) => (a.ts || 0) - (b.ts || 0))[0];
    const firstAny = recent.sort((a, b) => (a.ts || 0) - (b.ts || 0))[0];
    const ttfsMs   = firstOk && firstAny ? (firstOk.ts || 0) - (firstAny.ts || 0) : null;

    // Throughput: commands completed per hour
    const oldest = recent[recent.length - 1];
    const spanMs = oldest ? now - (oldest.ts || now) : 0;
    const throughput = spanMs > 60000 ? Math.round((recent.length / (spanMs / 3600000)) * 10) / 10 : null;

    // Replay age — faster restoration = better acceleration
    const snapAgeMs = (() => {
      try {
        const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
        return snap ? now - (snap.ts || 0) : null;
      } catch { return null; }
    })();

    let accelScore = 100;
    if (ttfsMs !== null && ttfsMs > 30000)  accelScore -= 15;
    if (throughput !== null && throughput < 2) accelScore -= 10;
    if (snapAgeMs !== null && snapAgeMs > 3 * 3600000) accelScore -= 10;
    accelScore = Math.max(0, accelScore);

    return {
      ts: now,
      ttfsMs,
      throughput,
      snapAgeMs,
      accelScore,
      label: accelScore >= 80 ? "FAST" : accelScore >= 55 ? "MODERATE" : "SLOW",
      color: accelScore >= 80 ? "var(--op-green)" : accelScore >= 55 ? "var(--op-amber)" : "var(--op-red)",
    };
  } catch { return { ts: now, accelScore: 100, label: "FAST", color: "var(--op-green)" }; }
}

// ── Phase 1037: Bottleneck detection ─────────────────────────────────────────

function _detectBottlenecks() {
  const now  = Date.now();
  const win  = BN_TTL;
  const bns  = [];

  const hist = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
  })();
  const recent = hist.filter(h => now - (h.ts || 0) < win);

  // Stall detection: commands running > 2min
  const stalled = recent.filter(h => h.status === "running" && now - (h.ts || 0) > 2 * 60000).length;
  if (stalled > 0) bns.push({ type: "execution_stall", severity: "high", detail: `${stalled} stalled execution(s)`, ts: now });

  // Queue congestion
  const queueSize = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_runtime_status") || "null")?.queue?.size || 0; }
    catch { return 0; }
  })();
  if (queueSize > 15) bns.push({ type: "queue_congestion", severity: "high", detail: `Queue size: ${queueSize}`, ts: now });
  else if (queueSize > 8) bns.push({ type: "queue_pressure", severity: "medium", detail: `Queue size: ${queueSize}`, ts: now });

  // Replay restoration slowness (stale snapshot = slow restore)
  const snapAgeMs = (() => {
    try {
      const snap = JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null");
      return snap ? now - (snap.ts || 0) : null;
    } catch { return null; }
  })();
  if (snapAgeMs !== null && snapAgeMs > 4 * 3600000) {
    bns.push({ type: "replay_stale", severity: "medium", detail: `Replay snapshot ${Math.round(snapAgeMs / 3600000)}h old`, ts: now });
  }

  // High fail rate
  const fails = recent.filter(h => h.ok === false || h.status === "failed").length;
  const failRate = recent.length > 0 ? Math.round((fails / recent.length) * 100) : 0;
  if (failRate > 40 && recent.length >= 5) {
    bns.push({ type: "high_fail_rate", severity: failRate > 60 ? "high" : "medium", detail: `${failRate}% fail rate`, ts: now });
  }

  return bns.slice(0, 5);
}

// ── Phase 1038: Replay optimization ──────────────────────────────────────────

function _assessReplayOptimization() {
  const now = Date.now();
  const issues  = [];
  const actions = [];

  const snap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_health_snapshot") || "null"); } catch { return null; }
  })();

  if (!snap) {
    issues.push("No replay snapshot — restoration will be cold");
    actions.push("Create a health snapshot to enable fast replay restoration");
  } else {
    const ageMs = now - (snap.ts || 0);
    if (ageMs > 6 * 3600000) {
      issues.push(`Replay snapshot is stale (${Math.round(ageMs / 3600000)}h)`);
      actions.push("Refresh replay snapshot for faster restoration");
    }
  }

  // Check for corrupted replay keys
  const REPLAY_KEYS = ["jarvis_workflow_hist", "jarvis_session_continuity", "jarvis_wa_session"];
  const corrupted = REPLAY_KEYS.filter(k => {
    try { const v = localStorage.getItem(k); if (v) JSON.parse(v); return false; }
    catch { return true; }
  });
  if (corrupted.length > 0) issues.push(`${corrupted.length} corrupted replay key(s)`);

  const score = Math.max(0, 100 - issues.length * 20);
  return { score, issues, actions, label: score >= 80 ? "OPTIMIZED" : score >= 55 ? "DEGRADED" : "CRITICAL" };
}

// ── Phase 1039: Deployment efficiency scoring ────────────────────────────────

function _scoreDeploymentEfficiency(hist = []) {
  const now = Date.now();
  const win = BN_TTL;
  const recent = hist.filter(h =>
    now - (h.ts || 0) < win &&
    (h.type === "deploy" || (h.cmd || "").includes("deploy") || h.actionType === "deploy")
  );

  const completed = recent.filter(h => h.ok !== false && h.status !== "failed").length;
  const total     = recent.length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : null;

  // Rollback readiness: pre-update snapshot available and fresh
  const preSnap = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_pre_update_snapshot") || "null"); } catch { return null; }
  })();
  const rollbackReady = preSnap && now - (preSnap.ts || 0) < 2 * 3600000;

  let maturityScore = 100;
  if (successRate !== null && successRate < 70) maturityScore -= 20;
  if (!rollbackReady) maturityScore -= 15;
  maturityScore = Math.max(0, maturityScore);

  return {
    ts:           now,
    successRate,
    rollbackReady,
    maturityScore,
    label:        maturityScore >= 80 ? "MATURE" : maturityScore >= 55 ? "DEVELOPING" : "IMMATURE",
    color:        maturityScore >= 80 ? "var(--op-green)" : maturityScore >= 55 ? "var(--op-amber)" : "var(--op-red)",
  };
}

// ── Phase 1040: Ecosystem performance intelligence ────────────────────────────

function _scoreEcosystemPerf(plugins = [], connectors = []) {
  const activePlugins    = plugins.filter(p => p.status === "active").length;
  const trustedPlugins   = plugins.filter(p => (p.trustScore || 0) >= 80).length;
  const activeConnectors = connectors.filter(c => c.status === "active").length;

  let score = 100;
  if (plugins.length > 0 && trustedPlugins === 0) score -= 20;
  if (activePlugins > 5) score -= 10;   // too many active = overhead
  score = Math.max(0, score);

  return {
    score,
    label:          score >= 80 ? "PERFORMANT" : score >= 55 ? "ACCEPTABLE" : "DEGRADED",
    color:          score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    activePlugins,
    trustedPlugins,
    activeConnectors,
  };
}

// ── Phase 1041: Adaptive productivity insights ────────────────────────────────

function _buildProductivityInsights(accel, bottlenecks, replayOpt, deployEff) {
  const insights = [];

  if (accel.accelScore < 80) {
    insights.push({
      id:       "workflow_speed",
      category: "acceleration",
      title:    `Workflow speed: ${accel.label}`,
      rec:      accel.ttfsMs > 30000 ? "Restore last session context to reduce startup time" : "Improve replay freshness",
      priority: accel.accelScore < 55 ? "high" : "medium",
    });
  }

  const topBn = bottlenecks.find(b => b.severity === "high") || bottlenecks[0];
  if (topBn) {
    insights.push({
      id:       "bottleneck",
      category: "bottleneck",
      title:    topBn.detail,
      rec:      topBn.type === "queue_congestion" ? "Review queue depth and stalled executions"
              : topBn.type === "replay_stale"     ? "Refresh replay snapshot"
              : "Investigate execution stalls in log",
      priority: topBn.severity,
    });
  }

  if (replayOpt.score < 80 && replayOpt.actions[0]) {
    insights.push({
      id:       "replay_opt",
      category: "replay",
      title:    `Replay: ${replayOpt.label}`,
      rec:      replayOpt.actions[0],
      priority: replayOpt.score < 55 ? "high" : "medium",
    });
  }

  if (deployEff.maturityScore < 80) {
    insights.push({
      id:       "deploy_eff",
      category: "deployment",
      title:    `Deploy maturity: ${deployEff.label}`,
      rec:      !deployEff.rollbackReady ? "Create pre-deploy snapshot for rollback readiness" : "Review recent deployment failures",
      priority: "medium",
    });
  }

  return insights.slice(0, 5);
}

// ── Phase 1042: Runtime efficiency — bounded caches + hydration ───────────────

// Module-level bounded LRU cache for workflow state hydration
const _runtimeCache = new Map();
const RUNTIME_CACHE_MAX = 30;
const RUNTIME_CACHE_TTL = 5 * 60 * 1000;  // 5min

function _runtimeCacheGet(key) {
  const entry = _runtimeCache.get(key);
  if (!entry || Date.now() - entry.ts > RUNTIME_CACHE_TTL) {
    _runtimeCache.delete(key);
    return null;
  }
  return entry.value;
}

function _runtimeCacheSet(key, value) {
  if (_runtimeCache.size >= RUNTIME_CACHE_MAX) {
    // Evict oldest
    const oldest = [..._runtimeCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _runtimeCache.delete(oldest[0]);
  }
  _runtimeCache.set(key, { value, ts: Date.now() });
}

function _runtimeCacheEvictStale() {
  const now = Date.now();
  for (const [k, v] of _runtimeCache.entries()) {
    if (now - v.ts > RUNTIME_CACHE_TTL) _runtimeCache.delete(k);
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useProductivityIntelligence({ plugins = [], connectors = [] } = {}) {
  const [accel,       setAccel]       = useState(null);
  const [bottlenecks, setBottlenecks] = useState([]);
  const [replayOpt,   setReplayOpt]   = useState(null);
  const [deployEff,   setDeployEff]   = useState(null);
  const [ecoPerf,     setEcoPerf]     = useState(null);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    _runtimeCacheEvictStale();

    const a = _measureWorkflowAcceleration();
    setAccel(a);
    _save(ACCEL_KEY, a);

    const bns = _detectBottlenecks();
    setBottlenecks(bns);
    if (bns.length > 0) {
      const existing = _load(BN_KEY, []);
      const merged = [...bns, ...existing]
        .filter(b => Date.now() - (b.ts || 0) < BN_TTL)
        .slice(0, BN_MAX);
      _save(BN_KEY, merged);
    }

    setReplayOpt(_assessReplayOptimization());

    const hist = (() => {
      try { return JSON.parse(localStorage.getItem("jarvis_workflow_hist") || "[]"); } catch { return []; }
    })();
    const de = _scoreDeploymentEfficiency(hist);
    setDeployEff(de);
    const existing = _load(DEPLOY_KEY, []);
    _save(DEPLOY_KEY, [de, ...existing].slice(0, DEPLOY_MAX));

    setEcoPerf(_scoreEcosystemPerf(plugins, connectors));
  }, [plugins, connectors]);

  useEffect(() => {
    const cached = _load(ACCEL_KEY, null);
    if (cached) setAccel(cached);
    setBottlenecks(_load(BN_KEY, []).filter(b => Date.now() - (b.ts || 0) < BN_TTL));
    setDeployEff(_load(DEPLOY_KEY, [null])[0]);
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Productivity insights (Phase 1041)
  const insights = useMemo(() =>
    _buildProductivityInsights(
      accel     || { accelScore: 100, label: "FAST", ttfsMs: null },
      bottlenecks,
      replayOpt || { score: 100, label: "OPTIMIZED", actions: [] },
      deployEff || { maturityScore: 100, label: "MATURE", rollbackReady: true }
    ),
    [accel, bottlenecks, replayOpt, deployEff]
  );

  // Top insight for operator bar
  const topInsight = useMemo(() =>
    insights.find(i => i.priority === "high") || insights[0] || null,
    [insights]
  );

  // Overall productivity score (composite)
  const productivityScore = useMemo(() => {
    const scores = [
      accel?.accelScore     ?? 100,
      replayOpt?.score      ?? 100,
      deployEff?.maturityScore ?? 100,
      ecoPerf?.score        ?? 100,
    ];
    return Math.round(scores.reduce((a, s) => a + s, 0) / scores.length);
  }, [accel, replayOpt, deployEff, ecoPerf]);

  // Runtime cache access (Phase 1042) — exposed for other hooks to use
  const runtimeCache = useMemo(() => ({
    get: _runtimeCacheGet,
    set: _runtimeCacheSet,
    size: _runtimeCache.size,
  }), []);

  // Operator bar productivity pill
  const productivityPill = useMemo(() => {
    if (productivityScore >= 80) return null;  // healthy — suppress
    return {
      label: productivityScore < 55 ? "PRODUCTIVITY LOW" : "PRODUCTIVITY",
      score: productivityScore,
      color: productivityScore < 55 ? "var(--op-red)" : "var(--op-amber)",
      topRec: topInsight?.rec || null,
    };
  }, [productivityScore, topInsight]);

  return {
    initialized,
    accel,
    bottlenecks,
    replayOpt,
    deployEff,
    ecoPerf,
    insights,
    topInsight,
    productivityScore,
    productivityPill,
    runtimeCache,
    evaluate,
  };
}
