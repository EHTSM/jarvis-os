// Phase 1246-1256: Growth + platform expansion operations.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const GROWTH_KEY     = "jarvis_growth_analytics";
const CONVERT_KEY    = "jarvis_onboard_conversion";
const ADOPT_KEY      = "jarvis_workflow_adopt_intel";
const RETAIN_KEY     = "jarvis_retention_signals";
const ECOSYSTEM_KEY  = "jarvis_ecosystem_expansion";
const ENGAGE_KEY     = "jarvis_platform_engagement";
const FORECAST_KEY   = "jarvis_growth_forecast";
const ISO_KEY        = "jarvis_growth_isolation";

const GROWTH_MAX     = 20;
const CONVERT_MAX    = 20;
const ADOPT_MAX      = 20;
const RETAIN_MAX     = 20;
const ECOSYSTEM_MAX  = 20;
const ENGAGE_MAX     = 20;
const FORECAST_MAX   = 20;
const ISO_MAX        = 15;

const GROWTH_TTL     = 7  * 24 * 60 * 60 * 1000;
const CONVERT_TTL    = 30 * 24 * 60 * 60 * 1000;
const ADOPT_TTL      = 30 * 24 * 60 * 60 * 1000;
const RETAIN_TTL     = 7  * 24 * 60 * 60 * 1000;
const ECOSYSTEM_TTL  = 30 * 24 * 60 * 60 * 1000;
const ENGAGE_TTL     = 7  * 24 * 60 * 60 * 1000;
const FORECAST_TTL   = 24 * 60 * 60 * 1000;

const VALID_CONVERT_EVENTS  = ["session_started", "first_workflow", "first_deployment", "first_replay", "onboarding_complete"];
const VALID_ADOPT_DIMS      = ["workflow", "replay", "deployment", "marketplace", "collaboration"];
const VALID_RETAIN_SIGNALS  = ["long_session", "replay_return", "deployment_repeat", "ecosystem_active", "productivity_streak"];
const VALID_ECOSYSTEM_TYPES = ["plugin_installed", "workflow_published", "template_used", "marketplace_browse", "org_expanded"];
const VALID_ENGAGE_TYPES    = ["workspace_active", "replay_used", "deployment_run", "workflow_discovered", "session_resumed"];

// ── Module-level LRU cache (30s TTL, 50-entry cap) ───────────────────────────

const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 50;

function _cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return e.val;
}
function _cacheSet(key, val) {
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { val, ts: Date.now() });
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Phase 1246: Growth analytics foundation ───────────────────────────────────

