"use strict";

// Heartbeat-based health tracking for all registered execution adapters.
// Detects stale, degraded, and unresponsive adapters.

const DEFAULT_STALE_THRESHOLD_MS = 30000;   // 30s without heartbeat = stale
const MAX_ERROR_WINDOW           = 50;       // rolling window for error rate
const MAX_ADAPTERS               = 100;
const MAX_HEALTH_HISTORY         = 500;

const HEALTH_STATES = ["healthy", "degraded", "stale", "unavailable"];

let _counter  = 0;
let _adapters = new Map(); // adapterId → health record
let _history  = [];        // historical health events

function _computeState(record) {
  const now = Date.now();
  const age = record.lastHeartbeatAt ? now - new Date(record.lastHeartbeatAt).getTime() : Infinity;
  if (age > record.staleThresholdMs * 3) return "unavailable";
  if (age > record.staleThresholdMs)     return "stale";
  const errRate = record.recentErrors.length / MAX_ERROR_WINDOW;
  if (errRate > 0.5) return "degraded";
  return "healthy";
}

function _computeScore(record) {
  const state = _computeState(record);
  if (state === "unavailable") return 0.0;
  if (state === "stale")       return 0.2;
  const errRate = record.recentErrors.length / MAX_ERROR_WINDOW;
  return Math.max(0, 1.0 - errRate);
}

function registerAdapter(adapterId, {
  adapterType         = "unknown",
  staleThresholdMs    = DEFAULT_STALE_THRESHOLD_MS,
  metadata            = {},
} = {}) {
  if (!adapterId) return { registered: false, reason: "missing_adapter_id" };
  if (_adapters.size >= MAX_ADAPTERS) return { registered: false, reason: "adapter_limit_reached" };
  if (_adapters.has(adapterId)) return { registered: false, reason: "already_registered" };

  _adapters.set(adapterId, {
    adapterId, adapterType, staleThresholdMs,
    lastHeartbeatAt:  null,
    heartbeatCount:   0,
    recentErrors:     [],   // bounded to MAX_ERROR_WINDOW
    totalErrors:      0,
    totalHeartbeats:  0,
    registeredAt:     new Date().toISOString(),
    metadata:         Object.freeze({ ...metadata }),
  });
  return { registered: true, adapterId };
}

function recordHeartbeat(adapterId, { timestampMs = Date.now() } = {}) {
  const r = _adapters.get(adapterId);
  if (!r) return { recorded: false, reason: "adapter_not_found" };
  r.lastHeartbeatAt = new Date(timestampMs).toISOString();
  r.heartbeatCount++;
  r.totalHeartbeats++;
  return { recorded: true, adapterId, heartbeatCount: r.totalHeartbeats };
}

function recordError(adapterId, { error = "unknown_error", severity = "error", timestampMs = Date.now() } = {}) {
  const r = _adapters.get(adapterId);
  if (!r) return { recorded: false, reason: "adapter_not_found" };

  r.recentErrors.push({ error, severity, at: new Date(timestampMs).toISOString() });
  if (r.recentErrors.length > MAX_ERROR_WINDOW) r.recentErrors.shift();
  r.totalErrors++;

  // Record health event to history
  const healthId = `hev-${++_counter}`;
  const entry = Object.freeze({
    healthId, adapterId, event: "error", error, severity,
    state:  _computeState(r),
    score:  _computeScore(r),
    timestamp: new Date(timestampMs).toISOString(),
  });
  _history.unshift(entry);
  if (_history.length > MAX_HEALTH_HISTORY) _history.length = MAX_HEALTH_HISTORY;

  return { recorded: true, adapterId, totalErrors: r.totalErrors };
}

function getHealth(adapterId) {
  const r = _adapters.get(adapterId);
  if (!r) return { found: false };
  const state = _computeState(r);
  const score = _computeScore(r);
  return {
    found: true, adapterId, adapterType: r.adapterType,
    state, score,
    lastHeartbeatAt: r.lastHeartbeatAt,
    heartbeatCount:  r.totalHeartbeats,
    recentErrorCount: r.recentErrors.length,
    totalErrors:     r.totalErrors,
  };
}

// Returns adapters whose lastHeartbeat is older than staleThresholdMs
function detectStale({ nowMs = Date.now() } = {}) {
  const stale = [];
  for (const [, r] of _adapters) {
    if (!r.lastHeartbeatAt) { stale.push({ adapterId: r.adapterId, reason: "never_heartbeated" }); continue; }
    const age = nowMs - new Date(r.lastHeartbeatAt).getTime();
    if (age > r.staleThresholdMs) stale.push({ adapterId: r.adapterId, ageMs: age, threshold: r.staleThresholdMs });
  }
  return stale;
}

function getSystemHealth({ nowMs = Date.now() } = {}) {
  const states = {};
  let totalScore = 0;
  let count = 0;
  for (const [, r] of _adapters) {
    const state = _computeState(r);
    const score = _computeScore(r);
    states[state] = (states[state] ?? 0) + 1;
    totalScore += score;
    count++;
  }
  return {
    adapterCount:    count,
    avgHealthScore:  count ? +(totalScore / count).toFixed(3) : 1.0,
    stateDistribution: states,
    staleAdapters:   detectStale({ nowMs }).length,
  };
}

function getHealthHistory(adapterId = null, limit = 50) {
  const filtered = adapterId ? _history.filter(e => e.adapterId === adapterId) : _history;
  return filtered.slice(0, limit);
}

function deregisterAdapter(adapterId) {
  if (!_adapters.has(adapterId)) return { deregistered: false, reason: "adapter_not_found" };
  _adapters.delete(adapterId);
  return { deregistered: true, adapterId };
}

function getHealthMetrics() {
  return {
    totalRegistered:  _adapters.size,
    historySize:      _history.length,
    ...getSystemHealth(),
  };
}

function reset() {
  _counter  = 0;
  _adapters = new Map();
  _history  = [];
}

module.exports = {
  registerAdapter, recordHeartbeat, recordError, getHealth,
  detectStale, getSystemHealth, getHealthHistory, deregisterAdapter,
  getHealthMetrics, reset,
  DEFAULT_STALE_THRESHOLD_MS,
};
