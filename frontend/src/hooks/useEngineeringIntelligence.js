// Phase 1171-1180: Repository intelligence + debugging pattern intelligence +
// deployment-risk prediction + workflow optimization + contextual engineering memory +
// operational anomaly detection + productivity intelligence + multi-workspace isolation +
// performance hardening + stress validation.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only. Privacy-safe: counts/patterns/scores only — no raw content.
// Bounded: 30 repo snapshots, 20 debug patterns, 15 risk predictions, 20 memory entries,
//          30 anomalies, 30 productivity samples, 15 isolation events.

import { useState, useEffect, useCallback, useMemo } from "react";

const REPO_KEY    = "jarvis_repo_intelligence";
const DBG_KEY     = "jarvis_debug_patterns";
const RISK_KEY    = "jarvis_deploy_risk";
const MEM_KEY     = "jarvis_eng_memory";
const ANOM_KEY    = "jarvis_op_anomalies";
const PROD_KEY    = "jarvis_eng_productivity";
const EISO_KEY    = "jarvis_eng_intel_isolation";

const REPO_MAX    = 30;
const DBG_MAX     = 20;
const RISK_MAX    = 15;
const MEM_MAX     = 20;
const ANOM_MAX    = 30;
const PROD_MAX    = 30;
const EISO_MAX    = 15;

const REPO_TTL    = 7  * 24 * 60 * 60 * 1000;
const DBG_TTL     = 30 * 24 * 60 * 60 * 1000;
const RISK_TTL    = 24 * 60 * 60 * 1000;
const MEM_TTL     = 30 * 24 * 60 * 60 * 1000;
const ANOM_TTL    = 7  * 24 * 60 * 60 * 1000;
const PROD_TTL    = 30 * 24 * 60 * 60 * 1000;
const EISO_TTL    = 24 * 60 * 60 * 1000;

// ── Phase 1171: Repository intelligence foundation ───────────────────────────

const REPO_RISK_FACTORS = [
  { id: "high_fail_rate",    weight: 30, label: "Elevated failure rate"       },
  { id: "stale_replay",      weight: 20, label: "Stale replay snapshot"        },
  { id: "queue_saturation",  weight: 20, label: "Queue near capacity"          },
  { id: "deploy_conflicts",  weight: 15, label: "Concurrent deployment risks"  },
  { id: "plugin_instability",weight: 15, label: "Plugin health degraded"       },
];

function _buildRepoSnapshot({ failRate = 0, replayAgeMs = null, queueDepth = 0, activeDeployments = 0, pluginTrustScore = 100 } = {}) {
  const factors = [];
  let riskScore = 0;

  if (failRate > 20) {
    const f = REPO_RISK_FACTORS.find(r => r.id === "high_fail_rate");
    factors.push({ ...f, value: failRate });
    riskScore += f.weight * Math.min(1, failRate / 50);
  }
  if (replayAgeMs !== null && replayAgeMs > 30 * 60 * 1000) {
    const f = REPO_RISK_FACTORS.find(r => r.id === "stale_replay");
    factors.push({ ...f, value: Math.round(replayAgeMs / 60000) });
    riskScore += f.weight;
  }
  if (queueDepth > 15) {
    const f = REPO_RISK_FACTORS.find(r => r.id === "queue_saturation");
    factors.push({ ...f, value: queueDepth });
    riskScore += f.weight * Math.min(1, queueDepth / 25);
  }
  if (activeDeployments > 2) {
    const f = REPO_RISK_FACTORS.find(r => r.id === "deploy_conflicts");
    factors.push({ ...f, value: activeDeployments });
    riskScore += f.weight;
  }
  if (pluginTrustScore < 70) {
    const f = REPO_RISK_FACTORS.find(r => r.id === "plugin_instability");
    factors.push({ ...f, value: pluginTrustScore });
    riskScore += f.weight * (1 - pluginTrustScore / 100);
  }

  riskScore = Math.min(100, Math.round(riskScore));
  const health = 100 - riskScore;

  return {
    id:          `repo_${Date.now()}`,
    ts:          Date.now(),
    riskScore,
    health,
    healthLabel: health >= 80 ? "HEALTHY" : health >= 55 ? "MODERATE RISK" : "HIGH RISK",
    healthColor: health >= 80 ? "var(--op-green)" : health >= 55 ? "var(--op-amber)" : "var(--op-red)",
    topFactor:   factors[0] || null,
    factorCount: factors.length,
  };
}

// ── Phase 1172: Debugging pattern intelligence ────────────────────────────────

