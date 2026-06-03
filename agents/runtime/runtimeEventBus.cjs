"use strict";
/**
 * runtimeEventBus — lightweight internal event bus for the JARVIS runtime.
 *
 * Provides:
 *   - Fan-out to registered SSE subscribers
 *   - Bounded ring buffer (500 events) for reconnect replay
 *   - Telemetry ticker: emits "telemetry" every 10 s
 *   - Heartbeat ticker: emits "heartbeat" every 30 s (keeps SSE alive through proxies)
 *   - Backpressure-safe: erroring subscribers are auto-removed
 *   - No external dependencies — only Node.js built-ins
 *
 * Event types emitted by the system:
 *   execution    — task completed/failed (from executionHistory.record)
 *   task:added   — new task entered the queue
 *   task:updated — task status changed
 *   telemetry    — periodic memory/queue/error snapshot
 *   heartbeat    — keep-alive ping
 *   emergency    — governor state change (future hook)
 *   warning      — ops-level warning
 */

// ── Ring buffer ────────────────────────────────────────────────────
const RING_SIZE  = 500;
const _ring      = [];
let   _seq       = 0;

// ── Subscribers ────────────────────────────────────────────────────
// Map<clientId, { fn: Function, connectedAt: number, eventCount: number }>
const _subscribers  = new Map();
const MAX_SUBS      = 20;   // hard cap — prevents runaway connection leaks

// ── Event rate tracking (sliding 60-second window) ─────────────────
const _eventTimes   = [];
const RATE_WINDOW_MS = 60_000;

// ── Ticker handles ─────────────────────────────────────────────────
let _telemetryRef = null;
let _heartbeatRef = null;

// ── Long-session burn-in counters ─────────────────────────────────
// Monotonically increasing — never reset during a process lifetime.
// Exposed via getBurnInMetrics() for /runtime/health/deep and operator console.
const _burnIn = {
  startedAt:          Date.now(),
  totalEmitted:       0,       // total events emitted since boot
  totalReconnects:    0,       // incremented by SSE stream on each new connection after first
  execThroughput:     0,       // execution events counted
  sseFloodSuppressed: 0,       // flood-guard suppression count
  peakSubscribers:    0,       // highest concurrent subscriber count seen
  memSnapshots:       [],      // [{ts, heapMb, rssMb}] — last 72 samples (one per 5min = 6h)
  renderRateOk:       true,    // set false by telemetry if events/s > flood threshold
};

function _recordBurnInMemory() {
  try {
    const m = process.memoryUsage();
    const snap = {
      ts:     Date.now(),
      heapMb: +(m.heapUsed  / 1_048_576).toFixed(1),
      rssMb:  +(m.rss       / 1_048_576).toFixed(1),
    };
    _burnIn.memSnapshots.push(snap);
    if (_burnIn.memSnapshots.length > 72) _burnIn.memSnapshots.shift();
  } catch {}
}

// Memory snapshot every 5 min — 72 samples = 6h full history
setInterval(_recordBurnInMemory, 5 * 60_000).unref();

function getBurnInMetrics() {
  const uptimeSecs   = Math.round((Date.now() - _burnIn.startedAt) / 1000);
  const snaps        = _burnIn.memSnapshots;
  const first        = snaps[0]  ?? null;
  const last         = snaps[snaps.length - 1] ?? null;
  const heapDriftMb  = first && last ? +(last.heapMb - first.heapMb).toFixed(1) : null;
  const rssDriftMb   = first && last ? +(last.rssMb  - first.rssMb ).toFixed(1) : null;
  return {
    uptimeSecs,
    totalEmitted:       _burnIn.totalEmitted,
    totalReconnects:    _burnIn.totalReconnects,
    execThroughput:     _burnIn.execThroughput,
    sseFloodSuppressed: _burnIn.sseFloodSuppressed,
    peakSubscribers:    _burnIn.peakSubscribers,
    heapDriftMb,
    rssDriftMb,
    memSnapshots:       snaps.slice(-12),   // last hour only in response
  };
}

// Test mode: shorter intervals (set NODE_ENV=test or JARVIS_BUS_FAST=1)
const _fast          = process.env.JARVIS_BUS_FAST === "1";
const TELEMETRY_MS   = _fast ? 500  : 10_000;
const HEARTBEAT_MS   = _fast ? 500  : 30_000;

// ── Internal: record event to ring ────────────────────────────────
function _push(type, payload) {
    const event = {
        seq:     ++_seq,
        ts:      Date.now(),
        type,
        payload: payload ?? {}
    };

    _ring.push(event);
    if (_ring.length > RING_SIZE) _ring.shift();

    // Sliding-window rate tracking
    const now = Date.now();
    _eventTimes.push(now);
    while (_eventTimes.length > 0 && _eventTimes[0] < now - RATE_WINDOW_MS) {
        _eventTimes.shift();
    }

    // Burn-in counters
    _burnIn.totalEmitted++;
    if (type === "execution") _burnIn.execThroughput++;
    if (_subscribers.size > _burnIn.peakSubscribers) _burnIn.peakSubscribers = _subscribers.size;

    return event;
}

