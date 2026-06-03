// Phase 1381-1391: Global platform operations + infrastructure maturity.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const REGION_DEPLOY_KEY  = "jarvis_regional_deployments";
const REGION_SURV_KEY    = "jarvis_regional_survivability";
const REDUNDANCY_KEY     = "jarvis_infra_redundancy";
const LATENCY_KEY        = "jarvis_latency_intelligence";
const CONTINUITY_KEY     = "jarvis_global_continuity";
const FORECAST_KEY       = "jarvis_global_reliability_forecast";
const INFRA_ANALYTICS_KEY = "jarvis_infra_analytics";
const REGION_ISO_KEY     = "jarvis_region_iso_state";
const GLOBAL_PERF_KEY    = "jarvis_global_perf";

const REGION_DEPLOY_MAX  = 20;
const REGION_SURV_MAX    = 30;
const REDUNDANCY_MAX     = 15;
const LATENCY_MAX        = 30;
const CONTINUITY_MAX     = 20;
const FORECAST_MAX       = 10;
const INFRA_ANALYTICS_MAX = 30;
const REGION_ISO_MAX     = 20;
const GLOBAL_PERF_MAX    = 20;

const REGION_DEPLOY_TTL  = 7  * 24 * 60 * 60 * 1000;
const REGION_SURV_TTL    = 24 * 60 * 60 * 1000;
const REDUNDANCY_TTL     = 7  * 24 * 60 * 60 * 1000;
const LATENCY_TTL        = 24 * 60 * 60 * 1000;
const CONTINUITY_TTL     = 7  * 24 * 60 * 60 * 1000;
const FORECAST_TTL       = 24 * 60 * 60 * 1000;
const INFRA_ANALYTICS_TTL = 7  * 24 * 60 * 60 * 1000;
const REGION_ISO_TTL     = 24 * 60 * 60 * 1000;
const GLOBAL_PERF_TTL    = 24 * 60 * 60 * 1000;

const VALID_REGIONS          = ["us-east", "us-west", "eu-west", "eu-central", "ap-southeast", "ap-northeast"];
const VALID_DEPLOY_STAGES    = ["queued", "validating", "deploying", "verifying", "complete", "rolled_back"];
const VALID_SURV_TYPES       = ["runtime_interruption", "replay_failure", "deploy_degradation", "queue_spike", "infra_fault"];
const VALID_REDUNDANCY_STAGES = ["provisioning", "standby", "active", "failover", "failed"];
const VALID_LATENCY_DIMS     = ["p50", "p95", "p99", "error_rate", "queue_depth"];
const VALID_ANALYTICS_DIMS   = ["outage_frequency", "deploy_responsiveness", "replay_flows", "infra_survivability", "workload_patterns"];

// ── LRU cache ─────────────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 50;
function _cached(key, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL) return hit.val;
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  const val = fn();
  _cache.set(key, { val, ts: now });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Phase 1381: Regional deployment scoring ───────────────────────────────────
function _scoreRegionalDeployments(deploys) {
  if (!deploys.length) return 100;
  const complete   = deploys.filter(d => d.stage === "complete").length;
  const rolledBack = deploys.filter(d => d.stage === "rolled_back").length;
  const unapproved = deploys.filter(d =>
    ["deploying", "verifying", "complete"].includes(d.stage) && !d.approvedAt
  ).length;
  return Math.max(0, Math.round(
    (complete / deploys.length) * 80
    - rolledBack * 8
    - unapproved * 20
  ));
}

// ── Phase 1382: Regional survivability scoring ────────────────────────────────
function _scoreRegionalSurvivability(events) {
  if (!events.length) return 100;
  const now      = Date.now();
  const recent   = events.filter(e => now - (e.ts || 0) < 60 * 60 * 1000);
  const faults   = recent.filter(e => ["runtime_interruption", "infra_fault"].includes(e.type)).length;
  const recovered = recent.filter(e => e.recovered === true).length;
  if (!recent.length) return 100;
  return Math.max(0, Math.round(
    100 - faults * 10
    + (recovered / Math.max(recent.length, 1)) * 20
  ));
}