const DEBUG_PATTERN_TYPES = new Set([
  "replay_heavy", "reconnect_storm", "queue_congestion",
  "deploy_interrupt", "plugin_crash", "trust_erosion",
]);

function _buildDebugPattern({ type, occurrences = 1, lastSeenMs = 0 }) {
  if (!DEBUG_PATTERN_TYPES.has(type)) return null;
  const velocity = occurrences > 1 ? Math.round(occurrences / Math.max(1, lastSeenMs / (60 * 60 * 1000))) : 1;
  return {
    id:          `dbgp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    occurrences,
    velocity,    // occurrences per hour
    severity:    occurrences >= 5 ? "high" : occurrences >= 2 ? "medium" : "low",
    ts:          Date.now(),
    updatedAt:   Date.now(),
  };
}

function _upsertPattern(patterns, type, increment = 1) {
  const existing = patterns.find(p => p.type === type);
  if (existing) {
    const newCount = existing.occurrences + increment;
    const lastSeenMs = Date.now() - existing.ts;
    return patterns.map(p => p.type === type
      ? { ...p, occurrences: newCount, severity: newCount >= 5 ? "high" : newCount >= 2 ? "medium" : "low",
          velocity: Math.round(newCount / Math.max(1, lastSeenMs / (60 * 60 * 1000))), updatedAt: Date.now() }
      : p
    );
  }
  const newPattern = _buildDebugPattern({ type, occurrences: 1, lastSeenMs: 0 });
  return newPattern ? [newPattern, ...patterns].slice(0, DBG_MAX) : patterns;
}

// ── Phase 1173: Deployment-risk prediction ────────────────────────────────────

function _predictDeploymentRisk({ repoHealth, queueDepth, activeDeployments, failRate, replayAgeMs } = {}) {
  let riskLevel = "low";
  const reasons = [];

  if (repoHealth < 55) {
    riskLevel = "high";
    reasons.push("Repository health critical");
  } else if (repoHealth < 80) {
    riskLevel = "medium";
    reasons.push("Repository health degraded");
  }
  if (activeDeployments >= 3) {
    riskLevel = riskLevel === "high" ? "high" : "medium";
    reasons.push(`${activeDeployments} concurrent deployments`);
  }
  if (failRate > 30) {
    riskLevel = "high";
    reasons.push(`${failRate}% failure rate`);
  }
  if (replayAgeMs !== null && replayAgeMs > 30 * 60 * 1000) {
    reasons.push("Stale replay — restore before deploy");
  }

  return {
    id:         `risk_${Date.now()}`,
    ts:         Date.now(),
    riskLevel,
    color:      riskLevel === "high" ? "var(--op-red)" : riskLevel === "medium" ? "var(--op-amber)" : "var(--op-green)",
    reasons:    reasons.slice(0, 3),
    rollbackReady: replayAgeMs !== null && replayAgeMs < 10 * 60 * 1000,
    recommendation: riskLevel === "high"
      ? "Resolve stability issues before proceeding"
      : riskLevel === "medium"
      ? "Review risk factors before deploying"
      : "Conditions favorable for deployment",
  };
}

// ── Phase 1174: Workflow optimization intelligence ────────────────────────────

function _buildWorkflowOptimization({ debugPatterns = [], queueDepth = 0, repoHealth = 100 } = {}) {
  const recs = [];

  const highPatterns = debugPatterns.filter(p => p.severity === "high");
  if (highPatterns.length > 0) {
    recs.push({ area: "Debug",   rec: `Address recurring ${highPatterns[0].type} pattern (${highPatterns[0].occurrences}x)` });
  }
  if (queueDepth > 10) {
    recs.push({ area: "Queue",   rec: `Reduce queue depth (${queueDepth}) — batch non-critical tasks` });
  }
  if (repoHealth < 70) {
    recs.push({ area: "Repo",    rec: "Stabilize repo health before expanding workflow scope" });
  }
  if (recs.length === 0) {
    recs.push({ area: "General", rec: "System optimal — good time for high-impact deployments" });
  }

  return recs.slice(0, 3);
}

// ── Phase 1175: Contextual engineering memory — privacy-safe ─────────────────

const MEMORY_TYPES = new Set([
  "debug_session", "deploy_outcome", "replay_restore",
  "anomaly_resolved", "workflow_optimized", "pattern_cleared",
]);

function _buildMemoryEntry({ type, outcome = "unknown", durationMin = null }) {
  if (!MEMORY_TYPES.has(type)) return null;
  return {
    id:         `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    outcome,    // "success" | "failure" | "partial" | "unknown"
    durationMin: durationMin !== null ? Math.round(durationMin) : null,
    ts:          Date.now(),
  };
}

