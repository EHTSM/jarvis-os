"use strict";
/**
 * memoryLeakDetector — heap growth monitoring and leak suspicion.
 *
 * snapshot()                → current heap snapshot object
 * checkNow()                → snapshot + leak detection result
 * detectLeak(samples?)      → { leakSuspected, growthPct, reason?, ... }
 * startMonitoring(ms)       → start periodic snapshots (returns false if already running)
 * stopMonitoring()          → stop (returns false if not running)
 * getHistory()              → copy of snapshot array
 * reset()                   → clear history and stop monitoring
 *
 * Leak detection: heap grew >= GROWTH_THRESHOLD monotonically over SAMPLE_WINDOW samples.
 */

const GROWTH_THRESHOLD = 0.20; // 20% consistent growth = suspected leak
const SAMPLE_WINDOW    = 5;    // evaluate over last N samples

let _snapshots   = [];
let _intervalRef = null;
let _seq         = 0;

function snapshot() {
    const m = process.memoryUsage();
    const s = {
        seq:       ++_seq,
        ts:        Date.now(),
        heapUsed:  m.heapUsed,
        heapTotal: m.heapTotal,
        rss:       m.rss,
        external:  m.external,
        pressure:  parseFloat((m.heapUsed / m.heapTotal).toFixed(3)),
    };
    _snapshots.push(s);
    if (_snapshots.length > 100) _snapshots.shift();
    return s;
}

function detectLeak(samples) {
    const window = (samples || _snapshots).slice(-SAMPLE_WINDOW);
    if (window.length < SAMPLE_WINDOW) {
        return { leakSuspected: false, reason: "insufficient_samples", samples: window.length };
    }

    const first  = window[0].heapUsed;
    const last   = window[window.length - 1].heapUsed;
    const growth = (last - first) / first;

    let monotonic = true;
    for (let i = 1; i < window.length; i++) {
        if (window[i].heapUsed < window[i - 1].heapUsed) { monotonic = false; break; }
    }

    if (growth > GROWTH_THRESHOLD && monotonic) {
        return {
            leakSuspected: true,
            growthPct:     parseFloat((growth * 100).toFixed(1)),
            firstHeapMB:   Math.round(first / 1e6),
            lastHeapMB:    Math.round(last  / 1e6),
            samples:       window.length,
            reason:        `heap grew ${(growth * 100).toFixed(1)}% monotonically over ${window.length} samples`,
        };
    }

    return {
        leakSuspected: false,
        growthPct:     parseFloat((growth * 100).toFixed(1)),
    };
}

function checkNow() {
    const snap   = snapshot();
    const detect = detectLeak();
    return { ...snap, ...detect };
}

function startMonitoring(intervalMs = 5_000) {
    if (_intervalRef) return false;
    _intervalRef = setInterval(() => snapshot(), intervalMs);
    if (_intervalRef.unref) _intervalRef.unref();
    return true;
}

function stopMonitoring() {
    if (!_intervalRef) return false;
    clearInterval(_intervalRef);
    _intervalRef = null;
    return true;
}

function getHistory() { return [..._snapshots]; }

function reset() {
    _snapshots   = [];
    _seq         = 0;
    stopMonitoring();
}

module.exports = {
    snapshot, detectLeak, checkNow,
    startMonitoring, stopMonitoring,
    getHistory, reset,
    GROWTH_THRESHOLD, SAMPLE_WINDOW,
};