// ── Phase 1383: Redundancy coordination scoring ───────────────────────────────
function _scoreRedundancy(nodes) {
  if (!nodes.length) return 100;
  const active   = nodes.filter(n => n.stage === "active" || n.stage === "standby").length;
  const failed   = nodes.filter(n => n.stage === "failed").length;
  const failover = nodes.filter(n => n.stage === "failover").length;
  return Math.max(0, Math.round(
    (active / nodes.length) * 80
    - failed * 15
    - failover * 5
  ));
}

// ── Phase 1384: Latency intelligence scoring ──────────────────────────────────
function _computeLatencyScore(events) {
  if (!events.length) return { score: 100, byDim: {} };
  const byDim = {};
  for (const dim of VALID_LATENCY_DIMS) {
    const dimEvents = events.filter(e => e.dim === dim);
    byDim[dim] = dimEvents.length
      ? Math.round(dimEvents.reduce((a, e) => a + (e.score ?? 80), 0) / dimEvents.length)
      : null;
  }
  const filled = Object.values(byDim).filter(v => v !== null);
  const score  = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return { score, byDim };
}

// ── Phase 1385: Global continuity snapshot ────────────────────────────────────
function _computeGlobalContinuity({
  deployScore    = 100,
  survScore      = 100,
  redundancyScore = 100,
  latencyScore   = 100,
  isoViolations  = 0,
} = {}) {
  const composite = Math.round(
    survScore       * 0.30 +
    redundancyScore * 0.25 +
    deployScore     * 0.25 +
    latencyScore    * 0.20
  ) - (isoViolations > 0 ? 15 : 0);
  const score = Math.max(0, Math.min(100, composite));
  return {
    score,
    label: score >= 80 ? "GLOBALLY_CONTINUOUS" : score >= 60 ? "DEGRADED" : "DISRUPTED",
    ts:    Date.now(),
  };
}

// ── Phase 1386: Global reliability forecasting ────────────────────────────────
function _computeGlobalForecast(continuitySnaps) {
  if (continuitySnaps.length < 3) return null;
  const recent = continuitySnaps.slice(0, 5);
  const deltas = [];
  for (let i = 0; i < recent.length - 1; i++) {
    deltas.push(recent[i].score - recent[i + 1].score);
  }
  const avgDelta = deltas.reduce((a, d) => a + d, 0) / deltas.length;
  const projected = Math.max(0, Math.min(100, Math.round(recent[0].score + avgDelta)));
  const trend     = avgDelta > 1 ? "improving" : avgDelta < -1 ? "degrading" : "stable";
  const riskLevel = recent[0].score < 60 ? "high" : trend === "degrading" ? "medium" : "low";
  return { trend, projected, riskLevel, ts: Date.now() };
}

// ── Phase 1387: Infra analytics aggregation (privacy-safe) ────────────────────
function _aggregateInfraAnalytics(events) {
  const byDim = {};
  for (const dim of VALID_ANALYTICS_DIMS) {
    const dimEvents = events.filter(e => e.dim === dim);
    byDim[dim] = dimEvents.length
      ? Math.round(dimEvents.reduce((a, e) => a + (e.score ?? 80), 0) / dimEvents.length)
      : null;
  }
  const filled    = Object.values(byDim).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return { byDim, composite };
}

