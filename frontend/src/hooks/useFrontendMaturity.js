// Phases 1546-1557: Real product experience + frontend maturity —
// UX foundation, onboarding, dashboard polish, mobile responsiveness,
// productivity flow, session durability, UX observability, support experience,
// multi-tenant UI isolation, product performance, stress test, UX calmness audit.
//
// No external calls. No autonomous execution. localStorage-only.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const FEM_UX_KEY        = "jarvis_fem_ux";
const FEM_ONBOARD_KEY   = "jarvis_fem_onboarding";
const FEM_DASHBOARD_KEY = "jarvis_fem_dashboard";
const FEM_MOBILE_KEY    = "jarvis_fem_mobile";
const FEM_SESSION_KEY   = "jarvis_fem_sessions";
const FEM_SUPPORT_KEY   = "jarvis_fem_support";
const FEM_TENANT_KEY    = "jarvis_fem_tenants";
const FEM_PERF_KEY      = "jarvis_fem_perf";
const FEM_ISO_KEY       = "jarvis_fem_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_UX        = 20;
const MAX_ONBOARD   = 20;
const MAX_DASHBOARD = 20;
const MAX_MOBILE    = 20;
const MAX_SESSIONS  = 30;
const MAX_SUPPORT   = 20;
const MAX_TENANTS   = 30;
const MAX_PERF      = 30;

// Phase 1546: UX signal types
const VALID_UX_TYPES = new Set([
  "workflow_clarity", "nav_smoothness", "dashboard_readability",
  "replay_continuity", "session_restoration", "operational_calmness",
]);

// Phase 1547: onboarding stages (forward-only)
const VALID_ONBOARD_STAGES = ["not_started", "step_1", "step_2", "step_3", "complete", "stalled"];

// Phase 1548: dashboard quality dimensions
const VALID_DASH_DIMS = new Set([
  "workflow_visibility", "deployment_readability", "operational_priority",
  "ecosystem_nav", "contextual_focus",
]);

// Phase 1549: mobile signal types
const VALID_MOBILE_TYPES = new Set([
  "layout_stability", "workflow_visibility", "onboarding_responsiveness",
  "mobile_hydration", "session_continuity",
]);

// Phase 1551: session durability stages (forward-only)
const VALID_SESSION_STAGES = ["started", "active", "long_running", "recovering", "terminated"];

// Phase 1553: support stages (forward-only)
const VALID_SUPPORT_STAGES = ["open", "triaging", "in_progress", "escalated", "resolved", "closed"];

// Phase 1554: tenant isolation check
const VALID_TENANT_DIMS = new Set(["dashboard_state", "workflow_state", "replay_state", "session_state"]);

// ── LRU cache ─────────────────────────────────────────────────────────────────