// ── Phase 1176: Operational anomaly detection ─────────────────────────────────

const ANOMALY_DETECTORS = [
  {
    id:    "replay_failure_spike",
    label: "Replay failure spike",
    detect: (patterns) => {
      const p = patterns.find(p => p.type === "replay_heavy");
      return p && p.velocity > 3 ? { severity: "high", value: p.velocity } : null;
    },
  },
  {
    id:    "deploy_instability",
    label: "Deployment instability spike",
    detect: (patterns) => {
      const p = patterns.find(p => p.type === "deploy_interrupt");
      return p && p.occurrences >= 3 ? { severity: "medium", value: p.occurrences } : null;
    },
  },
  {
    id:    "queue_saturation_trend",
    label: "Queue saturation trend",
    detect: (patterns, ctx) => {
      return ctx.queueDepth > 20 ? { severity: "medium", value: ctx.queueDepth } : null;
    },
  },
  {
    id:    "trust_erosion",
    label: "Operational trust erosion",
    detect: (patterns, ctx) => {
      return ctx.trustScore < 60 ? { severity: "high", value: ctx.trustScore } : null;
    },
  },
  {
    id:    "plugin_instability",
    label: "Plugin instability trend",
    detect: (patterns) => {
      const p = patterns.find(p => p.type === "plugin_crash");
      return p && p.severity !== "low" ? { severity: p.severity, value: p.occurrences } : null;
    },
  },
];

function _detectAnomalies(patterns, ctx = {}) {
  return ANOMALY_DETECTORS
    .map(d => {
      const result = d.detect(patterns, ctx);
      if (!result) return null;
      return { id: d.id, label: d.label, ...result, ts: Date.now() };
    })
    .filter(Boolean)
    .slice(0, 5);
}

// ── Phase 1177: Productivity intelligence ─────────────────────────────────────