// ── Phase 1388: Multi-region isolation check ──────────────────────────────────
function _checkRegionIsolation(deploys, survEvents) {
  const violations = [];

  // Cross-region contamination: deploy references invalid region
  for (const d of deploys) {
    if (d.region && !VALID_REGIONS.includes(d.region)) {
      violations.push({ type: "invalid_region_deploy", deployId: d.id, region: d.region, ts: Date.now() });
    }
  }

  // Replay crossover: same deploy ID active in multiple regions
  const deployRegions = {};
  for (const d of deploys.filter(d => !["complete", "rolled_back"].includes(d.stage))) {
    if (d.id && d.region) {
      if (!deployRegions[d.id]) deployRegions[d.id] = new Set();
      deployRegions[d.id].add(d.region);
    }
  }
  for (const [deployId, regions] of Object.entries(deployRegions)) {
    if (regions.size > 1) {
      violations.push({ type: "cross_region_deploy_bleed", deployId, regionCount: regions.size, ts: Date.now() });
    }
  }

  // Regional survivability event bleed
  const survRegions = survEvents.map(e => e.region).filter(r => r && !VALID_REGIONS.includes(r));
  if (survRegions.length > 0) {
    violations.push({ type: "unknown_region_surv", count: survRegions.length, ts: Date.now() });
  }

  return violations;
}

