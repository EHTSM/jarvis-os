// Phase 1336-1346: Real-world product maturity + user-experience hardening.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const SESSION_KEY    = "jarvis_first_session";
const STABILITY_KEY  = "jarvis_product_stability";
const LONG_SES_KEY   = "jarvis_long_sessions";
const PLUGIN_KEY     = "jarvis_plugin_reliability";
const TRUST_KEY      = "jarvis_user_trust";
const SESSION_ISO_KEY = "jarvis_session_isolation";
const USABILITY_KEY  = "jarvis_usability_analytics";
const CALMNESS_KEY   = "jarvis_product_calmness";

const SESSION_MAX    = 20;
const STABILITY_MAX  = 30;
const LONG_SES_MAX   = 10;
const PLUGIN_MAX     = 20;
const TRUST_MAX      = 20;
const SESSION_ISO_MAX = 20;
const USABILITY_MAX  = 30;
const CALMNESS_MAX   = 20;

const SESSION_TTL    = 7  * 24 * 60 * 60 * 1000;
const STABILITY_TTL  = 24 * 60 * 60 * 1000;
const LONG_SES_TTL   = 7  * 24 * 60 * 60 * 1000;
const PLUGIN_TTL     = 7  * 24 * 60 * 60 * 1000;
const TRUST_TTL      = 7  * 24 * 60 * 60 * 1000;
const SESSION_ISO_TTL = 24 * 60 * 60 * 1000;
const USABILITY_TTL  = 7  * 24 * 60 * 60 * 1000;
const CALMNESS_TTL   = 24 * 60 * 60 * 1000;

const VALID_SESSION_STAGES   = ["started", "workspace_ready", "first_action", "first_deploy", "complete"];
const VALID_STABILITY_TYPES  = ["runtime_interruption", "replay_restoration", "deploy_continuity", "workflow_responsiveness", "op_trust", "exec_durability"];
const VALID_LONG_SES_STAGES  = ["active", "hydrating", "restored", "degraded", "ended"];
const VALID_PLUGIN_STATES    = ["installing", "active", "degraded", "failed", "removed"];
const VALID_TRUST_EVENTS     = ["transparency_shown", "action_explained", "approval_requested", "rollback_offered", "explainability_displayed"];
const VALID_USABILITY_DIMS   = ["onboard_completion", "workflow_adoption", "deploy_survivability", "workload_pattern", "runtime_responsiveness", "eng_productivity"];

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

// ── Phase 1336: First-session scoring ────────────────────────────────────────
function _scoreFirstSessions(sessions) {
  if (!sessions.length) return 100;
  const now      = Date.now();
  const complete = sessions.filter(s => s.stage === "complete").length;
  const stale    = sessions.filter(s =>
    !["complete"].includes(s.stage) && now - (s.ts || 0) > 48 * 60 * 60 * 1000
  ).length;
  const depth = sessions.reduce((acc, s) => {
    const idx = VALID_SESSION_STAGES.indexOf(s.stage);
    return acc + (idx >= 0 ? idx + 1 : 0);
  }, 0) / sessions.length;
  return Math.max(0, Math.min(100, Math.round(
    (complete / sessions.length) * 60
    + (depth / VALID_SESSION_STAGES.length) * 30
    - stale * 10
  )));
}

// ── Phase 1338: Product stability scoring ────────────────────────────────────
function _computeStabilityScore(events) {
  if (!events.length) return { score: 100, label: "STABLE", byType: {} };
  const byType = {};
  for (const t of VALID_STABILITY_TYPES) {
    const typeEvents = events.filter(e => e.type === t);
    byType[t] = typeEvents.length
      ? Math.round(typeEvents.reduce((a, e) => a + (e.score ?? 80), 0) / typeEvents.length)
      : null;
  }
  const filled    = Object.values(byType).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return {
    score:  composite,
    label:  composite >= 80 ? "STABLE" : composite >= 60 ? "FRAGILE" : "UNSTABLE",
    byType,
  };
}

// ── Phase 1339: Long-session survivability ────────────────────────────────────
function _scoreLongSessions(sessions) {
  if (!sessions.length) return 100;
  const active   = sessions.filter(s => s.stage === "active" || s.stage === "restored").length;
  const degraded = sessions.filter(s => s.stage === "degraded").length;
  const ended    = sessions.filter(s => s.stage === "ended").length;
  return Math.max(0, Math.round(
    ((active + ended) / sessions.length) * 100
    - degraded * 15
  ));
}