// ── SSE flood damper ──────────────────────────────────────────────
// Per-subscriber burst window: if a subscriber receives > FLOOD_BURST_MAX
// events within FLOOD_WINDOW_MS, suppress non-critical events for the rest
// of the window. Heartbeats and telemetry are never suppressed.
const FLOOD_BURST_MAX  = 30;        // events before suppression kicks in
const FLOOD_WINDOW_MS  = 5_000;     // 5s sliding window per subscriber
const NON_SUPPRESSIBLE = new Set(["heartbeat", "telemetry", "emergency"]);

function _isFlooded(sub) {
    const now = Date.now();
    // Trim old ticks outside the window
    sub._floodTicks = (sub._floodTicks || []).filter(t => now - t < FLOOD_WINDOW_MS);
    return sub._floodTicks.length >= FLOOD_BURST_MAX;
}

function _recordFloodTick(sub) {
    if (!sub._floodTicks) sub._floodTicks = [];
    sub._floodTicks.push(Date.now());
}

// ── Public: emit ──────────────────────────────────────────────────
/**
 * Publish an event to all subscribers.
 * Subscribers that throw (e.g. disconnected SSE) are silently removed.
 * Flood damping: non-critical events are suppressed if a subscriber exceeds
 * FLOOD_BURST_MAX events in FLOOD_WINDOW_MS.
 */
function emit(type, payload) {
    const event = _push(type, payload);

    if (_subscribers.size === 0) return;  // fast path — no allocations

    const dead = [];
    for (const [id, sub] of _subscribers) {
        // Degraded mode — suppress all non-critical events system-wide
        if (_degraded && !NON_SUPPRESSIBLE.has(type)) {
            _burnIn.sseFloodSuppressed++;
            continue;
        }
        // Per-subscriber flood damping
        if (!NON_SUPPRESSIBLE.has(type) && _isFlooded(sub)) {
            _burnIn.sseFloodSuppressed++;
            _burnIn.renderRateOk = false;
            continue;
        }
        _recordFloodTick(sub);
        try {
            sub.fn(event);
            sub.eventCount++;
        } catch {
            dead.push(id);
        }
    }
    for (const id of dead) _subscribers.delete(id);
}

// ── Stale subscriber sweep ────────────────────────────────────────
// Remove subscribers that have gone silent (fn throws consistently).
// Run every 2 min. A subscriber is stale if it has received 0 events
// in the last STALE_SUB_MS window despite the bus being active.
const STALE_SUB_MS = 5 * 60_000;

setInterval(() => {
  if (_subscribers.size === 0) return;
  const now = Date.now();
  const stale = [];
  for (const [id, sub] of _subscribers) {
    // If subscriber has been connected > STALE_SUB_MS and received 0 events
    // while the bus has emitted events, it is effectively dead.
    if (now - sub.connectedAt > STALE_SUB_MS && sub.eventCount === 0 && _seq > 0) {
      stale.push(id);
    }
  }
  for (const id of stale) {
    _subscribers.delete(id);
    try {
      const logger = require("../../backend/utils/logger");
      logger.warn(`[EventBus] removed stale subscriber ${id} (0 events in ${STALE_SUB_MS/1000}s)`);
    } catch {}
  }
}, 2 * 60_000).unref();

// ── Public: subscribe ────────────────────────────────────────────
/**
 * Register a subscriber.
 * @param {string}   id  — unique client ID (used for unsubscribe + metrics)
 * @param {Function} fn  — called with every new event: fn({ seq, ts, type, payload })
 * @throws {Error} if at MAX_SUBS capacity
 */
function subscribe(id, fn) {
    if (_subscribers.size >= MAX_SUBS) {
        throw new Error(`EventBus at capacity (${MAX_SUBS} subscribers)`);
    }
    _subscribers.set(id, { fn, connectedAt: Date.now(), eventCount: 0 });
}

// ── Public: unsubscribe ──────────────────────────────────────────
function unsubscribe(id) {
    return _subscribers.delete(id);
}

// ── Public: replay ────────────────────────────────────────────────
/**
 * Return the last `n` events from the ring buffer (oldest first).
 * Used by SSE handler to replay missed events to reconnecting clients.
 */
function getRecent(n = 50) {
    const count = Math.min(n, RING_SIZE);
    return _ring.slice(-count);  // already chronological (oldest → newest)
}

/**
 * Return all ring events with seq > afterSeq (oldest first).
 * Used by SSE Last-Event-ID replay to fill gaps without resending duplicates.
 * @param {number} afterSeq — last sequence number the client received
 */
