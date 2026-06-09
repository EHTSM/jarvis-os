"use strict";
/**
 * driftMonitor — long-session leak and drift detection.
 *
 * Samples process-level counters every SAMPLE_MS. Tracks:
 *   - Heap / RSS growth (leak indicator)
 *   - Active handle count (timer/socket leak indicator)
 *   - Process listener count (EventEmitter leak indicator)
 *   - Reconnect frequency (SSE storm indicator)
 *   - Queue depth drift (backlog growth indicator)
 *   - Active execution count (exec leak indicator)
 *   - Orphan process count (shell leak indicator)
 *
 * All detection is passive — no patching, no monkey-patching.
 * External callers (SSE stream, orchestrator) call recordReconnect(),
 * recordExecStarted()/recordExecFinished(), recordOrphan() to feed counters.
 */

const { EventEmitter } = require("events");

const SAMPLE_MS          = 30_000;   // sample every 30s
const HISTORY_SAMPLES    = 240;      // 2h of 30s samples
const LISTENER_DRIFT_MAX = 50;
const HEAP_DRIFT_MB      = 80;
const TIMER_DRIFT_WARN   = 200;
const RECONNECT_RATE_WARN = 10;     // reconnects per 5-min window
const EXEC_LEAK_WARN     = 30;      // concurrent active execs
const QUEUE_DRIFT_WARN   = 40;      // queue depth sustained above this
const ORPHAN_WARN        = 5;       // orphan processes at one sample

let _baseline = null;
let _samples  = [];
let _alerts   = [];
let _ref      = null;

// ── External-feed counters ─────────────────────────────────────────
// These are incremented by other modules via the public API.
const _counters = {
  reconnectsTotal:  0,
  reconnectTimes:   [],   // timestamps for rate window
  execActive:       0,    // currently running executions
  execTotalStarted: 0,
  execTotalFinished: 0,
  orphansDetected:  0,
  queueDepthSamples: [],  // last 20 queue depth readings
};

// ── Sample ─────────────────────────────────────────────────────────
function _sample() {
  try {
    const m          = process.memoryUsage();
    const heapMb     = +(m.heapUsed / 1_048_576).toFixed(1);
    const rssMb      = +(m.rss      / 1_048_576).toFixed(1);
    const timerCount = process._getActiveHandles?.().length ?? 0;
    const reqCount   = process._getActiveRequests?.().length ?? 0;

    const listenerCount =
      EventEmitter.listenerCount(process, "exit") +
      EventEmitter.listenerCount(process, "uncaughtException") +
      EventEmitter.listenerCount(process, "unhandledRejection") +
      EventEmitter.listenerCount(process, "SIGTERM");

    // Reconnect rate in last 5 min
    const now = Date.now();
    _counters.reconnectTimes = _counters.reconnectTimes.filter(t => now - t < 5 * 60_000);
    const reconnectRate = _counters.reconnectTimes.length;

    // Queue depth — lazy-read from orchestrator to avoid circular dep at load time
    let queueDepth = 0;
    try {
      const pq = require("./priorityQueue.cjs");
      queueDepth = pq.size();
      _counters.queueDepthSamples.push(queueDepth);
      if (_counters.queueDepthSamples.length > 20) _counters.queueDepthSamples.shift();
    } catch {}

    const snap = {
      ts: now, heapMb, rssMb, listenerCount,
      timerCount, reqCount, reconnectRate,
      execActive: _counters.execActive,
      queueDepth,
      orphans: _counters.orphansDetected,
    };
    _samples.push(snap);
    if (_samples.length > HISTORY_SAMPLES) _samples.shift();

    if (!_baseline) { _baseline = snap; return; }

    // ── Threshold checks ───────────────────────────────────────────
    const heapDrift     = snap.heapMb - _baseline.heapMb;
    const listenerDrift = snap.listenerCount - _baseline.listenerCount;

    if (heapDrift > HEAP_DRIFT_MB)
      _addAlert("heap_drift", `heap +${heapDrift.toFixed(1)}MB since baseline (now ${snap.heapMb}MB)`);
    if (listenerDrift > LISTENER_DRIFT_MAX)
      _addAlert("listener_drift", `process listeners +${listenerDrift} (now ${snap.listenerCount})`);
    if (snap.timerCount > TIMER_DRIFT_WARN)
      _addAlert("timer_count", `active handles ${snap.timerCount} > warn(${TIMER_DRIFT_WARN})`);
    if (reconnectRate > RECONNECT_RATE_WARN)
      _addAlert("reconnect_storm", `${reconnectRate} reconnects in last 5min (warn=${RECONNECT_RATE_WARN})`);
    if (_counters.execActive > EXEC_LEAK_WARN)
      _addAlert("exec_leak", `${_counters.execActive} concurrent active executions (warn=${EXEC_LEAK_WARN})`);
    if (queueDepth > QUEUE_DRIFT_WARN)
      _addAlert("queue_drift", `queue depth ${queueDepth} > warn(${QUEUE_DRIFT_WARN})`);
    if (_counters.orphansDetected > ORPHAN_WARN)
      _addAlert("orphan_procs", `${_counters.orphansDetected} orphan processes detected`);

    // Check for execution leak: execs started >> execs finished (drift > 20)
    const execDrift = _counters.execTotalStarted - _counters.execTotalFinished;
    if (execDrift > 20)
      _addAlert("exec_count_drift", `exec started=${_counters.execTotalStarted} finished=${_counters.execTotalFinished} drift=${execDrift}`);

  } catch { /* non-critical */ }
}

