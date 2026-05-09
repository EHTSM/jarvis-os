"use strict";
/**
 * In-memory runtime error aggregation.
 * Tracks: counts by source, rolling ring buffer, error classification.
 * Not persisted to disk — resets on restart (keeps startup fast,
 * avoids unbounded disk growth from error logs).
 *
 * Error classes:
 *   config  — missing env vars, misconfiguration, bad API keys
 *   runtime — uncaught exceptions, crashed processes, EADDRINUSE
 *   logic   — code bugs (TypeError, undefined.x, bad response shape)
 *   transient — network timeouts, rate limits, 5xx from external APIs
 */

const MAX_RECENT = 100;

const _counts    = {};    // source → count
const _classCounts = { config: 0, runtime: 0, logic: 0, transient: 0 };
const _recent    = [];    // ring buffer of last MAX_RECENT errors
let   _total     = 0;
let   _startedAt = Date.now();

// ── Error classifier ─────────────────────────────────────────────
// Maps message patterns and sources to one of the four classes.
// Order matters — first match wins.
const _CLASSIFIERS = [
    // Config: missing/invalid credentials and env
    { cls: "config",    test: m => /API key|token|secret|not set|not configured|401|403|auth/i.test(m) },
    // Transient: network, rate-limit, upstream errors
    { cls: "transient", test: m => /timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|rate.?limit|503|502|504/i.test(m) },
    // Runtime: process-level crashes and port conflicts
    { cls: "runtime",   test: (m, src) => src === "uncaughtException" || src === "unhandledRejection" || /EADDRINUSE|crash|fatal/i.test(m) },
    // Logic: code-level bugs (default for TypeError etc.)
    { cls: "logic",     test: m => /TypeError|ReferenceError|Cannot read|is not a function|undefined|null/i.test(m) },
];

function _classify(source, message) {
    for (const { cls, test } of _CLASSIFIERS) {
        if (test(message, source)) return cls;
    }
    return "runtime";  // fallback
}

/**
 * Record an error.
 * @param {string} source   — where it came from  (e.g. "autoLoop", "whatsapp", "jarvis")
 * @param {string} message  — error message
 * @param {object} [meta]   — optional extra context
 */
function record(source, message, meta = {}) {
    _total++;
    _counts[source] = (_counts[source] || 0) + 1;

    const cls = _classify(source, String(message));
    _classCounts[cls] = (_classCounts[cls] || 0) + 1;

    const entry = {
        ts:      new Date().toISOString(),
        source,
        class:   cls,
        message: String(message).slice(0, 300),
        ...( Object.keys(meta).length ? { meta } : {} )
    };

    _recent.push(entry);
    if (_recent.length > MAX_RECENT) _recent.shift();
}

/**
 * Return a full error report for the /ops endpoint.
 */
function getReport() {
    const uptimeSecs = Math.round((Date.now() - _startedAt) / 1000);
    const topSources = Object.entries(_counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([source, count]) => ({ source, count }));

    return {
        total_errors:    _total,
        uptime_seconds:  uptimeSecs,
        errors_per_hour: uptimeSecs > 0 ? Math.round((_total / uptimeSecs) * 3600) : 0,
        by_class:        { ..._classCounts },
        top_sources:     topSources,
        recent:          _recent.slice(-20).reverse()
    };
}

/** Return only the most recent N errors. */
function recent(n = 20) {
    return _recent.slice(-n).reverse();
}

/** Reset (useful for tests). */
function reset() {
    Object.keys(_counts).forEach(k => delete _counts[k]);
    Object.keys(_classCounts).forEach(k => { _classCounts[k] = 0; });
    _recent.length = 0;
    _total     = 0;
    _startedAt = Date.now();
}

module.exports = { record, getReport, recent, reset };