function _computeProductivityScore({ debugPatterns = [], memoryEntries = [], anomalies = [], repoHealth = 100 } = {}) {
  let score = repoHealth;

  // Deduct for high-severity patterns
  const highPatterns = debugPatterns.filter(p => p.severity === "high").length;
  score -= highPatterns * 10;

  // Deduct for unresolved anomalies
  const unresolvedAnomalies = anomalies.filter(a => a.severity === "high").length;
  score -= unresolvedAnomalies * 15;

  // Bonus for recent successful outcomes
  const recentSuccess = memoryEntries.filter(
    m => m.outcome === "success" && Date.now() - m.ts < 24 * 60 * 60 * 1000
  ).length;
  score += Math.min(10, recentSuccess * 2);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Phase 1178: Multi-workspace intelligence isolation ────────────────────────

const INTEL_ISOLATED_PREFIXES = [
  "jarvis_repo_intelligence_",
  "jarvis_debug_patterns_",
  "jarvis_eng_memory_",
  "jarvis_eng_productivity_",
];

function _scanIntelIsolation(activeWsId) {
  if (!activeWsId) return [];
  const violations = [];
  try {
    for (let i = 0; i < Math.min(localStorage.length, 100); i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (INTEL_ISOLATED_PREFIXES.some(p => key.startsWith(p)) && !key.endsWith(activeWsId)) {
        violations.push({ key, reason: "Cross-workspace intelligence state bleed" });
      }
    }
  } catch {}
  return violations.slice(0, 5);
}

// ── Phase 1179: Performance hardening — bounded intelligence cache ────────────

const _intelCache = new Map();
const INTEL_CACHE_TTL = 30 * 1000; // 30s

function _cachedIntel(key, compute) {
  const cached = _intelCache.get(key);
  if (cached && Date.now() - cached.ts < INTEL_CACHE_TTL) return cached.val;
  const val = compute();
  if (_intelCache.size > 20) {
    const oldest = [..._intelCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _intelCache.delete(oldest[0]);
  }
  _intelCache.set(key, { val, ts: Date.now() });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEngineeringIntelligence({
  failRate          = 0,
  replayAgeMs       = null,
  queueDepth        = 0,
  activeDeployments = 0,
  pluginTrustScore  = 100,
  trustScore        = 100,
} = {}) {
  const [repoSnapshots,   setRepoSnapshots]   = useState([]);
  const [debugPatterns,   setDebugPatterns]   = useState([]);
  const [riskPredictions, setRiskPredictions] = useState([]);
  const [memoryEntries,   setMemoryEntries]   = useState([]);
  const [anomalies,       setAnomalies]       = useState([]);
  const [prodSamples,     setProdSamples]     = useState([]);
  const [isoEvents,       setIsoEvents]       = useState([]);
  const [initialized,     setInitialized]     = useState(false);

  const activeWsId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    const now = Date.now();

    // TTL-filter all arrays
    setRepoSnapshots(prev => { const next = prev.filter(s => now - (s.ts || 0) < REPO_TTL).slice(0, REPO_MAX); _save(REPO_KEY,  next); return next; });
    setDebugPatterns(prev => { const next = prev.filter(p => now - (p.ts || 0) < DBG_TTL).slice(0, DBG_MAX);   _save(DBG_KEY,   next); return next; });
    setRiskPredictions(prev => { const next = prev.filter(r => now - (r.ts || 0) < RISK_TTL).slice(0, RISK_MAX); _save(RISK_KEY, next); return next; });
    setMemoryEntries(prev => { const next = prev.filter(m => now - (m.ts || 0) < MEM_TTL).slice(0, MEM_MAX);   _save(MEM_KEY,   next); return next; });
    setAnomalies(prev => { const next = prev.filter(a => now - (a.ts || 0) < ANOM_TTL).slice(0, ANOM_MAX);     _save(ANOM_KEY,  next); return next; });
    setProdSamples(prev => { const next = prev.filter(s => now - (s.ts || 0) < PROD_TTL).slice(0, PROD_MAX);   _save(PROD_KEY,  next); return next; });

    // Repo snapshot
    const snap = _buildRepoSnapshot({ failRate, replayAgeMs, queueDepth, activeDeployments, pluginTrustScore });
    setRepoSnapshots(prev => {
      const next = [snap, ...prev.filter(s => now - (s.ts || 0) < REPO_TTL)].slice(0, REPO_MAX);
      _save(REPO_KEY, next);
      return next;
    });

    // Anomaly detection (runs against current patterns)
    setDebugPatterns(patterns => {
      const detected = _detectAnomalies(patterns, { queueDepth, trustScore });
      if (detected.length > 0) {
        setAnomalies(prev => {
          // Deduplicate by id within last hour
          const recentIds = new Set(prev.filter(a => now - (a.ts || 0) < 60 * 60 * 1000).map(a => a.id));
          const fresh = detected.filter(a => !recentIds.has(a.id));
          if (fresh.length === 0) return prev;
          const next = [...fresh, ...prev].filter(a => now - (a.ts || 0) < ANOM_TTL).slice(0, ANOM_MAX);
          _save(ANOM_KEY, next);
          return next;
        });
      }
      return patterns;
    });

    // Isolation scan
    const violations = _scanIntelIsolation(activeWsId);
    if (violations.length > 0) {
      setIsoEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: now }));
        const next = [...entries, ...prev].filter(e => now - (e.ts || 0) < EISO_TTL).slice(0, EISO_MAX);
        _save(EISO_KEY, next);
        return next;
      });
    }
  }, [failRate, replayAgeMs, queueDepth, activeDeployments, pluginTrustScore, trustScore, activeWsId]);

  useEffect(() => {
    const now = Date.now();
    setRepoSnapshots( _load(REPO_KEY,  []).filter(s => now - (s.ts || 0) < REPO_TTL));
    setDebugPatterns( _load(DBG_KEY,   []).filter(p => now - (p.ts || 0) < DBG_TTL));
    setRiskPredictions(_load(RISK_KEY, []).filter(r => now - (r.ts || 0) < RISK_TTL));
    setMemoryEntries( _load(MEM_KEY,   []).filter(m => now - (m.ts || 0) < MEM_TTL));
    setAnomalies(     _load(ANOM_KEY,  []).filter(a => now - (a.ts || 0) < ANOM_TTL));
    setProdSamples(   _load(PROD_KEY,  []).filter(s => now - (s.ts || 0) < PROD_TTL));
    setIsoEvents(     _load(EISO_KEY,  []).filter(e => now - (e.ts || 0) < EISO_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const recordDebugPattern = useCallback((type) => {
    setDebugPatterns(prev => {
      const next = _upsertPattern(prev, type);
      _save(DBG_KEY, next);
      return next;
    });
  }, []);

  const recordMemory = useCallback(({ type, outcome, durationMin } = {}) => {
    const entry = _buildMemoryEntry({ type, outcome, durationMin });
    if (!entry) return;
    setMemoryEntries(prev => {
      const next = [entry, ...prev].filter(m => Date.now() - (m.ts || 0) < MEM_TTL).slice(0, MEM_MAX);
      _save(MEM_KEY, next);
      return next;
    });
    // Record productivity sample
    setDebugPatterns(patterns => {
      const prodScore = _computeProductivityScore({ debugPatterns: patterns, memoryEntries: [entry], anomalies, repoHealth: repoSnapshots[0]?.health ?? 100 });
      const sample = { ts: Date.now(), score: prodScore };
      setProdSamples(prev => {
        const next = [sample, ...prev].filter(s => Date.now() - (s.ts || 0) < PROD_TTL).slice(0, PROD_MAX);
        _save(PROD_KEY, next);
        return next;
      });
      return patterns;
    });
  }, [anomalies, repoSnapshots]);

  const predictDeployRisk = useCallback(() => {
    const latest = repoSnapshots[0];
    const prediction = _predictDeploymentRisk({
      repoHealth:        latest?.health ?? 100,
      queueDepth,
      activeDeployments,
      failRate,
      replayAgeMs,
    });
    setRiskPredictions(prev => {
      const next = [prediction, ...prev].filter(r => Date.now() - (r.ts || 0) < RISK_TTL).slice(0, RISK_MAX);
      _save(RISK_KEY, next);
      return next;
    });
    return prediction;
  }, [repoSnapshots, queueDepth, activeDeployments, failRate, replayAgeMs]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const latestRepo = useMemo(() => repoSnapshots[0] || null, [repoSnapshots]);
  const latestRisk = useMemo(() => riskPredictions[0] || null, [riskPredictions]);

  // Coarse dep-key for optimization recs
  const _patternBucket = Math.floor(debugPatterns.filter(p => p.severity === "high").length / 2);
  const workflowOptimizations = useMemo(() =>
    _buildWorkflowOptimization({ debugPatterns, queueDepth, repoHealth: latestRepo?.health ?? 100 }),
    [_patternBucket, queueDepth, latestRepo?.health] // eslint-disable-line
  );

  const activeAnomalies = useMemo(() =>
    anomalies.filter(a => Date.now() - (a.ts || 0) < 60 * 60 * 1000),
    [anomalies]
  );

  const topAnomaly = useMemo(() =>
    activeAnomalies.find(a => a.severity === "high") || activeAnomalies[0] || null,
    [activeAnomalies]
  );

  const productivityScore = useMemo(() =>
    _cachedIntel(`prod_${_patternBucket}_${activeAnomalies.length}`,
      () => _computeProductivityScore({
        debugPatterns, memoryEntries, anomalies: activeAnomalies, repoHealth: latestRepo?.health ?? 100,
      })
    ),
    [_patternBucket, activeAnomalies.length, memoryEntries.length, latestRepo?.health] // eslint-disable-line
  );

  const recentIsoViolations = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return isoEvents.filter(e => (e.ts || 0) > cutoff).length;
  }, [isoEvents]);

  // Calm intelligence bar — Phase 1181: show only when insight is actionable
  const intelligenceBar = useMemo(() => {
    const hasAnomaly    = topAnomaly !== null;
    const hasHighRisk   = latestRisk?.riskLevel === "high";
    const hasLowProd    = productivityScore < 60;
    const hasIso        = recentIsoViolations > 0;
    if (!hasAnomaly && !hasHighRisk && !hasLowProd && !hasIso) return null;

    const topRec = workflowOptimizations[0];
    return {
      anomaly:    topAnomaly?.label || null,
      anomalyColor: topAnomaly?.severity === "high" ? "var(--op-red)" : "var(--op-amber)",
      riskLevel:  latestRisk?.riskLevel || null,
      riskColor:  latestRisk?.color || "var(--op-text2)",
      rec:        !hasAnomaly && !hasHighRisk ? topRec?.rec : null,
      productivity: productivityScore,
      isoViolations: recentIsoViolations > 0 ? recentIsoViolations : null,
    };
  }, [topAnomaly, latestRisk, productivityScore, workflowOptimizations, recentIsoViolations]);

  return {
    initialized,
    repoSnapshots,
    debugPatterns,
    riskPredictions,
    memoryEntries,
    anomalies,
    prodSamples,
    isoEvents,
    // Derived
    latestRepo,
    latestRisk,
    workflowOptimizations,
    activeAnomalies,
    topAnomaly,
    productivityScore,
    intelligenceBar,
    // Actions
    recordDebugPattern,
    recordMemory,
    predictDeployRisk,
    evaluate,
  };
}