function _addAlert(type, detail) {
  const now = Date.now();
  const recent = _alerts.find(a => a.type === type && now - a.ts < 5 * 60_000);
  if (recent) return;
  _alerts.push({ ts: now, type, detail });
  if (_alerts.length > 100) _alerts.shift();
  try {
    const logger = require("../../backend/utils/logger");
    logger.warn(`[DriftMonitor] ${type}: ${detail}`);
  } catch {}
}

// ── Lifecycle ──────────────────────────────────────────────────────
function start() {
  if (_ref) return;
  _ref = setInterval(_sample, SAMPLE_MS);
  _ref.unref();
  setTimeout(_sample, 2000).unref();
}

function stop() {
  if (_ref) { clearInterval(_ref); _ref = null; }
}

// ── External feed API ──────────────────────────────────────────────
function recordReconnect() {
  _counters.reconnectsTotal++;
  _counters.reconnectTimes.push(Date.now());
  // Cap array size — oldest entries pruned if array grows beyond 5-min window worth
  if (_counters.reconnectTimes.length > 500) {
    const cutoff = Date.now() - 5 * 60_000;
    _counters.reconnectTimes = _counters.reconnectTimes.filter(t => t > cutoff);
  }
}

function recordExecStarted() {
  _counters.execActive++;
  _counters.execTotalStarted++;
}

function recordExecFinished() {
  if (_counters.execActive > 0) _counters.execActive--;
  _counters.execTotalFinished++;
}

function recordOrphan(count = 1) {
  _counters.orphansDetected = count;
}

// ── Report ─────────────────────────────────────────────────────────
function getDriftReport() {
  const last     = _samples[_samples.length - 1] ?? null;
  const baseline = _baseline ?? null;
  const heapDrift     = last && baseline ? +(last.heapMb - baseline.heapMb).toFixed(1) : null;
  const listenerDrift = last && baseline ? last.listenerCount - baseline.listenerCount  : null;
  const now           = Date.now();

  // Queue drift: sustained high depth = last 10 samples all above threshold
  const qSamples   = _counters.queueDepthSamples.slice(-10);
  const queueDrift = qSamples.length >= 5 && qSamples.every(d => d > QUEUE_DRIFT_WARN);

  // Reconnect rate (last 5 min)
  const reconnectRate = _counters.reconnectTimes.filter(t => now - t < 5 * 60_000).length;

  return {
    baseline,
    current:           last,
    heapDriftMb:       heapDrift,
    listenerDrift,
    timerCount:        last?.timerCount ?? null,
    reconnectRate,
    reconnectsTotal:   _counters.reconnectsTotal,
    execActive:        _counters.execActive,
    execTotalStarted:  _counters.execTotalStarted,
    execTotalFinished: _counters.execTotalFinished,
    execDrift:         _counters.execTotalStarted - _counters.execTotalFinished,
    queueDrift,
    queueDepth:        last?.queueDepth ?? null,
    orphansDetected:   _counters.orphansDetected,
    recentAlerts:      _alerts.slice(-10),
    alertCount:        _alerts.length,
    healthy:           _alerts.filter(a => now - a.ts < 5 * 60_000).length === 0,
  };
}

function reset() {
  stop();
  _baseline = null;
  _samples  = [];
  _alerts   = [];
  _counters.reconnectsTotal   = 0;
  _counters.reconnectTimes    = [];
  _counters.execActive        = 0;
  _counters.execTotalStarted  = 0;
  _counters.execTotalFinished = 0;
  _counters.orphansDetected   = 0;
  _counters.queueDepthSamples = [];
}

module.exports = {
  start, stop, getDriftReport, reset,
  recordReconnect, recordExecStarted, recordExecFinished, recordOrphan,
};