function getSince(afterSeq) {
    return _ring.filter(e => e.seq > afterSeq);
}

// ── Public: metrics ───────────────────────────────────────────────
function metrics() {
    return {
        subscriberCount: _subscribers.size,
        maxSubscribers:  MAX_SUBS,
        totalEvents:     _seq,
        eventsLastMin:   _eventTimes.length,
        ringSize:        _ring.length,
        maxRingSize:     RING_SIZE,
        subscribers: [..._subscribers.entries()].map(([id, s]) => ({
            id,
            connectedAt: s.connectedAt,
            eventCount:  s.eventCount,
            ageMs:       Date.now() - s.connectedAt
        }))
    };
}

// ── Telemetry emitter ─────────────────────────────────────────────
// Reads live system state and emits a "telemetry" event every TELEMETRY_MS.
// Wrapped in try/catch — modules may not be loaded in test environments.
function _telemetryTick() {
    try {
        const memTracker = require("../../backend/utils/memoryTracker");
        const errTracker = require("../../backend/utils/errorTracker");
        const tq         = require("../taskQueue.cjs");

        let memReport = null;
        try { memReport = memTracker.getReport(); } catch {}
        if (!memReport) {
            const m = process.memoryUsage();
            memReport = {
                current: {
                    rss_mb:   +(m.rss       / 1_048_576).toFixed(1),
                    heap_mb:  +(m.heapUsed  / 1_048_576).toFixed(1),
                    total_mb: +(m.heapTotal / 1_048_576).toFixed(1)
                },
                trend: "stable", warn: false, critical: false
            };
        }

        emit("telemetry", {
            ts:     new Date().toISOString(),
            memory: memReport,
            errors: errTracker.getReport(),
            queue:  tq.getHealthReport(),
        });
    } catch { /* non-critical — telemetry ticks are best-effort */ }
}

// ── Degraded mode ─────────────────────────────────────────────────
// Activated automatically when heap exceeds DEGRADED_HEAP_MB.
// In degraded mode:
//   - Non-critical SSE event types are suppressed (only heartbeat + emergency pass)
//   - GC hint is triggered once (global.gc if exposed)
//   - Degraded state is included in heartbeat payload so frontend can banner it
const DEGRADED_HEAP_MB = 400;
let _degraded = false;

function _checkDegradedMode() {
  const heapMb = process.memoryUsage().heapUsed / 1_048_576;
  if (!_degraded && heapMb > DEGRADED_HEAP_MB) {
    _degraded = true;
    try { if (typeof global.gc === "function") global.gc(); } catch {}
    try {
      const logger = require("../../backend/utils/logger");
      logger.warn(`[EventBus] DEGRADED MODE — heap ${heapMb.toFixed(0)}MB > ${DEGRADED_HEAP_MB}MB`);
    } catch {}
  } else if (_degraded && heapMb < DEGRADED_HEAP_MB * 0.8) {
    _degraded = false;
  }
}

function isDegraded() { return _degraded; }

// ── Heartbeat emitter ─────────────────────────────────────────────
// Keeps SSE connections alive through nginx / load balancers that close
// idle connections after 60 s.
function _heartbeatTick() {
    _checkDegradedMode();
    emit("heartbeat", {
        ts:          Date.now(),
        subscribers: _subscribers.size,
        seq:         _seq,
        degraded:    _degraded,
    });
}

// ── Lifecycle ────────────────────────────────────────────────────
function start() {
    if (_telemetryRef && _heartbeatRef) return;  // idempotent

    if (!_telemetryRef) {
        _telemetryRef = setInterval(_telemetryTick, TELEMETRY_MS);
        _telemetryRef.unref();   // don't prevent process exit
    }
    if (!_heartbeatRef) {
        _heartbeatRef = setInterval(_heartbeatTick, HEARTBEAT_MS);
        _heartbeatRef.unref();
    }
}

function stop() {
    if (_telemetryRef) { clearInterval(_telemetryRef); _telemetryRef = null; }
    if (_heartbeatRef) { clearInterval(_heartbeatRef); _heartbeatRef = null; }
    _subscribers.clear();
}

/**
 * Full reset — clears ring, subscribers, counters.
 * For test isolation only — do not call in production.
 */
function reset() {
    stop();
    _ring.length      = 0;
    _eventTimes.length = 0;
    _seq              = 0;
}

// ── Module exports ────────────────────────────────────────────────
function recordReconnect() { _burnIn.totalReconnects++; }
function recordSseFloodSuppressed() { _burnIn.sseFloodSuppressed++; }

module.exports = {
    emit, subscribe, unsubscribe,
    getRecent, getSince, metrics, getBurnInMetrics,
    recordReconnect, recordSseFloodSuppressed,
    isDegraded,
    start, stop, reset,
    RING_SIZE, MAX_SUBS, TELEMETRY_MS, HEARTBEAT_MS
};
