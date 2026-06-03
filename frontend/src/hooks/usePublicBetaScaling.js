// Phases 1531-1541: Public beta scaling + production hardening —
// traffic management, session stability, UX validation, performance observability,
// support scaling, incident response, trust/retention, multi-tenant isolation,
// platform optimization, stress test, UX calmness audit.
//
// No external calls. No autonomous execution. localStorage-only.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const PBS_TRAFFIC_KEY   = "jarvis_pbs_traffic";
const PBS_SESSION_KEY   = "jarvis_pbs_sessions";
const PBS_UX_KEY        = "jarvis_pbs_ux";
const PBS_PERF_KEY      = "jarvis_pbs_perf";
const PBS_SUPPORT_KEY   = "jarvis_pbs_support";
const PBS_INCIDENTS_KEY = "jarvis_pbs_incidents";
const PBS_TRUST_KEY     = "jarvis_pbs_trust";
const PBS_TENANT_KEY    = "jarvis_pbs_tenants";
const PBS_ISO_KEY       = "jarvis_pbs_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_TRAFFIC   = 30;
const MAX_SESSIONS  = 30;
const MAX_UX        = 20;
const MAX_PERF      = 30;
const MAX_SUPPORT   = 20;
const MAX_INCIDENTS = 20;
const MAX_TRUST     = 30;
const MAX_TENANTS   = 30;

// Phase 1531: traffic management
const VALID_TRAFFIC_TYPES = new Set([
  "request_rate", "error_rate", "latency_p50", "latency_p99",
  "availability", "bandwidth", "queue_depth", "concurrency",
]);

// Phase 1532: session stability
const VALID_SESSION_STAGES = ["active", "idle", "reconnecting", "recovered", "terminated"];

// Phase 1533: UX signal types
const VALID_UX_TYPES = new Set([
  "onboarding_step", "workflow_completion", "trust_event",
  "replay_continuity", "runtime_durability", "ecosystem_response",
]);

// Phase 1535: support ticket stages
const VALID_SUPPORT_STAGES = ["open", "triaging", "in_progress", "escalated", "resolved", "closed"];

// Phase 1536: incident stages
const VALID_INCIDENT_STAGES = ["detected", "investigating", "mitigating", "resolved", "post_mortem"];

// Phase 1537: trust dimensions
const VALID_TRUST_DIMS = new Set([
  "onboarding_quality", "deployment_smoothness", "incident_recovery",
  "ecosystem_durability", "runtime_reliability", "ui_calmness",
]);

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

// ── Isolation scanner (Phase 1538) ────────────────────────────────────────────

const PBS_PREFIX = "jarvis_pbs_";
const PBS_OWNED = new Set([
  PBS_TRAFFIC_KEY, PBS_SESSION_KEY, PBS_UX_KEY, PBS_PERF_KEY,
  PBS_SUPPORT_KEY, PBS_INCIDENTS_KEY, PBS_TRUST_KEY, PBS_TENANT_KEY, PBS_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PBS_PREFIX) && !PBS_OWNED.has(k)) unknown.push(k);
    }
  } catch {}
  return unknown;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function _trafficScore(traffic) {
  if (!traffic.length) return 100;
  const avail = traffic.filter(t => t.type === "availability");
  if (!avail.length) return 100;
  const latest = avail.sort((a, b) => b.ts - a.ts)[0];
  if (latest.value < 0.95) return 40;
  if (latest.value < 0.99) return 70;
  return 100;
}

function _sessionScore(sessions) {
  if (!sessions.length) return 100;
  const active = sessions.filter(s => s.stage === "active").length;
  const reconnecting = sessions.filter(s => s.stage === "reconnecting").length;
  if (reconnecting > active * 0.3) return 50;
  if (reconnecting > active * 0.1) return 75;
  return 100;
}

function _uxScore(ux) {
  if (!ux.length) return 100;
  const scores = ux.map(u => u.score ?? 100);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(Math.min(100, Math.max(0, avg)));
}

function _supportScore(support) {
  if (!support.length) return 100;
  const escalated = support.filter(s => s.stage === "escalated" && !s.operatorApproved).length;
  if (escalated > 3) return 40;
  if (escalated > 0) return 70;
  return 100;
}

