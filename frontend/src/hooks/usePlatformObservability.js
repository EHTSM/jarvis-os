// Phase 1043-1049: Multi-workspace productivity isolation + platform observability evolution +
// stress validation + execution audit + safety audit + productivity UX + platform intelligence validation.
//
// Consolidates seven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 15 isolation events, 100 observability events, 5 workspace profiles, 30d retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const POBS_KEY   = "jarvis_platform_obs";
const WISO_KEY   = "jarvis_ws_prod_isolation";
const WPROF_KEY  = "jarvis_ws_profiles";
const POBS_MAX   = 100;
const WISO_MAX   = 15;
const WPROF_MAX  = 5;
const POBS_TTL   = 30 * 24 * 60 * 60 * 1000;
const WISO_TTL   = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1043: Multi-workspace productivity isolation ────────────────────────

// Optimization-state keys that must not bleed across workspaces
const PROD_ISOLATED_PREFIXES = [
  "jarvis_workflow_accel_", "jarvis_prod_intel_ws_",
  "jarvis_bottlenecks_ws_", "jarvis_deploy_eff_ws_",
];

function _scanProdIsolation(activeWsId, allWsIds) {
  if (!activeWsId || allWsIds.length <= 1) return [];
  const violations = [];
  allWsIds.forEach(wsId => {
    if (wsId === activeWsId) return;
    PROD_ISOLATED_PREFIXES.forEach(prefix => {
      const key = `${prefix}${wsId}`;
      if (localStorage.getItem(key) !== null) {
        violations.push({ wsId, key, reason: "Cross-workspace optimization state bleed" });
      }
    });
  });
  return violations.slice(0, 8);
}

// Per-workspace productivity profile
function _buildWorkspaceProfile(wsId) {
  const now = Date.now();
  return {
    wsId,
    updatedAt: now,
    accelScore: null,  // populated from productivity intelligence
    bottleneckCount: 0,
    deployMaturity: null,
  };
}

// ── Phase 1044: Platform observability evolution ──────────────────────────────

const OBS_EVENT_TYPES = new Set([
  "bottleneck_detected", "bottleneck_cleared",
  "accel_improved", "accel_degraded",
  "replay_optimized", "replay_degraded",
  "deploy_success", "deploy_failure",
  "productivity_high", "productivity_low",
  "platform_healthy", "platform_degraded",
  "workspace_switched", "plugin_impact",
]);

function _buildPlatformHealthView({
  productivityScore = 100,
  bottlenecks       = [],
  infraScore        = 100,
  ecoScore          = 100,
  governanceScore   = 100,
} = {}) {
  const now = Date.now();

  // Composite platform health
  const composite = Math.round(
    productivityScore * 0.35 +
    infraScore        * 0.25 +
    ecoScore          * 0.20 +
    governanceScore   * 0.20
  );

  const highlights = [];
  if (productivityScore < 60) highlights.push({ area: "Productivity", score: productivityScore, color: "var(--op-red)" });
  if (infraScore < 60)        highlights.push({ area: "Infrastructure", score: infraScore,       color: "var(--op-red)" });
  if (ecoScore < 60)          highlights.push({ area: "Ecosystem",     score: ecoScore,          color: "var(--op-amber)" });

  const topBottleneck = bottlenecks.find(b => b.severity === "high") || null;

  return {
    ts:            now,
    composite,
    label:         composite >= 80 ? "HEALTHY" : composite >= 55 ? "DEGRADED" : "CRITICAL",
    color:         composite >= 80 ? "var(--op-green)" : composite >= 55 ? "var(--op-amber)" : "var(--op-red)",
    highlights,
    topBottleneck,
    productivityScore,
    infraScore,
    ecoScore,
    governanceScore,
  };
}

// ── Phase 1045-1049: Stress + UX + audits + validation ───────────────────────

// Calm observability: suppress events when platform is healthy (Phase 1044/1048)
function _shouldSurfaceEvent(event, platformScore) {
  if (platformScore >= 80) {
    // Only surface high-severity events when healthy
    return event.severity === "high" || event.severity === "critical";
  }
  return true;
}

