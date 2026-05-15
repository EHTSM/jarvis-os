"use strict";
/**
 * repairReplayer — record, replay, and benchmark repair strategy effectiveness.
 *
 * record(errorType, strategy, success, durationMs, context?)
 *   — log one repair attempt
 *
 * replaySuccessful(errorType, n?)
 *   → [{ strategy, successRate, attempts, avgMs }] top N successful strategies
 *
 * compare(errorType)
 *   → { strategies[...], bestStrategy, worstStrategy }
 *
 * benchmark(errorType, windowSize?)
 *   → { trend: "improving"|"degrading"|"stable", windows[], delta }
 *
 * getAll(errorType?)  → raw repair records (optionally filtered)
 * reset()
 */

let _repairs = [];
let _seq     = 0;

// ── record ────────────────────────────────────────────────────────────

function record(errorType, strategy, success, durationMs = 0, context = {}) {
    _repairs.push({
        seq:       ++_seq,
        ts:        new Date().toISOString(),
        errorType: errorType || "generic_error",
        strategy:  strategy  || "unknown",
        success:   !!success,
        durationMs,
        context,
    });
}

// ── replaySuccessful ──────────────────────────────────────────────────

function replaySuccessful(errorType, n = 5) {
    const byStrategy = _groupByStrategy(errorType);
    return byStrategy
        .filter(s => s.successes > 0)
        .sort((a, b) => b.successRate - a.successRate || b.successes - a.successes)
        .slice(0, n);
}

// ── compare ───────────────────────────────────────────────────────────

function compare(errorType) {
    const strategies = _groupByStrategy(errorType);
    if (strategies.length === 0) {
        return { errorType, strategies: [], bestStrategy: null, worstStrategy: null };
    }

    const sorted = [...strategies].sort((a, b) => b.successRate - a.successRate);
    return {
        errorType,
        strategies:    sorted,
        bestStrategy:  sorted[0].strategy,
        worstStrategy: sorted[sorted.length - 1].strategy,
    };
}

// ── benchmark ─────────────────────────────────────────────────────────

function benchmark(errorType, windowSize = 5) {
    const recs = _repairs.filter(r => r.errorType === errorType);
    if (recs.length < windowSize * 2) {
        return { trend: "insufficient_data", windows: [], delta: 0, sampleSize: recs.length };
    }

    const windows = [];
    for (let i = 0; i + windowSize <= recs.length; i += windowSize) {
        const slice       = recs.slice(i, i + windowSize);
        const successRate = slice.filter(r => r.success).length / slice.length;
        windows.push({
            window:      windows.length + 1,
            successRate: parseFloat(successRate.toFixed(3)),
            samples:     slice.length,
        });
    }

    const first = windows[0].successRate;
    const last  = windows[windows.length - 1].successRate;
    const delta = parseFloat((last - first).toFixed(3));

    const trend = delta > 0.1 ? "improving"
        : delta < -0.1        ? "degrading"
        : "stable";

    return { trend, windows, delta, sampleSize: recs.length };
}

// ── getAll ────────────────────────────────────────────────────────────

function getAll(errorType) {
    if (!errorType) return [..._repairs];
    return _repairs.filter(r => r.errorType === errorType);
}

// ── helpers ───────────────────────────────────────────────────────────

function _groupByStrategy(errorType) {
    const map = new Map();

    const recs = errorType ? _repairs.filter(r => r.errorType === errorType) : _repairs;
    for (const r of recs) {
        if (!map.has(r.strategy)) {
            map.set(r.strategy, { strategy: r.strategy, attempts: 0, successes: 0, totalMs: 0 });
        }
        const s = map.get(r.strategy);
        s.attempts++;
        if (r.success) s.successes++;
        s.totalMs += r.durationMs;
    }

    return [...map.values()].map(s => ({
        ...s,
        successRate: s.attempts > 0 ? parseFloat((s.successes / s.attempts).toFixed(3)) : 0,
        avgMs:       s.attempts > 0 ? Math.round(s.totalMs / s.attempts) : 0,
    }));
}

function reset() { _repairs = []; _seq = 0; }

module.exports = { record, replaySuccessful, compare, benchmark, getAll, reset };
