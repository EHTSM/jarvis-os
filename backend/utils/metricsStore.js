"use strict";
/**
 * In-process request metrics store.
 * Extracted from jarvisController — now a standalone singleton that any
 * module can write to and the /metrics route reads from.
 *
 * Tracks: request counts, error counts, per-mode latency ring buffers,
 *         intent distribution, mode distribution.
 */

const _LATENCY_MAX = 200;

const _counters = { requests: 0, errors: 0, paymentLinks: 0, waSent: 0 };
const _byIntent  = {};
const _byMode    = {};
const _latency   = { sales: [], execution: [], intelligence: [], whatsapp: [] };

function inc(key) {
    if (key in _counters) _counters[key]++;
}

function trackIntent(intent) {
    _byIntent[intent] = (_byIntent[intent] || 0) + 1;
}

function trackMode(mode) {
    _byMode[mode] = (_byMode[mode] || 0) + 1;
}

function recordLatency(mode, ms) {
    const buf = _latency[mode];
    if (!buf) return;
    buf.push(ms);
    if (buf.length > _LATENCY_MAX) buf.shift();
}

function _percentile(sorted, p) {
    if (sorted.length === 0) return null;
    return sorted[Math.max(0, Math.ceil(sorted.length * p / 100) - 1)];
}

function _latencyStats(mode) {
    const buf = _latency[mode];
    if (!buf || buf.length === 0) return { count: 0, p50: null, p95: null, p99: null, avg: null, max: null };
    const sorted = [...buf].sort((a, b) => a - b);
    const avg    = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
    return {
        count: sorted.length,
        p50:   _percentile(sorted, 50),
        p95:   _percentile(sorted, 95),
        p99:   _percentile(sorted, 99),
        avg,
        max:   sorted[sorted.length - 1]
    };
}

/**
 * Return a serializable snapshot of all metrics.
 * Callers may merge in CRM stats or other domain data.
 */
function getSnapshot() {
    return {
        requests:     _counters.requests,
        errors:       _counters.errors,
        error_rate:   _counters.requests > 0
            ? +(_counters.errors / _counters.requests * 100).toFixed(1)
            : 0,
        paymentLinks: _counters.paymentLinks,
        waSent:       _counters.waSent,
        byIntent:     { ..._byIntent },
        byMode:       { ..._byMode },
        latency: {
            sales:        _latencyStats("sales"),
            execution:    _latencyStats("execution"),
            intelligence: _latencyStats("intelligence"),
            whatsapp:     _latencyStats("whatsapp")
        },
        uptime: Math.round(process.uptime())
    };
}

module.exports = { inc, trackIntent, trackMode, recordLatency, getSnapshot };