const _lru = new Map();
const LRU_TTL = 30_000;
const LRU_MAX = 50;
function _cached(key, fn) {
  const now = Date.now();
  const hit = _lru.get(key);
  if (hit && now - hit.ts < LRU_TTL) return hit.val;
  const val = fn();
  if (_lru.size >= LRU_MAX) _lru.delete(_lru.keys().next().value);
  _lru.set(key, { val, ts: now });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Isolation scanner (Phase 1554) ────────────────────────────────────────────

const FEM_PREFIX = "jarvis_fem_";
const FEM_OWNED = new Set([
  FEM_UX_KEY, FEM_ONBOARD_KEY, FEM_DASHBOARD_KEY, FEM_MOBILE_KEY,
  FEM_SESSION_KEY, FEM_SUPPORT_KEY, FEM_TENANT_KEY, FEM_PERF_KEY, FEM_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(FEM_PREFIX) && !FEM_OWNED.has(k)) unknown.push(k);
    }
  } catch {}
  return unknown;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function _uxScore(ux) {
  if (!ux.length) return 100;
  const vals = ux.map(u => u.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function _onboardScore(onboard) {
  if (!onboard.length) return 100;
  const stalled = onboard.filter(o => o.stage === "stalled").length;
  const total   = onboard.length;
  if (stalled / total > 0.3) return 40;
  if (stalled / total > 0.1) return 70;
  return 100;
}

function _dashScore(dashboard) {
  if (!dashboard.length) return 100;
  const vals = dashboard.map(d => d.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function _mobileScore(mobile) {
  if (!mobile.length) return 100;
  const unstable = mobile.filter(m => m.type === "layout_stability" && (m.score ?? 100) < 60).length;
  if (unstable > 2) return 40;
  if (unstable > 0) return 70;
  const vals = mobile.map(m => m.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function _sessionDurabilityScore(sessions) {
  if (!sessions.length) return 100;
  const recovering = sessions.filter(s => s.stage === "recovering").length;
  const total      = sessions.length;
  if (recovering / total > 0.3) return 50;
  if (recovering / total > 0.1) return 75;
  return 100;
}

function _supportScore(support) {
  if (!support.length) return 100;
  const unapproved = support.filter(s => s.stage === "escalated" && !s.operatorApproved).length;
  if (unapproved > 3) return 40;
  if (unapproved > 0) return 70;
  return 100;
}

function _tenantScore(tenants) {
  if (!tenants.length) return 100;
  const contaminated = tenants.filter(t => t.contaminated).length;
  if (contaminated > 0) return Math.max(0, 100 - contaminated * 25);
  return 100;
}

// ── Composite bar ─────────────────────────────────────────────────────────────

function _computeFEMBar({
  uxScore, onboardScore, dashScore, mobileScore,
  sessionScore, supportScore, tenantScore, isoViolations,
}) {
  const score = Math.round(
    uxScore       * 0.20 +
    onboardScore  * 0.20 +
    sessionScore  * 0.15 +
    dashScore     * 0.15 +
    tenantScore   * 0.15 +
    mobileScore   * 0.10 +
    supportScore  * 0.05
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || tenantScore < 60 || onboardScore < 40;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (isoViolations > 0)    issue = `FEM isolation: ${isoViolations} unknown keys`;
  else if (tenantScore < 60) issue = "Tenant UI contamination";
  else if (onboardScore < 40) issue = "Onboarding stall rate critical";
  else if (sessionScore < 60) issue = "Session recovery rate elevated";
  else if (mobileScore < 60)  issue = "Mobile layout instability";
  else if (uxScore < 60)      issue = `UX quality: ${uxScore}%`;

  return { score: clamped, hasCrit, color, issue };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useFrontendMaturity() {
  const [ux,        setUx]        = useState(() => _load(FEM_UX_KEY,        []));
  const [onboard,   setOnboard]   = useState(() => _load(FEM_ONBOARD_KEY,   []));
  const [dashboard, setDashboard] = useState(() => _load(FEM_DASHBOARD_KEY, []));
  const [mobile,    setMobile]    = useState(() => _load(FEM_MOBILE_KEY,    []));
  const [sessions,  setSessions]  = useState(() => _load(FEM_SESSION_KEY,   []));
  const [support,   setSupport]   = useState(() => _load(FEM_SUPPORT_KEY,   []));
  const [tenants,   setTenants]   = useState(() => _load(FEM_TENANT_KEY,    []));
  const [perf,      setPerf]      = useState(() => _load(FEM_PERF_KEY,      []));
  const [isoViolations, setIsoViolations] = useState([]);

  const _recentUpdates = useRef(new Map());
  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1546: UX signal write ───────────────────────────────────────────
  const recordUX = useCallback((entry = {}) => {
    const { type, score } = entry;
    if (!VALID_UX_TYPES.has(type)) return;
    if (score !== undefined && (score < 0 || score > 100)) return;
    const now = Date.now();
    setUx(prev => {
      const dedupKey = type;
      const last = prev.find(u => u.type === dedupKey);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ type, score: score ?? 100, ts: now }, ...prev]
        .filter(u => now - (u.ts || 0) < TTL_7D)
        .slice(0, MAX_UX);
      _save(FEM_UX_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1547: onboarding write ─────────────────────────────────────────
  const recordOnboarding = useCallback((entry = {}) => {
    const { userId, stage } = entry;
    if (!userId || !VALID_ONBOARD_STAGES.includes(stage)) return;
    if (!_burstGuard(`onboard:${userId}`)) return;
    const now = Date.now();
    setOnboard(prev => {
      const idx = prev.findIndex(o => o.userId === userId);
      if (idx !== -1) {
        const cur = prev[idx];
        if (stage !== "stalled") {
          const curIdx = VALID_ONBOARD_STAGES.indexOf(cur.stage);
          const newIdx = VALID_ONBOARD_STAGES.indexOf(stage);
          if (newIdx < curIdx) return prev;
        }
        const updated = { ...cur, stage, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(o => now - (o.ts || 0) < TTL_7D)
          .slice(0, MAX_ONBOARD);
        _save(FEM_ONBOARD_KEY, next);
        return next;
      }
      const next = [{ userId, stage, ts: now }, ...prev]
        .filter(o => now - (o.ts || 0) < TTL_7D)
        .slice(0, MAX_ONBOARD);
      _save(FEM_ONBOARD_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1548: dashboard quality write ──────────────────────────────────
  const recordDashboard = useCallback((entry = {}) => {
    const { dim, score } = entry;
    if (!VALID_DASH_DIMS.has(dim)) return;
    if (score !== undefined && (score < 0 || score > 100)) return;
    const now = Date.now();
    setDashboard(prev => {
      const last = prev.find(d => d.dim === dim);
      if (last && now - (last.ts || 0) < 5 * 60 * 1000) return prev;
      const next = [{ dim, score: score ?? 100, ts: now }, ...prev]
        .filter(d => now - (d.ts || 0) < TTL_7D)
        .slice(0, MAX_DASHBOARD);
      _save(FEM_DASHBOARD_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1549: mobile signal write ──────────────────────────────────────
  const recordMobile = useCallback((entry = {}) => {
    const { type, score, viewport } = entry;
    if (!VALID_MOBILE_TYPES.has(type)) return;
    if (score !== undefined && (score < 0 || score > 100)) return;
    const now = Date.now();
    setMobile(prev => {
      const dedupKey = `${type}:${viewport || "default"}`;
      const last = prev.find(m => `${m.type}:${m.viewport || "default"}` === dedupKey);
      if (last && now - (last.ts || 0) < 30_000) return prev;
      const next = [{ type, score: score ?? 100, viewport, ts: now }, ...prev]
        .filter(m => now - (m.ts || 0) < TTL_24H)
        .slice(0, MAX_MOBILE);
      _save(FEM_MOBILE_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1550+1551: session durability write ─────────────────────────────
  const recordSession = useCallback((entry = {}) => {
    const { sessionId, stage, durationMs } = entry;
    if (!sessionId || !VALID_SESSION_STAGES.includes(stage)) return;
    if (!_burstGuard(`session:${sessionId}`)) return;
    const now = Date.now();
    setSessions(prev => {
      const idx = prev.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_SESSION_STAGES.indexOf(cur.stage);
        const newIdx = VALID_SESSION_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(durationMs ? { durationMs } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SESSIONS);
        _save(FEM_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, ts: now, ...(durationMs ? { durationMs } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SESSIONS);
      _save(FEM_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1553: support write ─────────────────────────────────────────────
  const recordSupport = useCallback((entry = {}) => {
    const { ticketId, stage, operatorApproved } = entry;
    if (!ticketId || !VALID_SUPPORT_STAGES.includes(stage)) return;
    if (!_burstGuard(`support:${ticketId}`)) return;
    if (stage === "escalated" && !operatorApproved) return;
    const now = Date.now();
    setSupport(prev => {
      const idx = prev.findIndex(s => s.ticketId === ticketId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_SUPPORT_STAGES.indexOf(cur.stage);
        const newIdx = VALID_SUPPORT_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(operatorApproved ? { operatorApproved: true } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SUPPORT);
        _save(FEM_SUPPORT_KEY, next);
        return next;
      }
      const next = [{ ticketId, stage, ts: now, ...(operatorApproved ? { operatorApproved: true } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SUPPORT);
      _save(FEM_SUPPORT_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1554: tenant UI isolation write ────────────────────────────────
  const recordTenant = useCallback((entry = {}) => {
    const { tenantId, dim, contaminated = false } = entry;
    if (!tenantId || !VALID_TENANT_DIMS.has(dim)) return;
    const now = Date.now();
    setTenants(prev => {
      const idx = prev.findIndex(t => t.tenantId === tenantId && t.dim === dim);
      if (idx !== -1) {
        const updated = { ...prev[idx], contaminated, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(t => now - (t.ts || 0) < TTL_7D)
          .slice(0, MAX_TENANTS);
        _save(FEM_TENANT_KEY, next);
        return next;
      }
      const next = [{ tenantId, dim, contaminated, ts: now }, ...prev]
        .filter(t => now - (t.ts || 0) < TTL_7D)
        .slice(0, MAX_TENANTS);
      _save(FEM_TENANT_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1555: perf observation write ───────────────────────────────────
  const recordPerf = useCallback((entry = {}) => {
    const { metric, value, context = "prod" } = entry;
    if (!metric || value === undefined) return;
    const now = Date.now();
    setPerf(prev => {
      const dedupKey = `${metric}:${context}`;
      const last = prev.find(p => `${p.metric}:${p.context}` === dedupKey);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ metric, value, context, ts: now }, ...prev]
        .filter(p => now - (p.ts || 0) < TTL_24H)
        .slice(0, MAX_PERF);
      _save(FEM_PERF_KEY, next);
      return next;
    });
  }, []);

  // ── Isolation scan ────────────────────────────────────────────────────────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setIsoViolations(_scanIso());
    };
    setIsoViolations(_scanIso());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Coarse dep-keys (Phase 1555 perf) ────────────────────────────────────
  const uxCount       = Math.floor(ux.length       / 3);
  const onboardCount  = Math.floor(onboard.length  / 3);
  const dashCount     = Math.floor(dashboard.length / 3);
  const mobileCount   = Math.floor(mobile.length   / 3);
  const sessionCount  = Math.floor(sessions.length / 5);
  const supportCount  = Math.floor(support.length  / 3);
  const tenantCount   = Math.floor(tenants.length  / 5);

  const uxScoreVal      = useMemo(() => _uxScore(ux),             [uxCount]);       // eslint-disable-line
  const onboardScoreVal = useMemo(() => _onboardScore(onboard),   [onboardCount]);  // eslint-disable-line
  const dashScoreVal    = useMemo(() => _dashScore(dashboard),    [dashCount]);     // eslint-disable-line
  const mobileScoreVal  = useMemo(() => _mobileScore(mobile),     [mobileCount]);   // eslint-disable-line
  const sessionScoreVal = useMemo(() => _sessionDurabilityScore(sessions), [sessionCount]); // eslint-disable-line
  const supportScoreVal = useMemo(() => _supportScore(support),   [supportCount]);  // eslint-disable-line
  const tenantScoreVal  = useMemo(() => _tenantScore(tenants),    [tenantCount]);   // eslint-disable-line

  const femBar = useMemo(() => _cached("fem_bar", () =>
    _computeFEMBar({
      uxScore: uxScoreVal, onboardScore: onboardScoreVal, dashScore: dashScoreVal,
      mobileScore: mobileScoreVal, sessionScore: sessionScoreVal,
      supportScore: supportScoreVal, tenantScore: tenantScoreVal,
      isoViolations: isoViolations.length,
    })
  ), [uxScoreVal, onboardScoreVal, dashScoreVal, mobileScoreVal, sessionScoreVal, supportScoreVal, tenantScoreVal, isoViolations.length]);

  // Phase 1556: stress profile (observable, no side effects)
  const stressProfile = useMemo(() => {
    const stalledOnboard = onboard.filter(o => o.stage === "stalled").length;
    const recoveringSess = sessions.filter(s => s.stage === "recovering").length;
    const openSupport    = support.filter(s => !["resolved", "closed"].includes(s.stage)).length;
    const contamination  = tenants.filter(t => t.contaminated).length;
    return { stalledOnboard, recoveringSess, openSupport, contamination };
  }, [onboardCount, sessionCount, supportCount, tenantCount]); // eslint-disable-line

  // Phase 1557: UX calmness audit
  const uxCalmness = useMemo(() => {
    if (!ux.length) return { score: 100, label: "CALM" };
    const recent = ux.filter(u => Date.now() - (u.ts || 0) < TTL_24H);
    if (!recent.length) return { score: 100, label: "CALM" };
    const avg = recent.reduce((a, u) => a + (u.score ?? 100), 0) / recent.length;
    const score = Math.round(avg);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [uxCount]); // eslint-disable-line

  return {
    femBar,
    femScore: femBar.score,
    uxScore:       uxScoreVal,
    onboardScore:  onboardScoreVal,
    dashScore:     dashScoreVal,
    mobileScore:   mobileScoreVal,
    sessionScore:  sessionScoreVal,
    supportScore:  supportScoreVal,
    tenantScore:   tenantScoreVal,
    femIsoViolations: isoViolations,
    stressProfile,
    uxCalmness,
    recordUX,
    recordOnboarding,
    recordDashboard,
    recordMobile,
    recordSession,
    recordSupport,
    recordTenant,
    recordPerf,
  };
}