function _incidentScore(incidents) {
  if (!incidents.length) return 100;
  const active = incidents.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage));
  if (!active.length) return 100;
  const p0 = active.filter(i => i.severity === "p0").length;
  const p1 = active.filter(i => i.severity === "p1").length;
  if (p0 > 0) return Math.max(0, 100 - p0 * 40);
  if (p1 > 0) return Math.max(0, 100 - p1 * 20);
  return Math.max(60, 100 - active.length * 10);
}

function _trustScore(trust) {
  if (!trust.length) return 100;
  const vals = trust.map(t => t.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function _tenantScore(tenants) {
  if (!tenants.length) return 100;
  const contaminated = tenants.filter(t => t.crossContamination).length;
  if (contaminated > 0) return Math.max(0, 100 - contaminated * 25);
  return 100;
}

// ── Composite scoring + status bar ───────────────────────────────────────────

function _computePBSBar({
  trafficScore, sessionScore, uxScore, supportScore,
  incidentScore: inc, trustScore: trust, tenantScore, isoViolations,
}) {
  const score = Math.round(
    inc       * 0.25 +
    trust     * 0.20 +
    trafficScore * 0.15 +
    sessionScore * 0.15 +
    tenantScore  * 0.10 +
    uxScore      * 0.10 +
    supportScore * 0.05
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || inc < 40 || tenantScore < 60;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (isoViolations > 0) issue = `Tenant isolation: ${isoViolations} unknown keys`;
  else if (inc < 40)       issue = "Active P0 incidents";
  else if (tenantScore < 60) issue = "Tenant contamination detected";
  else if (trafficScore < 60) issue = `Availability degraded`;
  else if (sessionScore < 60) issue = "Session reconnect storm";
  else if (trust < 60)     issue = `User trust: ${trust}%`;

  return { score: clamped, hasCrit, color, issue };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePublicBetaScaling() {
  const [traffic,   setTraffic]   = useState(() => _load(PBS_TRAFFIC_KEY,   []));
  const [sessions,  setSessions]  = useState(() => _load(PBS_SESSION_KEY,   []));
  const [ux,        setUx]        = useState(() => _load(PBS_UX_KEY,        []));
  const [perf,      setPerf]      = useState(() => _load(PBS_PERF_KEY,      []));
  const [support,   setSupport]   = useState(() => _load(PBS_SUPPORT_KEY,   []));
  const [incidents, setIncidents] = useState(() => _load(PBS_INCIDENTS_KEY, []));
  const [trust,     setTrust]     = useState(() => _load(PBS_TRUST_KEY,     []));
  const [tenants,   setTenants]   = useState(() => _load(PBS_TENANT_KEY,    []));
  const [isoViolations, setIsoViolations] = useState([]);

  // anti-burst refs
  const _recentUpdates = useRef(new Map());

  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1531: traffic write ──────────────────────────────────────────────
  const recordTraffic = useCallback((entry = {}) => {
    const { type, env = "prod", value } = entry;
    if (!VALID_TRAFFIC_TYPES.has(type) || value === undefined) return;
    const now = Date.now();
    setTraffic(prev => {
      const dedupKey = `${type}:${env}`;
      const last = prev.find(t => `${t.type}:${t.env}` === dedupKey);
      if (last && now - (last.ts || 0) < 30_000) return prev;
      const next = [{ type, env, value, ts: now }, ...prev]
        .filter(t => now - (t.ts || 0) < TTL_24H)
        .slice(0, MAX_TRAFFIC);
      _save(PBS_TRAFFIC_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1532: session write ──────────────────────────────────────────────
  const recordSession = useCallback((entry = {}) => {
    const { sessionId, stage, durationMs } = entry;
    if (!sessionId || !VALID_SESSION_STAGES.includes(stage)) return;
    if (!_burstGuard(sessionId)) return;
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
          .filter(s => now - (s.ts || 0) < TTL_24H)
          .slice(0, MAX_SESSIONS);
        _save(PBS_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, ts: now, ...(durationMs ? { durationMs } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_24H)
        .slice(0, MAX_SESSIONS);
      _save(PBS_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1533: UX signal write ───────────────────────────────────────────
  const recordUXSignal = useCallback((entry = {}) => {
    const { type, score, label } = entry;
    if (!VALID_UX_TYPES.has(type)) return;
    if (score !== undefined && (score < 0 || score > 100)) return;
    const now = Date.now();
    setUx(prev => {
      const next = [{ type, score: score ?? 100, label: label || type, ts: now }, ...prev]
        .filter(u => now - (u.ts || 0) < TTL_7D)
        .slice(0, MAX_UX);
      _save(PBS_UX_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1534: perf observation write ───────────────────────────────────
  const recordPerfObs = useCallback((entry = {}) => {
    const { metric, value, env = "prod" } = entry;
    if (!metric || value === undefined) return;
    const now = Date.now();
    setPerf(prev => {
      const dedupKey = `${metric}:${env}`;
      const last = prev.find(p => `${p.metric}:${p.env}` === dedupKey);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ metric, value, env, ts: now }, ...prev]
        .filter(p => now - (p.ts || 0) < TTL_24H)
        .slice(0, MAX_PERF);
      _save(PBS_PERF_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1535: support write ─────────────────────────────────────────────
  const recordSupport = useCallback((entry = {}) => {
    const { ticketId, stage, operatorApproved } = entry;
    if (!ticketId || !VALID_SUPPORT_STAGES.includes(stage)) return;
    if (!_burstGuard(`support:${ticketId}`)) return;
    const now = Date.now();
    setSupport(prev => {
      const idx = prev.findIndex(s => s.ticketId === ticketId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_SUPPORT_STAGES.indexOf(cur.stage);
        const newIdx = VALID_SUPPORT_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        if (stage === "escalated" && !operatorApproved) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(operatorApproved ? { operatorApproved: true } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SUPPORT);
        _save(PBS_SUPPORT_KEY, next);
        return next;
      }
      if (stage === "escalated" && !operatorApproved) return prev;
      const next = [{ ticketId, stage, ts: now, ...(operatorApproved ? { operatorApproved: true } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SUPPORT);
      _save(PBS_SUPPORT_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1536: incident write ────────────────────────────────────────────
  const recordIncident = useCallback((entry = {}) => {
    const { incidentId, stage, severity = "p2" } = entry;
    if (!incidentId || !VALID_INCIDENT_STAGES.includes(stage)) return;
    if (!_burstGuard(`incident:${incidentId}`)) return;
    const now = Date.now();
    setIncidents(prev => {
      const idx = prev.findIndex(i => i.incidentId === incidentId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_INCIDENT_STAGES.indexOf(cur.stage);
        const newIdx = VALID_INCIDENT_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, severity, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(i => now - (i.ts || 0) < TTL_7D)
          .slice(0, MAX_INCIDENTS);
        _save(PBS_INCIDENTS_KEY, next);
        return next;
      }
      const next = [{ incidentId, stage, severity, ts: now }, ...prev]
        .filter(i => now - (i.ts || 0) < TTL_7D)
        .slice(0, MAX_INCIDENTS);
      _save(PBS_INCIDENTS_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1537: trust write ───────────────────────────────────────────────
  const recordTrust = useCallback((entry = {}) => {
    const { dim, score, userId } = entry;
    if (!VALID_TRUST_DIMS.has(dim) || score === undefined) return;
    if (score < 0 || score > 100) return;
    const now = Date.now();
    setTrust(prev => {
      const dedupKey = `${dim}:${userId || "anon"}`;
      const last = prev.find(t => `${t.dim}:${t.userId || "anon"}` === dedupKey);
      if (last && now - (last.ts || 0) < 5 * 60 * 1000) return prev;
      const next = [{ dim, score, ts: now }, ...prev]
        .filter(t => now - (t.ts || 0) < TTL_7D)
        .slice(0, MAX_TRUST);
      _save(PBS_TRUST_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1538: tenant isolation write ────────────────────────────────────
  const recordTenant = useCallback((entry = {}) => {
    const { tenantId, crossContamination = false, partitionKey } = entry;
    if (!tenantId) return;
    const now = Date.now();
    setTenants(prev => {
      const idx = prev.findIndex(t => t.tenantId === tenantId);
      if (idx !== -1) {
        const updated = { ...prev[idx], crossContamination, partitionKey, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(t => now - (t.ts || 0) < TTL_7D)
          .slice(0, MAX_TENANTS);
        _save(PBS_TENANT_KEY, next);
        return next;
      }
      const next = [{ tenantId, crossContamination, partitionKey, ts: now }, ...prev]
        .filter(t => now - (t.ts || 0) < TTL_7D)
        .slice(0, MAX_TENANTS);
      _save(PBS_TENANT_KEY, next);
      return next;
    });
  }, []);

  // ── Isolation scan (Phase 1538) ───────────────────────────────────────────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setIsoViolations(_scanIso());
    };
    setIsoViolations(_scanIso());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Derived scores (Phase 1539: coarse dep-keys for perf) ────────────────
  const trafficCount  = Math.floor(traffic.length  / 5);
  const sessionCount  = Math.floor(sessions.length / 5);
  const uxCount       = Math.floor(ux.length       / 3);
  const supportCount  = Math.floor(support.length  / 3);
  const incidentCount = Math.floor(incidents.length / 3);
  const trustCount    = Math.floor(trust.length    / 5);
  const tenantCount   = Math.floor(tenants.length  / 5);

  const trafficScore  = useMemo(() => _trafficScore(traffic),   [trafficCount]);   // eslint-disable-line
  const sessionScore  = useMemo(() => _sessionScore(sessions),  [sessionCount]);   // eslint-disable-line
  const uxScore       = useMemo(() => _uxScore(ux),             [uxCount]);        // eslint-disable-line
  const supportScore  = useMemo(() => _supportScore(support),   [supportCount]);   // eslint-disable-line
  const incScore      = useMemo(() => _incidentScore(incidents), [incidentCount]);  // eslint-disable-line
  const trustScoreVal = useMemo(() => _trustScore(trust),       [trustCount]);     // eslint-disable-line
  const tenantScore   = useMemo(() => _tenantScore(tenants),    [tenantCount]);    // eslint-disable-line

  const pbsBar = useMemo(() => _cached("pbs_bar", () =>
    _computePBSBar({
      trafficScore, sessionScore, uxScore, supportScore,
      incidentScore: incScore, trustScore: trustScoreVal,
      tenantScore, isoViolations: isoViolations.length,
    })
  ), [trafficScore, sessionScore, uxScore, supportScore, incScore, trustScoreVal, tenantScore, isoViolations.length]);

  // Phase 1540: stress test summary (observable, not triggered autonomously)
  const stressProfile = useMemo(() => {
    const activeSessions   = sessions.filter(s => s.stage === "active").length;
    const reconnecting     = sessions.filter(s => s.stage === "reconnecting").length;
    const activeIncidents  = incidents.filter(i => ["detected", "investigating", "mitigating"].includes(i.stage)).length;
    const openSupport      = support.filter(s => !["resolved", "closed"].includes(s.stage)).length;
    const contamination    = tenants.filter(t => t.crossContamination).length;
    return { activeSessions, reconnecting, activeIncidents, openSupport, contamination };
  }, [sessionCount, incidentCount, supportCount, tenantCount]); // eslint-disable-line

  // Phase 1541: UX calmness (derived, no side effects)
  const uxCalmness = useMemo(() => {
    if (!ux.length) return { score: 100, label: "CALM" };
    const recent = ux.filter(u => Date.now() - (u.ts || 0) < TTL_24H);
    if (!recent.length) return { score: 100, label: "CALM" };
    const avg = recent.reduce((a, u) => a + (u.score ?? 100), 0) / recent.length;
    const score = Math.round(avg);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [uxCount]); // eslint-disable-line

  return {
    // scores
    pbsBar,
    pbsScore: pbsBar.score,
    trafficScore,
    sessionScore,
    uxScore,
    supportScore,
    incidentScore: incScore,
    trustScore: trustScoreVal,
    tenantScore,
    pbsIsoViolations: isoViolations,
    // Phase 1540-1541
    stressProfile,
    uxCalmness,
    // writers
    recordTraffic,
    recordSession,
    recordUXSignal,
    recordPerfObs,
    recordSupport,
    recordIncident,
    recordTrust,
    recordTenant,
  };
}