// ── Phase 1340: Plugin reliability ───────────────────────────────────────────
function _scorePluginReliability(plugins) {
  if (!plugins.length) return 100;
  const active  = plugins.filter(p => p.state === "active").length;
  const failed  = plugins.filter(p => p.state === "failed").length;
  const unapproved = plugins.filter(p =>
    p.state === "active" && !p.approvedAt
  ).length;
  return Math.max(0, Math.round(
    (active / plugins.length) * 80
    - failed * 10
    - unapproved * 20
  ));
}

// ── Phase 1342: User trust scoring ───────────────────────────────────────────
function _computeTrustScore(events) {
  if (!events.length) return 100;
  const now    = Date.now();
  const recent = events.filter(e => now - (e.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  if (!recent.length) return 100;
  const positive = recent.filter(e => VALID_TRUST_EVENTS.includes(e.type)).length;
  return Math.min(100, Math.round((positive / recent.length) * 100));
}

// ── Phase 1343: Session isolation check ──────────────────────────────────────
function _checkSessionIsolation(sessions, longSessions) {
  const violations = [];
  const sessionIds = new Set(sessions.map(s => s.sessionId).filter(Boolean));

  // Cross-session contamination: long sessions referencing unknown session IDs
  for (const ls of longSessions) {
    if (ls.parentSessionId && !sessionIds.has(ls.parentSessionId)) {
      violations.push({ type: "orphan_long_session", longSessionId: ls.id, ts: Date.now() });
    }
  }

  // Replay crossover: same orgId active in multiple concurrent sessions
  const orgSessions = {};
  for (const s of sessions.filter(s => !["complete"].includes(s.stage))) {
    if (s.orgId) {
      orgSessions[s.orgId] = (orgSessions[s.orgId] || 0) + 1;
    }
  }
  for (const [orgId, count] of Object.entries(orgSessions)) {
    if (count > 1) {
      violations.push({ type: "concurrent_session_bleed", orgId, count, ts: Date.now() });
    }
  }

  return violations;
}

// ── Phase 1344: Usability analytics aggregation ───────────────────────────────
function _aggregateUsability(events) {
  const byDim = {};
  for (const dim of VALID_USABILITY_DIMS) {
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

// ── Phase 1345: Product calmness snapshot ─────────────────────────────────────
function _computeCalmness({
  activeBarCount  = 0,
  stabilityScore  = 100,
  trustScore      = 100,
  pluginScore     = 100,
  sessionScore    = 100,
  isoViolations   = 0,
} = {}) {
  const fatigue = activeBarCount * 4 + (stabilityScore < 60 ? 20 : 0) + isoViolations * 10;
  const raw     = Math.round(
    trustScore      * 0.30 +
    stabilityScore  * 0.25 +
    pluginScore     * 0.20 +
    sessionScore    * 0.15
  ) - Math.min(40, fatigue);
  return Math.max(0, Math.min(100, raw));
}

// ── Composite product maturity score ─────────────────────────────────────────
function _computeProductMaturity({
  sessionScore    = 100,
  stabilityScore  = 100,
  longSesScore    = 100,
  pluginScore     = 100,
  trustScore      = 100,
  usabilityScore  = 100,
  calmnessScore   = 100,
  isoViolations   = 0,
} = {}) {
  const composite = Math.round(
    trustScore      * 0.20 +
    stabilityScore  * 0.20 +
    longSesScore    * 0.15 +
    pluginScore     * 0.15 +
    usabilityScore  * 0.15 +
    sessionScore    * 0.10 +
    calmnessScore   * 0.05
  ) - (isoViolations > 0 ? 10 : 0);
  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useProductMaturity({ activeBarCount = 0 } = {}) {
  const [firstSessions,   setFirstSessions]   = useState([]);
  const [stabilityEvents, setStabilityEvents] = useState([]);
  const [longSessions,    setLongSessions]    = useState([]);
  const [plugins,         setPlugins]         = useState([]);
  const [trustEvents,     setTrustEvents]     = useState([]);
  const [sessionIsoViolations, setSessionIsoViolations] = useState([]);
  const [usabilityEvents, setUsabilityEvents] = useState([]);
  const [calmnessSnaps,   setCalmnessSnaps]   = useState([]);
  const [initialized,     setInitialized]     = useState(false);

  // Phase 1336: Record first-session step
  const recordFirstSession = useCallback((event = {}) => {
    const { sessionId, orgId, stage } = event;
    if (!sessionId || !VALID_SESSION_STAGES.includes(stage)) return;
    setFirstSessions(prev => {
      const now      = Date.now();
      const existing = prev.find(s => s.sessionId === sessionId);
      let next;
      if (existing) {
        const newIdx = VALID_SESSION_STAGES.indexOf(stage);
        const curIdx = VALID_SESSION_STAGES.indexOf(existing.stage);
        if (newIdx <= curIdx) return prev;
        next = prev.map(s => s.sessionId === sessionId ? { ...s, stage, updatedAt: now } : s);
      } else {
        next = [{ sessionId, orgId, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(s => now - (s.ts || 0) < SESSION_TTL)
        .slice(0, SESSION_MAX);
      _save(SESSION_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1338: Record stability signal (privacy-safe)
  const recordStabilitySignal = useCallback((event = {}) => {
    const { type, score } = event;
    if (!VALID_STABILITY_TYPES.includes(type)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setStabilityEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && now - (e.ts || 0) < 2 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < STABILITY_TTL)
        .slice(0, STABILITY_MAX);
      _save(STABILITY_KEY, next);
      return next;
    });
  }, []);

  // Phase 1339: Record long-session state
  const recordLongSession = useCallback((event = {}) => {
    const { id, stage, parentSessionId, orgId } = event;
    if (!id || !VALID_LONG_SES_STAGES.includes(stage)) return;
    setLongSessions(prev => {
      const now      = Date.now();
      const existing = prev.find(s => s.id === id);
      let next;
      if (existing) {
        next = prev.map(s => s.id === id ? { ...s, stage, updatedAt: now } : s);
      } else {
        // Dedup: no duplicate active session per org within 5min
        const recentSame = prev.find(s =>
          s.orgId === orgId && s.stage === "active" && now - (s.ts || 0) < 5 * 60 * 1000
        );
        if (recentSame && stage === "active") return prev;
        next = [{ id, stage, parentSessionId, orgId, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(s => now - (s.ts || 0) < LONG_SES_TTL)
        .slice(0, LONG_SES_MAX);
      _save(LONG_SES_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1340: Record plugin state (approval-gated for active)
  const recordPluginState = useCallback((event = {}) => {
    const { id, name, state, approvedAt } = event;
    if (!id || !VALID_PLUGIN_STATES.includes(state)) return;
    if (state === "active" && !approvedAt) return;
    setPlugins(prev => {
      const now      = Date.now();
      const existing = prev.find(p => p.id === id);
      let next;
      if (existing) {
        next = prev.map(p => p.id === id ? { ...p, state, approvedAt: approvedAt ?? p.approvedAt, updatedAt: now } : p);
      } else {
        next = [{ id, name, state, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(p => now - (p.ts || 0) < PLUGIN_TTL)
        .slice(0, PLUGIN_MAX);
      _save(PLUGIN_KEY, filtered);
      return filtered;
    });
  }, []);

  // Phase 1342: Record trust event
  const recordTrustEvent = useCallback((event = {}) => {
    const { type } = event;
    if (!VALID_TRUST_EVENTS.includes(type)) return;
    setTrustEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.type === type && now - (e.ts || 0) < 5 * 60 * 1000);
      if (dedup) return prev;
      const next = [{ type, ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < TRUST_TTL)
        .slice(0, TRUST_MAX);
      _save(TRUST_KEY, next);
      return next;
    });
  }, []);

  // Phase 1344: Record usability event (privacy-safe)
  const recordUsabilityEvent = useCallback((event = {}) => {
    const { dim, score } = event;
    if (!VALID_USABILITY_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setUsabilityEvents(prev => {
      const now   = Date.now();
      const dedup = prev.find(e => e.dim === dim && now - (e.ts || 0) < 30 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < USABILITY_TTL)
        .slice(0, USABILITY_MAX);
      _save(USABILITY_KEY, next);
      return next;
    });
  }, []);

  // Phase 1343 + 1345: evaluate isolation + calmness
  const evaluate = useCallback(() => {
    const now = Date.now();

    // Session isolation
    const isos = _checkSessionIsolation(firstSessions, longSessions);
    setSessionIsoViolations(isos);
    if (isos.length) {
      const existing = _load(SESSION_ISO_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < SESSION_ISO_TTL)
        .slice(0, SESSION_ISO_MAX);
      _save(SESSION_ISO_KEY, next);
    }
  }, [firstSessions, longSessions]);

  useEffect(() => {
    const now = Date.now();
    setFirstSessions(_load(SESSION_KEY, []).filter(s => now - (s.ts || 0) < SESSION_TTL));
    setStabilityEvents(_load(STABILITY_KEY, []).filter(e => now - (e.ts || 0) < STABILITY_TTL));
    setLongSessions(_load(LONG_SES_KEY, []).filter(s => now - (s.ts || 0) < LONG_SES_TTL));
    setPlugins(_load(PLUGIN_KEY, []).filter(p => now - (p.ts || 0) < PLUGIN_TTL));
    setTrustEvents(_load(TRUST_KEY, []).filter(e => now - (e.ts || 0) < TRUST_TTL));
    setUsabilityEvents(_load(USABILITY_KEY, []).filter(e => now - (e.ts || 0) < USABILITY_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores ────────────────────────────────────────────────────────
  const sessionScore = useMemo(() => _scoreFirstSessions(firstSessions), [firstSessions]);

  const stabilityResult = useMemo(
    () => _cached(`stability|${Math.floor(stabilityEvents.length / 5)}`, () => _computeStabilityScore(stabilityEvents)),
    [stabilityEvents]
  );

  const longSesScore = useMemo(() => _scoreLongSessions(longSessions), [longSessions]);

  const pluginScore = useMemo(() => _scorePluginReliability(plugins), [plugins]);

  const trustScore = useMemo(
    () => _cached(`trust|${Math.floor(trustEvents.length / 3)}`, () => _computeTrustScore(trustEvents)),
    [trustEvents]
  );

  const usabilityAgg = useMemo(
    () => _cached(`usability|${Math.floor(usabilityEvents.length / 5)}`, () => _aggregateUsability(usabilityEvents)),
    [usabilityEvents]
  );

  const calmnessScore = useMemo(() => _computeCalmness({
    activeBarCount,
    stabilityScore: stabilityResult.score,
    trustScore,
    pluginScore,
    sessionScore,
    isoViolations:  sessionIsoViolations.length,
  }), [activeBarCount, stabilityResult.score, trustScore, pluginScore, sessionScore, sessionIsoViolations.length]);

  // Record calmness snap (Phase 1345)
  useEffect(() => {
    const now = Date.now();
    const snap = { score: calmnessScore, ts: now };
    setCalmnessSnaps(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < CALMNESS_TTL)
        .slice(0, CALMNESS_MAX);
      _save(CALMNESS_KEY, next);
      return next;
    });
  }, [calmnessScore]);

  const productMaturityScore = useMemo(() => _computeProductMaturity({
    sessionScore,
    stabilityScore: stabilityResult.score,
    longSesScore,
    pluginScore,
    trustScore,
    usabilityScore: usabilityAgg.composite,
    calmnessScore,
    isoViolations:  sessionIsoViolations.length,
  }), [
    sessionScore, stabilityResult.score, longSesScore, pluginScore,
    trustScore, usabilityAgg.composite, calmnessScore, sessionIsoViolations.length,
  ]);

  const productMaturityBar = useMemo(() => {
    if (productMaturityScore >= 80 && sessionIsoViolations.length === 0) return null;
    const issue =
      sessionIsoViolations.length ? `Session isolation: ${sessionIsoViolations.length} violation${sessionIsoViolations.length > 1 ? "s" : ""}` :
      stabilityResult.label !== "STABLE" ? `Stability: ${stabilityResult.label}` :
      trustScore < 60 ? `Trust score: ${trustScore}%` :
      pluginScore < 60 ? `Plugin reliability: ${pluginScore}%` :
      null;
    const color = productMaturityScore >= 80 ? "var(--op-green)" : productMaturityScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return {
      score: productMaturityScore,
      issue,
      color,
      hasCrit: productMaturityScore < 50,
    };
  }, [productMaturityScore, sessionIsoViolations.length, stabilityResult.label, trustScore, pluginScore]);

  return {
    initialized,
    firstSessions,
    stabilityEvents,
    longSessions,
    plugins,
    trustEvents,
    usabilityEvents,
    calmnessSnaps,
    sessionIsoViolations,
    sessionScore,
    stabilityResult,
    longSesScore,
    pluginScore,
    trustScore,
    usabilityAgg,
    calmnessScore,
    productMaturityScore,
    productMaturityBar,
    recordFirstSession,
    recordStabilitySignal,
    recordLongSession,
    recordPluginState,
    recordTrustEvent,
    recordUsabilityEvent,
    evaluate,
  };
}
