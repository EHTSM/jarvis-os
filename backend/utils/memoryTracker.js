"use strict";
/**
 * Memory Tracker — samples process.memoryUsage() on a fixed interval and
 * maintains a rolling window so the /ops endpoint can show trends rather
 * than just a point-in-time snapshot.
 *
 * Sampling interval : 60 s
 * Window            : 60 samples → 1 hour of history
 * No disk writes    : resets on restart (intentional — avoids I/O on hot path)
 */

const INTERVAL_MS  = 60_000;
const MAX_SAMPLES  = 60;        // 1 hour at 60s cadence
const WARN_HEAP_MB = 350;       // emit warning flag above this
const CRIT_HEAP_MB = 450;       // emit critical flag above this

const _samples = [];            // { ts, rss, heap, heapTotal }
let   _timer   = null;

function _sample() {
    const m = process.memoryUsage();
    const entry = {
        ts:        Date.now(),
        rss_mb:    +(m.rss       / 1_048_576).toFixed(1),
        heap_mb:   +(m.heapUsed  / 1_048_576).toFixed(1),
        total_mb:  +(m.heapTotal / 1_048_576).toFixed(1)
    };
    _samples.push(entry);
    if (_samples.length > MAX_SAMPLES) _samples.shift();
    return entry;
}

/** Start the sampling interval (idempotent). */
function start() {
    if (_timer) return;
    _sample();   // immediate first sample
    _timer = setInterval(_sample, INTERVAL_MS).unref();
}

/** Stop sampling (for clean shutdown). */
function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

/** Compute trend: compare avg of last 5 samples vs avg of 5 before that. */
function _trend() {
    if (_samples.length < 6) return "stable";
    const recent  = _samples.slice(-5).map(s => s.heap_mb);
    const earlier = _samples.slice(-10, -5).map(s => s.heap_mb);
    if (earlier.length === 0) return "stable";
    const avgRecent  = recent.reduce((a, b) => a + b, 0)  / recent.length;
    const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const delta = avgRecent - avgEarlier;
    if (delta >  8) return "rising";
    if (delta < -8) return "falling";
    return "stable";
}

/** Full memory report for /ops. */
function getReport() {
    if (_samples.length === 0) _sample();

    const current = _samples[_samples.length - 1];
    const heapVals = _samples.map(s => s.heap_mb);
    const rssVals  = _samples.map(s => s.rss_mb);

    const min  = v => +(Math.min(...v)).toFixed(1);
    const max  = v => +(Math.max(...v)).toFixed(1);
    const avg  = v => +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1);

    const trend   = _trend();
    const heapNow = current.heap_mb;

    return {
        current: {
            rss_mb:   current.rss_mb,
            heap_mb:  heapNow,
            total_mb: current.total_mb
        },
        window_1h: {
            samples:  _samples.length,
            heap_min: min(heapVals),
            heap_max: max(heapVals),
            heap_avg: avg(heapVals),
            rss_min:  min(rssVals),
            rss_max:  max(rssVals)
        },
        trend,
        // Operator flags
        warn:     heapNow >= WARN_HEAP_MB && heapNow < CRIT_HEAP_MB,
        critical: heapNow >= CRIT_HEAP_MB,
        // Last 10 samples for sparkline-style display
        recent_samples: _samples.slice(-10).map(s => ({
            ts:      new Date(s.ts).toISOString(),
            heap_mb: s.heap_mb,
            rss_mb:  s.rss_mb
        }))
    };
}

/** Quick current-only snapshot (used inside anomaly checks). */
function current() {
    if (_samples.length === 0) _sample();
    return _samples[_samples.length - 1];
}

module.exports = { start, stop, getReport, current };