// ── Phase 1389: Global performance audit ─────────────────────────────────────
function _computeGlobalPerfAudit(deploys, survEvents, redundancyNodes, latencyEvents) {
  const findings = [];

  // Active deploy saturation
  const activeDeploys = deploys.filter(d => !["complete", "rolled_back"].includes(d.stage));
  if (activeDeploys.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${activeDeploys.length} active regional deploys` });

  // Survivability burst
  const recentSurv = survEvents.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
  if (recentSurv.length > 5) findings.push({ id: "surv_burst", severity: "medium", msg: `${recentSurv.length} survivability events in 10s` });

  // Redundancy node duplication
  const nodeIds = redundancyNodes.map(n => n.id);
  const nodeDupes = nodeIds.length - new Set(nodeIds).size;
  if (nodeDupes > 0) findings.push({ id: "node_duplication", severity: "high", msg: `${nodeDupes} duplicate redundancy node IDs` });

  // Latency array size
  if (latencyEvents.length > LATENCY_MAX) findings.push({ id: "latency_overflow", severity: "medium", msg: `${latencyEvents.length} latency events` });

  return {
    ts:        Date.now(),
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Composite global ops score ────────────────────────────────────────────────
function _computeGlobalOpsScore({
  deployScore     = 100,
  survScore       = 100,
  redundancyScore = 100,
  latencyScore    = 100,
  continuityScore = 100,
  analyticsScore  = 100,
  isoViolations   = 0,
  perfScore       = 100,
} = {}) {
  const composite = Math.round(
    survScore       * 0.25 +
    continuityScore * 0.20 +
    redundancyScore * 0.20 +
    deployScore     * 0.15 +
    latencyScore    * 0.10 +
    analyticsScore  * 0.05 +
    perfScore       * 0.05
  ) - (isoViolations > 0 ? 15 : 0);
  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useGlobalOps() {
  const [regionalDeploys,  setRegionalDeploys]  = useState([]);
  const [survEvents,       setSurvEvents]       = useState([]);
  const [redundancyNodes,  setRedundancyNodes]  = useState([]);
  const [latencyEvents,    setLatencyEvents]    = useState([]);
  const [continuitySnaps,  setContinuitySnaps]  = useState([]);
  const [infraAnalytics,   setInfraAnalytics]   = useState([]);
  const [regionIsoViolations, setRegionIsoViolations] = useState([]);
  const [globalPerfAudit,  setGlobalPerfAudit]  = useState(null);
  const [initialized,      setInitialized]      = useState(false);

  // Phase 1381: Record regional deployment (approval-gated)
  const recordRegionalDeploy = useCallback((event = {}) => {
    const { id, stage, region, approvedAt } = event;
    if (!id || !VALID_DEPLOY_STAGES.includes(stage)) return;
    if (stage === "deploying" && !approvedAt) return;
    setRegionalDeploys(prev => {
      const now      = Date.now();
      const existing = prev.find(d => d.id === id);
      let next;
      if (existing) {
        next = prev.map(d => d.id === id ? { ...d, stage, region: region ?? d.region, approvedAt: approvedAt ?? d.approvedAt, updatedAt: now } : d);
      } else {
        next = [{ id, stage, region, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(d => now - (d.ts || 0) < REGION_DEPLOY_TTL)
        .slice(0, REGION_DEPLOY_MAX);
      _save(REGION_DEPLOY_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1382: Record regional survivability event
  const recordSurvEvent = useCallback((event = {}) => {
    const { type, region, recovered } = event;
    if (!VALID_SURV_TYPES.includes(type)) return;
    setSurvEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && e.region === region && now - (e.ts || 0) < 2 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, region, recovered: recovered === true, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < REGION_SURV_TTL)
        .slice(0, REGION_SURV_MAX);
      _save(REGION_SURV_KEY, next);
      return next;
    });
  }, []);

  // Phase 1383: Record redundancy node (approval-gated for failover)
  const recordRedundancyNode = useCallback((event = {}) => {
    const { id, stage, region, approvedAt } = event;
    if (!id || !VALID_REDUNDANCY_STAGES.includes(stage)) return;
    if (stage === "failover" && !approvedAt) return;
    setRedundancyNodes(prev => {
      const now      = Date.now();
      const existing = prev.find(n => n.id === id);
      let next;
      if (existing) {
        next = prev.map(n => n.id === id ? { ...n, stage, approvedAt: approvedAt ?? n.approvedAt, updatedAt: now } : n);
      } else {
        next = [{ id, stage, region, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(n => now - (n.ts || 0) < REDUNDANCY_TTL)
        .slice(0, REDUNDANCY_MAX);
      _save(REDUNDANCY_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1384: Record latency signal (privacy-safe)
  const recordLatencySignal = useCallback((event = {}) => {
    const { dim, score, region } = event;
    if (!VALID_LATENCY_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setLatencyEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && e.region === region && now - (e.ts || 0) < 30 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), region, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < LATENCY_TTL)
        .slice(0, LATENCY_MAX);
      _save(LATENCY_KEY, next);
      return next;
    });
  }, []);

  // Phase 1387: Record infra analytics event (privacy-safe)
  const recordInfraAnalytic = useCallback((event = {}) => {
    const { dim, score } = event;
    if (!VALID_ANALYTICS_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setInfraAnalytics(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && now - (e.ts || 0) < 30 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < INFRA_ANALYTICS_TTL)
        .slice(0, INFRA_ANALYTICS_MAX);
      _save(INFRA_ANALYTICS_KEY, next);
      return next;
    });
  }, []);

  // Phase 1388 + 1389: evaluate isolation + perf
  const evaluate = useCallback(() => {
    const now = Date.now();

    const isos = _checkRegionIsolation(regionalDeploys, survEvents);
    setRegionIsoViolations(isos);
    if (isos.length) {
      const existing = _load(REGION_ISO_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < REGION_ISO_TTL)
        .slice(0, REGION_ISO_MAX);
      _save(REGION_ISO_KEY, next);
    }

    const perf = _computeGlobalPerfAudit(regionalDeploys, survEvents, redundancyNodes, latencyEvents);
    setGlobalPerfAudit(perf);
    _save(GLOBAL_PERF_KEY, perf);
  }, [regionalDeploys, survEvents, redundancyNodes, latencyEvents]);

  useEffect(() => {
    const now = Date.now();
    setRegionalDeploys(_load(REGION_DEPLOY_KEY, []).filter(d => now - (d.ts || 0) < REGION_DEPLOY_TTL));
    setSurvEvents(_load(REGION_SURV_KEY, []).filter(e => now - (e.ts || 0) < REGION_SURV_TTL));
    setRedundancyNodes(_load(REDUNDANCY_KEY, []).filter(n => now - (n.ts || 0) < REDUNDANCY_TTL));
    setLatencyEvents(_load(LATENCY_KEY, []).filter(e => now - (e.ts || 0) < LATENCY_TTL));
    setContinuitySnaps(_load(CONTINUITY_KEY, []).filter(s => now - (s.ts || 0) < CONTINUITY_TTL));
    setInfraAnalytics(_load(INFRA_ANALYTICS_KEY, []).filter(e => now - (e.ts || 0) < INFRA_ANALYTICS_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => { evaluate(); }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores ────────────────────────────────────────────────────────
  const deployScore = useMemo(() => _scoreRegionalDeployments(regionalDeploys), [regionalDeploys]);

  const survScore = useMemo(
    () => _cached(`surv|${Math.floor(survEvents.length / 5)}`, () => _scoreRegionalSurvivability(survEvents)),
    [survEvents]
  );

  const redundancyScore = useMemo(() => _scoreRedundancy(redundancyNodes), [redundancyNodes]);

  const latencyResult = useMemo(
    () => _cached(`latency|${Math.floor(latencyEvents.length / 5)}`, () => _computeLatencyScore(latencyEvents)),
    [latencyEvents]
  );

  const latestContinuity = useMemo(() => {
    const snap = _computeGlobalContinuity({
      deployScore,
      survScore,
      redundancyScore,
      latencyScore:  latencyResult.score,
      isoViolations: regionIsoViolations.length,
    });
    setContinuitySnaps(prev => {
      const next = [snap, ...prev]
        .filter(s => Date.now() - (s.ts || 0) < CONTINUITY_TTL)
        .slice(0, CONTINUITY_MAX);
      _save(CONTINUITY_KEY, next);
      return next;
    });
    return snap;
  }, [deployScore, survScore, redundancyScore, latencyResult.score, regionIsoViolations.length]);

  const globalForecast = useMemo(
    () => _cached(`forecast|${Math.floor(continuitySnaps.length / 3)}`, () => _computeGlobalForecast(continuitySnaps)),
    [continuitySnaps]
  );

  const infraAnalyticsAgg = useMemo(
    () => _cached(`infraAnalytics|${Math.floor(infraAnalytics.length / 5)}`, () => _aggregateInfraAnalytics(infraAnalytics)),
    [infraAnalytics]
  );

  const globalOpsScore = useMemo(() => _computeGlobalOpsScore({
    deployScore,
    survScore,
    redundancyScore,
    latencyScore:   latencyResult.score,
    continuityScore: latestContinuity.score,
    analyticsScore: infraAnalyticsAgg.composite,
    isoViolations:  regionIsoViolations.length,
    perfScore:      globalPerfAudit?.score ?? 100,
  }), [
    deployScore, survScore, redundancyScore, latencyResult.score,
    latestContinuity.score, infraAnalyticsAgg.composite,
    regionIsoViolations.length, globalPerfAudit?.score,
  ]);

  const globalOpsBar = useMemo(() => {
    if (globalOpsScore >= 80 && regionIsoViolations.length === 0 && !globalPerfAudit?.highCount) return null;
    const issue =
      regionIsoViolations.length  ? `Region isolation: ${regionIsoViolations.length} violation${regionIsoViolations.length > 1 ? "s" : ""}` :
      globalPerfAudit?.highCount  ? globalPerfAudit.findings.find(f => f.severity === "high")?.msg :
      latestContinuity.label !== "GLOBALLY_CONTINUOUS" ? `Global continuity: ${latestContinuity.label}` :
      survScore < 60              ? `Regional survivability: ${survScore}%` :
      null;
    const color = globalOpsScore >= 80 ? "var(--op-green)" : globalOpsScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return { score: globalOpsScore, issue, color, hasCrit: globalOpsScore < 50 };
  }, [globalOpsScore, regionIsoViolations.length, globalPerfAudit, latestContinuity.label, survScore]);

  return {
    initialized,
    regionalDeploys,
    survEvents,
    redundancyNodes,
    latencyEvents,
    continuitySnaps,
    infraAnalytics,
    regionIsoViolations,
    globalPerfAudit,
    deployScore,
    survScore,
    redundancyScore,
    latencyResult,
    latestContinuity,
    globalForecast,
    infraAnalyticsAgg,
    globalOpsScore,
    globalOpsBar,
    recordRegionalDeploy,
    recordSurvEvent,
    recordRedundancyNode,
    recordLatencySignal,
    recordInfraAnalytic,
    evaluate,
  };
}