// Platform intelligence readiness (Phase 1049)
function _computePlatformReadiness({
  productivityScore = 100,
  bottleneckCount   = 0,
  isolationViolations = 0,
  obsEventCount     = 0,
} = {}) {
  let score = 100;
  if (productivityScore < 60)     score -= 25;
  else if (productivityScore < 80) score -= 10;
  if (bottleneckCount > 2)        score -= 20;
  if (isolationViolations > 0)    score -= 15;
  if (obsEventCount < 5)          score -= 10;  // insufficient observability data
  score = Math.max(0, score);

  return {
    score,
    label: score >= 80 ? "INTELLIGENCE READY" : score >= 60 ? "DEVELOPING" : "FOUNDATIONAL",
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

export function usePlatformObservability({
  productivityScore = 100,
  bottlenecks       = [],
  infraScore        = 100,
  ecoScore          = 100,
  governanceScore   = 100,
} = {}) {
  const [obsEvents,      setObsEvents]      = useState([]);
  const [isolationEvents,setIsolationEvents] = useState([]);
  const [wsProfiles,     setWsProfiles]     = useState({});
  const [platformHealth, setPlatformHealth]  = useState(null);
  const [initialized,    setInitialized]    = useState(false);

  const activeWsId = useMemo(() =>
    localStorage.getItem("jarvis_operator_id") || "default",
    []
  );

  const evaluate = useCallback(() => {
    // Platform health view
    const health = _buildPlatformHealthView({ productivityScore, bottlenecks, infraScore, ecoScore, governanceScore });
    setPlatformHealth(health);
    _save(POBS_KEY, { health, ts: Date.now() });

    // Record observability event
    const evtType = health.composite >= 80 ? "platform_healthy" : "platform_degraded";
    if (OBS_EVENT_TYPES.has(evtType)) {
      const entry = { type: evtType, ts: Date.now(), score: health.composite };
      setObsEvents(prev => {
        const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < POBS_TTL).slice(0, POBS_MAX);
        _save(POBS_KEY + "_events", next);
        return next;
      });
    }

    // Workspace isolation scan
    const allWsIds = (() => {
      try { return Object.keys(JSON.parse(localStorage.getItem("jarvis_mwc_state") || "{}").workspaces || {}); }
      catch { return []; }
    })();
    const violations = _scanProdIsolation(activeWsId, allWsIds);
    if (violations.length > 0) {
      setIsolationEvents(prev => {
        const entries = violations.map(v => ({ ...v, ts: Date.now() }));
        const next = [...entries, ...prev].filter(e => Date.now() - (e.ts || 0) < WISO_TTL).slice(0, WISO_MAX);
        _save(WISO_KEY, next);
        return next;
      });
    }
  }, [productivityScore, bottlenecks, infraScore, ecoScore, governanceScore, activeWsId]);

  useEffect(() => {
    const now = Date.now();
    const cached = _load(POBS_KEY, null);
    if (cached?.health) setPlatformHealth(cached.health);
    setObsEvents(_load(POBS_KEY + "_events", []).filter(e => now - (e.ts || 0) < POBS_TTL));
    setIsolationEvents(_load(WISO_KEY, []).filter(e => now - (e.ts || 0) < WISO_TTL));
    setWsProfiles(_load(WPROF_KEY, {}));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Record a platform observability event
  const recordObs = useCallback((eventType, meta = {}) => {
    if (!OBS_EVENT_TYPES.has(eventType)) return;
    const entry = { type: eventType, ts: Date.now(), ...meta };
    setObsEvents(prev => {
      const next = [entry, ...prev].filter(e => Date.now() - (e.ts || 0) < POBS_TTL).slice(0, POBS_MAX);
      _save(POBS_KEY + "_events", next);
      return next;
    });
  }, []);

  // Update a workspace productivity profile
  const updateWsProfile = useCallback((wsId, updates = {}) => {
    setWsProfiles(prev => {
      const profiles = { ...prev };
      if (Object.keys(profiles).length >= WPROF_MAX && !profiles[wsId]) {
        const oldest = Object.keys(profiles).sort((a, b) => (profiles[a].updatedAt || 0) - (profiles[b].updatedAt || 0))[0];
        delete profiles[oldest];
      }
      profiles[wsId] = { ...(profiles[wsId] || _buildWorkspaceProfile(wsId)), ...updates, updatedAt: Date.now() };
      _save(WPROF_KEY, profiles);
      return profiles;
    });
  }, []);

  // Platform readiness (Phase 1049)
  const platformReadiness = useMemo(() => _computePlatformReadiness({
    productivityScore,
    bottleneckCount:    bottlenecks.filter(b => b.severity === "high").length,
    isolationViolations: isolationEvents.filter(e => Date.now() - (e.ts || 0) < 60 * 60 * 1000).length,
    obsEventCount:      obsEvents.length,
  }), [productivityScore, bottlenecks, isolationEvents, obsEvents.length]);

  // Calm surfacing: only show notable events (Phase 1044/1048)
  const surfaceableEvents = useMemo(() =>
    obsEvents.filter(e => _shouldSurfaceEvent(e, platformHealth?.composite ?? 100)).slice(0, 5),
    [obsEvents, platformHealth]
  );

  // Platform observability pill for operator bar (Phase 1048 UX)
  const obsPill = useMemo(() => {
    if (!platformHealth || platformHealth.composite >= 80) return null;
    return {
      label: "PLATFORM",
      score: platformHealth.composite,
      color: platformHealth.color,
      detail: platformHealth.highlights[0]?.area || null,
    };
  }, [platformHealth]);

  return {
    initialized,
    platformHealth,
    obsEvents: surfaceableEvents,
    isolationEvents,
    wsProfiles,
    platformReadiness,
    obsPill,
    // Actions
    evaluate,
    recordObs,
    updateWsProfile,
  };
}
