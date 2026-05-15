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

    return event;
}

// ── Public: emit ──────────────────────────────────────────────────
/**
 * Publish an event to all subscribers.
 * Subscribers that throw (e.g. disconnected SSE) are silently removed.
 */
function emit(type, payload) {
    const event = _push(type, payload);

    if (_subscribers.size === 0) return;  // fast path — no allocations

    const dead = [];
    for (const [id, sub] of _subscribers) {
        try {
            sub.fn(event);
            sub.eventCount++;
        } catch {
            // Subscriber errored — mark for removal (can't mutate Map during iteration)
            dead.push(id);
        }
    }
    for (const id of dead) _subscribers.delete(id);
}

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

// ── Heartbeat emitter ─────────────────────────────────────────────
// Keeps SSE connections alive through nginx / load balancers that close
// idle connections after 60 s.
function _heartbeatTick() {
    emit("heartbeat", {
        ts:          Date.now(),
        subscribers: _subscribers.size,
        seq:         _seq
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
module.exports = {
    emit, subscribe, unsubscribe,
    getRecent, metrics,
    start, stop, reset,
    // Constants exposed for test assertions
    RING_SIZE, MAX_SUBS, TELEMETRY_MS, HEARTBEAT_MS
};