function _recordGrowthEvent(event) {
  if (!event?.type) return;
  const VALID_TYPES = ["onboarding_conversion", "workflow_adopted", "replay_used",
    "deployment_productive", "trust_milestone", "ecosystem_engaged"];
  if (!VALID_TYPES.includes(event.type)) return;
  // Privacy contract: counts and booleans only
  if (event.rawContent || event.userInput) return;

  const list = _load(GROWTH_KEY, []);
  const next = [{ type: event.type, orgId: event.orgId || null, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < GROWTH_TTL)
    .slice(0, GROWTH_MAX);
  _save(GROWTH_KEY, next);
}

function _scoreGrowth(events, retentionScore, ecosystemScore) {
  const cached = _cacheGet("growth_score");
  if (cached) return cached;

  const week  = events.filter(e => Date.now() - (e.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  const types = new Set(week.map(e => e.type));
  const eventScore = Math.min(100, Math.round(
    (types.has("onboarding_conversion") ? 20 : 0) +
    (types.has("workflow_adopted")      ? 20 : 0) +
    (types.has("replay_used")           ? 15 : 0) +
    (types.has("deployment_productive") ? 15 : 0) +
    (types.has("trust_milestone")       ? 15 : 0) +
    (types.has("ecosystem_engaged")     ? 15 : 0)
  ));
  const composite = Math.round(eventScore * 0.50 + retentionScore * 0.30 + ecosystemScore * 0.20);
  const result = { score: Math.min(100, composite), eventScore };
  _cacheSet("growth_score", result);
  return result;
}

// ── Phase 1247: Onboarding conversion optimization ────────────────────────────

function _recordConversion(event) {
  if (!event?.stage || !VALID_CONVERT_EVENTS.includes(event.stage)) return;
  // Dedup: same org + stage within 1h
  const list = _load(CONVERT_KEY, []);
  if (event.orgId && list.find(e => e.orgId === event.orgId && e.stage === event.stage
      && Date.now() - (e.ts || 0) < 60 * 60 * 1000)) return;

  const next = [{ stage: event.stage, orgId: event.orgId || null, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < CONVERT_TTL)
    .slice(0, CONVERT_MAX);
  _save(CONVERT_KEY, next);
}

function _scoreConversion(conversions) {
  const cached = _cacheGet("conversion_score");
  if (cached) return cached;

  const stages = new Set(conversions.map(c => c.stage));
  const funnelDepth = VALID_CONVERT_EVENTS.filter(s => stages.has(s)).length;
  const score = Math.round((funnelDepth / VALID_CONVERT_EVENTS.length) * 100);
  const result = { score, funnelDepth, totalStages: VALID_CONVERT_EVENTS.length };
  _cacheSet("conversion_score", result);
  return result;
}

// ── Phase 1248: Workflow adoption intelligence ────────────────────────────────

function _recordAdoptionSignal(signal) {
  if (!signal?.dim || !VALID_ADOPT_DIMS.includes(signal.dim)) return;
  if (signal.rawContent || signal.commandOutput) return; // privacy contract

  const list = _load(ADOPT_KEY, []);
  const next = [{ dim: signal.dim, count: signal.count ?? 1, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < ADOPT_TTL)
    .slice(0, ADOPT_MAX);
  _save(ADOPT_KEY, next);
}

function _scoreAdoptionIntel(signals) {
  const cached = _cacheGet("adopt_intel");
  if (cached) return cached;

  const now   = Date.now();
  const month = signals.filter(s => now - (s.ts || 0) < 30 * 24 * 60 * 60 * 1000);
  const byDim = {};
  VALID_ADOPT_DIMS.forEach(dim => {
    const dimSigs = month.filter(s => s.dim === dim);
    byDim[dim] = dimSigs.reduce((sum, s) => sum + (s.count || 1), 0);
  });
  const activeDims = Object.values(byDim).filter(v => v > 0).length;
  const score = Math.round((activeDims / VALID_ADOPT_DIMS.length) * 100);
  const result = { score, byDim, activeDims };
  _cacheSet("adopt_intel", result);
  return result;
}

// ── Phase 1249: Retention survivability system ────────────────────────────────

function _recordRetentionSignal(signal) {
  if (!signal?.type || !VALID_RETAIN_SIGNALS.includes(signal.type)) return;
  const list = _load(RETAIN_KEY, []);
  // Dedup same type within 30 min
  if (list.find(s => s.type === signal.type && Date.now() - (s.ts || 0) < 30 * 60 * 1000)) return;

  const next = [{ type: signal.type, orgId: signal.orgId || null, ts: Date.now() }, ...list]
    .filter(s => Date.now() - (s.ts || 0) < RETAIN_TTL)
    .slice(0, RETAIN_MAX);
  _save(RETAIN_KEY, next);
}

function _scoreRetention(signals) {
  const cached = _cacheGet("retention_score");
  if (cached) return cached;

  const week  = signals.filter(s => Date.now() - (s.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  const types = new Set(week.map(s => s.type));
  const score = Math.round((types.size / VALID_RETAIN_SIGNALS.length) * 100);
  const result = { score, activeSignals: types.size };
  _cacheSet("retention_score", result);
  return result;
}

// ── Phase 1250: Ecosystem expansion metrics ───────────────────────────────────

function _recordEcosystemEvent(event) {
  if (!event?.type || !VALID_ECOSYSTEM_TYPES.includes(event.type)) return;
  const list = _load(ECOSYSTEM_KEY, []);
  const next = [{ type: event.type, orgId: event.orgId || null, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < ECOSYSTEM_TTL)
    .slice(0, ECOSYSTEM_MAX);
  _save(ECOSYSTEM_KEY, next);
}

function _scoreEcosystem(events) {
  const cached = _cacheGet("ecosystem_score");
  if (cached) return cached;

  const month = events.filter(e => Date.now() - (e.ts || 0) < 30 * 24 * 60 * 60 * 1000);
  const types = new Set(month.map(e => e.type));
  const score = Math.round((types.size / VALID_ECOSYSTEM_TYPES.length) * 100);
  const result = { score, activeTypes: types.size };
  _cacheSet("ecosystem_score", result);
  return result;
}

// ── Phase 1251: Platform engagement foundation ────────────────────────────────

function _recordEngagement(event) {
  if (!event?.type || !VALID_ENGAGE_TYPES.includes(event.type)) return;
  const list = _load(ENGAGE_KEY, []);
  // Dedup same type within 5 min
  if (list.find(e => e.type === event.type && Date.now() - (e.ts || 0) < 5 * 60 * 1000)) return;

  const next = [{ type: event.type, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < ENGAGE_TTL)
    .slice(0, ENGAGE_MAX);
  _save(ENGAGE_KEY, next);
}

function _scoreEngagement(events) {
  const cached = _cacheGet("engagement_score");
  if (cached) return cached;

  const week  = events.filter(e => Date.now() - (e.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  const types = new Set(week.map(e => e.type));
  const score = Math.round((types.size / VALID_ENGAGE_TYPES.length) * 100);
  const result = { score, activeTypes: types.size };
  _cacheSet("engagement_score", result);
  return result;
}

// ── Phase 1252: Operational growth forecasting ────────────────────────────────

function _forecastGrowth(growthHistory, retentionScore, conversionScore) {
  const cached = _cacheGet("growth_forecast");
  if (cached) return cached;

  const now = Date.now();
  if (growthHistory.length < 3) {
    const result = { trend: "insufficient_data", riskLevel: "low", projectedScore: null };
    _cacheSet("growth_forecast", result);
    return result;
  }

  // Score growth velocity by event density over time windows
  const week1 = growthHistory.filter(e => now - (e.ts || 0) < 7 * 24 * 60 * 60 * 1000).length;
  const week2 = growthHistory.filter(e => {
    const age = now - (e.ts || 0);
    return age >= 7 * 24 * 60 * 60 * 1000 && age < 14 * 24 * 60 * 60 * 1000;
  }).length;

  const velocity = week2 > 0 ? (week1 - week2) / week2 : 0;
  const trend    = velocity > 0.1 ? "accelerating" : velocity < -0.1 ? "decelerating" : "stable";
  const riskLevel = retentionScore < 40 || conversionScore < 40 ? "high"
    : retentionScore < 60 || conversionScore < 60 ? "medium" : "low";

  const snap = { trend, riskLevel, velocity: Math.round(velocity * 100) / 100, ts: now };
  const prev = _load(FORECAST_KEY, []).filter(f => now - (f.ts || 0) < FORECAST_TTL);
  _save(FORECAST_KEY, [snap, ...prev].slice(0, FORECAST_MAX));
  _cacheSet("growth_forecast", snap);
  return snap;
}

// ── Phase 1253: Multi-org growth isolation ────────────────────────────────────

const GROWTH_PREFIXES = new Set([
  "jarvis_growth_analytics", "jarvis_onboard_conversion", "jarvis_workflow_adopt_intel",
  "jarvis_retention_signals", "jarvis_ecosystem_expansion", "jarvis_platform_engagement",
  "jarvis_growth_forecast", "jarvis_growth_isolation",
]);

function _scanGrowthIsolation() {
  const cached = _cacheGet("growth_iso");
  if (cached) return cached;

  const violations = [];
  try {
    for (let i = 0; i < localStorage.length && violations.length < 5; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("jarvis_")) continue;
      // Flag if growth analytics keys contain org data from unknown orgs
      if (k.includes("growth") && !GROWTH_PREFIXES.has(k) && !k.includes("jarvis_growth_"))
        violations.push({ type: "growth_key_bleed", key: k, ts: Date.now() });
    }
  } catch {}

  const prev   = _load(ISO_KEY, []);
  const merged = [...violations, ...prev].slice(0, ISO_MAX);
  _save(ISO_KEY, merged);
  _cacheSet("growth_iso", { violations });
  return { violations };
}

// ── Phase 1254/1255/1256: Perf hardening + stress + calm bar ─────────────────

function _buildGrowthBar({ growthScore, conversionScore, retentionScore, forecast, isoViolations }) {
  const hasIssue = growthScore < 80 || isoViolations > 0 || forecast?.riskLevel === "high";
  if (!hasIssue) return null;

  const topIssue = isoViolations > 0
    ? `${isoViolations} growth isolation issue${isoViolations > 1 ? "s" : ""}`
    : forecast?.riskLevel === "high"
      ? `Growth ${forecast.trend}`
      : conversionScore < 50
        ? `Conversion funnel ${conversionScore}%`
        : retentionScore < 50
          ? `Retention ${retentionScore}%`
          : null;

  const color = growthScore >= 80 ? "var(--op-green)"
    : growthScore >= 60 ? "var(--op-amber)" : "var(--op-red)";

  return { label: "GROWTH", score: growthScore, color, issue: topIssue,
    trend: forecast?.trend || null };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useGrowthOps({
  externalRetentionScore  = null,
  externalEcosystemScore  = null,
} = {}) {
  const [growthEvents,   setGrowthEvents]   = useState([]);
  const [conversions,    setConversions]    = useState([]);
  const [adoptionSigs,   setAdoptionSigs]   = useState([]);
  const [retentionSigs,  setRetentionSigs]  = useState([]);
  const [ecosystemEvts,  setEcosystemEvts]  = useState([]);
  const [engageEvts,     setEngageEvts]     = useState([]);
  const [forecast,       setForecast]       = useState(null);
  const [isoState,       setIsoState]       = useState({ violations: [] });
  const [initialized,    setInitialized]    = useState(false);

  const loadAll = useCallback(() => {
    const now = Date.now();
    setGrowthEvents(_load(GROWTH_KEY, []).filter(e => now - (e.ts || 0) < GROWTH_TTL).slice(0, GROWTH_MAX));
    setConversions(_load(CONVERT_KEY, []).filter(e => now - (e.ts || 0) < CONVERT_TTL).slice(0, CONVERT_MAX));
    setAdoptionSigs(_load(ADOPT_KEY, []).filter(e => now - (e.ts || 0) < ADOPT_TTL).slice(0, ADOPT_MAX));
    setRetentionSigs(_load(RETAIN_KEY, []).filter(e => now - (e.ts || 0) < RETAIN_TTL).slice(0, RETAIN_MAX));
    setEcosystemEvts(_load(ECOSYSTEM_KEY, []).filter(e => now - (e.ts || 0) < ECOSYSTEM_TTL).slice(0, ECOSYSTEM_MAX));
    setEngageEvts(_load(ENGAGE_KEY, []).filter(e => now - (e.ts || 0) < ENGAGE_TTL).slice(0, ENGAGE_MAX));
    setIsoState(_scanGrowthIsolation());
  }, []);

  useEffect(() => {
    loadAll();
    setInitialized(true);
  }, [loadAll]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadAll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadAll]);

  const recordGrowthEvent = useCallback((event) => {
    _recordGrowthEvent(event);
    setGrowthEvents(_load(GROWTH_KEY, []).filter(e => Date.now() - (e.ts || 0) < GROWTH_TTL).slice(0, GROWTH_MAX));
  }, []);

  const recordConversion = useCallback((event) => {
    _recordConversion(event);
    setConversions(_load(CONVERT_KEY, []).filter(e => Date.now() - (e.ts || 0) < CONVERT_TTL).slice(0, CONVERT_MAX));
  }, []);

  const recordAdoptionSignal = useCallback((signal) => {
    _recordAdoptionSignal(signal);
    setAdoptionSigs(_load(ADOPT_KEY, []).filter(e => Date.now() - (e.ts || 0) < ADOPT_TTL).slice(0, ADOPT_MAX));
  }, []);

  const recordRetentionSignal = useCallback((signal) => {
    _recordRetentionSignal(signal);
    setRetentionSigs(_load(RETAIN_KEY, []).filter(e => Date.now() - (e.ts || 0) < RETAIN_TTL).slice(0, RETAIN_MAX));
  }, []);

  const recordEcosystemEvent = useCallback((event) => {
    _recordEcosystemEvent(event);
    setEcosystemEvts(_load(ECOSYSTEM_KEY, []).filter(e => Date.now() - (e.ts || 0) < ECOSYSTEM_TTL).slice(0, ECOSYSTEM_MAX));
  }, []);

  const recordEngagement = useCallback((event) => {
    _recordEngagement(event);
    setEngageEvts(_load(ENGAGE_KEY, []).filter(e => Date.now() - (e.ts || 0) < ENGAGE_TTL).slice(0, ENGAGE_MAX));
  }, []);

  const retentionScore  = useMemo(() => externalRetentionScore  ?? _scoreRetention(retentionSigs).score,  [retentionSigs, externalRetentionScore]);
  const ecosystemScore  = useMemo(() => externalEcosystemScore  ?? _scoreEcosystem(ecosystemEvts).score,  [ecosystemEvts, externalEcosystemScore]);
  const conversionScore = useMemo(() => _scoreConversion(conversions).score,   [conversions]);
  const adoptionIntel   = useMemo(() => _scoreAdoptionIntel(adoptionSigs),     [adoptionSigs]);
  const engagementScore = useMemo(() => _scoreEngagement(engageEvts).score,    [engageEvts]);

  const growthScore = useMemo(
    () => _scoreGrowth(growthEvents, retentionScore, ecosystemScore).score,
    [growthEvents, retentionScore, ecosystemScore]
  );

  // Update forecast when growth events or scores change
  const _growthBucket     = Math.floor(growthScore / 10);
  const _retentionBucket  = Math.floor(retentionScore / 10);
  const _conversionBucket = Math.floor(conversionScore / 10);

  useEffect(() => {
    const fc = _forecastGrowth(growthEvents, retentionScore, conversionScore);
    setForecast(fc);
  }, [_growthBucket, _retentionBucket, _conversionBucket]); // eslint-disable-line

  const _isoCount = isoState.violations.length;

  const growthBar = useMemo(
    () => _buildGrowthBar({ growthScore, conversionScore, retentionScore, forecast, isoViolations: _isoCount }),
    [growthScore, conversionScore, retentionScore, forecast, _isoCount]
  );

  return {
    initialized,
    growthEvents,
    conversions,
    adoptionSigs,
    retentionSigs,
    ecosystemEvts,
    engageEvts,
    forecast,
    isoState,
    growthScore,
    conversionScore,
    retentionScore,
    ecosystemScore,
    adoptionIntel,
    engagementScore,
    growthBar,
    recordGrowthEvent,
    recordConversion,
    recordAdoptionSignal,
    recordRetentionSignal,
    recordEcosystemEvent,
    recordEngagement,
  };
}
