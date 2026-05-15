"use strict";
/**
 * benchmarkHistory — persist benchmark snapshots and compute deltas.
 *
 * snapshot(name, metrics)       → stored entry { snapshotId, name, ts, metrics }
 * getHistory(name, n?)          → last n snapshots (newest-first)
 * delta(name)                   → diff latest vs previous run
 * longTermTrend(name, n?)       → overall trend across n snapshots
 * list()                        → all tracked workflow names
 * purgeOlderThan(ageDays)       → remove snapshots older than ageDays
 * reset()
 */

// name → [{snapshotId, ts, seq, metrics}]
const _store = new Map();
let   _seq   = 0;

const DELTA_KEYS = ["successRate", "repairRate", "flipRate", "avgMs",
                    "composite",   "p95Ms",      "totalRuns"];

// ── snapshot ──────────────────────────────────────────────────────────

function snapshot(name, metrics = {}) {
    if (!_store.has(name)) _store.set(name, []);
    const entry = {
        snapshotId: `snap-${name}-${++_seq}`,
        name,
        ts:         new Date().toISOString(),
        seq:        _seq,
        metrics:    { ...metrics },
    };
    _store.get(name).push(entry);
    return entry;
}

// ── getHistory ────────────────────────────────────────────────────────

function getHistory(name, n = 20) {
    const all = _store.get(name) || [];
    return all.slice(-n).reverse();   // newest first
}

// ── delta ─────────────────────────────────────────────────────────────

function delta(name) {
    const hist = getHistory(name, 2);
    if (hist.length < 2) {
        return { available: false, reason: hist.length === 0 ? "no_snapshots" : "only_one_snapshot" };
    }
    const [latest, prev] = hist;
    const changes = {};

    for (const key of DELTA_KEYS) {
        const a = _pick(prev.metrics, key);
        const b = _pick(latest.metrics, key);
        if (a != null && b != null) {
            changes[key] = {
                prev:    a,
                current: b,
                delta:   parseFloat((b - a).toFixed(4)),
                direction: b > a ? "up" : b < a ? "down" : "flat",
            };
        }
    }

    return {
        available:    true,
        snapshotId:   latest.snapshotId,
        prevId:       prev.snapshotId,
        ts:           latest.ts,
        changes,
        regression:   _isRegression(changes),
        improvement:  _isImprovement(changes),
    };
}

// ── longTermTrend ─────────────────────────────────────────────────────

function longTermTrend(name, n = 10) {
    const hist = getHistory(name, n).reverse();   // oldest-first for trend
    if (hist.length < 2) return { trend: "insufficient_data", sampleSize: hist.length };

    const successRates = hist.map(h => _pick(h.metrics, "successRate") ?? 0);
    const slope        = _linearSlope(successRates);

    const flipRates    = hist.map(h => _pick(h.metrics, "flipRate") ?? 0);
    const avgFlip      = flipRates.reduce((s, v) => s + v, 0) / flipRates.length;

    const composite    = hist.map(h => _pick(h.metrics, "composite") ?? 0);
    const compSlope    = _linearSlope(composite);

    return {
        trend:            slope > 0.02 ? "improving" : slope < -0.02 ? "degrading" : "stable",
        successRateSlope: parseFloat(slope.toFixed(4)),
        compositeSlope:   parseFloat(compSlope.toFixed(4)),
        avgFlipRate:      parseFloat(avgFlip.toFixed(3)),
        sampleSize:       hist.length,
        firstTs:          hist[0].ts,
        lastTs:           hist[hist.length - 1].ts,
    };
}

// ── list / purge ──────────────────────────────────────────────────────

function list() { return [..._store.keys()]; }

function purgeOlderThan(ageDays) {
    const cutoff = Date.now() - ageDays * 86_400_000;
    let   pruned = 0;
    for (const [name, entries] of _store) {
        const kept = entries.filter(e => new Date(e.ts).getTime() >= cutoff);
        pruned += entries.length - kept.length;
        if (kept.length === 0) _store.delete(name);
        else                   _store.set(name, kept);
    }
    return { pruned, remaining: [..._store.values()].reduce((s, a) => s + a.length, 0) };
}

function reset() { _store.clear(); _seq = 0; }

// ── helpers ───────────────────────────────────────────────────────────

function _pick(metrics, key) {
    if (metrics[key] != null)           return metrics[key];
    if (metrics.score?.[key] != null)   return metrics.score[key];
    return null;
}

function _isRegression(changes) {
    return (changes.successRate?.direction === "down" && Math.abs(changes.successRate.delta) > 0.05)
        || (changes.flipRate?.direction    === "up"   && Math.abs(changes.flipRate.delta)    > 0.1);
}

function _isImprovement(changes) {
    return (changes.successRate?.direction === "up"   && Math.abs(changes.successRate.delta) > 0.05)
        || (changes.flipRate?.direction    === "down" && Math.abs(changes.flipRate.delta)    > 0.1);
}

function _linearSlope(values) {
    const n    = values.length;
    if (n < 2)  return 0;
    const xBar = (n - 1) / 2;
    const yBar = values.reduce((s, v) => s + v, 0) / n;
    let   num  = 0, den = 0;
    values.forEach((y, x) => { num += (x - xBar) * (y - yBar); den += (x - xBar) ** 2; });
    return den > 0 ? num / den : 0;
}

module.exports = { snapshot, getHistory, delta, longTermTrend, list, purgeOlderThan, reset };
