"use strict";
/**
 * telemetryCompressor — lightweight compression for long-running telemetry sessions.
 *
 * Strategies (applied in order of preference):
 *   1. Run-length encoding (RLE) — consecutive identical values → {value, count}
 *   2. Delta encoding           — store differences from first value
 *   3. Significant-points       — keep only min, max, and inflection points
 *
 * compress(samples, opts)                     → CompressedSeries
 * decompress(compressed)                      → Sample[]
 * estimateCompressionRatio(samples)           → number
 * compressSession(sessionEvents)              → CompressedSession
 * getCompressionStats()                       → Stats
 * reset()
 */

const STRATEGIES = ["rle", "delta", "significant_points"];
const RLE_PRECISION = 4;          // decimal places for RLE equality check
const DELTA_PRECISION = 6;
const SIGNIFICANCE_THRESHOLD = 0.02;  // minimum delta to count as significant change

let _compressionLog = [];

// ── _roundTo ──────────────────────────────────────────────────────────

function _roundTo(v, decimals) {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
}

// ── compressRLE ───────────────────────────────────────────────────────

function _compressRLE(samples) {
    if (samples.length === 0) return { runs: [], strategy: "rle" };
    const runs = [];
    let current = { value: _roundTo(samples[0].value, RLE_PRECISION), count: 1, ts: samples[0].ts };

    for (let i = 1; i < samples.length; i++) {
        const v = _roundTo(samples[i].value, RLE_PRECISION);
        if (v === current.value) {
            current.count++;
        } else {
            runs.push({ ...current });
            current = { value: v, count: 1, ts: samples[i].ts };
        }
    }
    runs.push({ ...current });
    return { runs, strategy: "rle", originalCount: samples.length, compressedCount: runs.length };
}

function _decompressRLE(compressed) {
    const samples = [];
    for (const run of compressed.runs) {
        for (let i = 0; i < run.count; i++) {
            samples.push({ value: run.value, ts: run.ts });
        }
    }
    return samples;
}

// ── compressDelta ─────────────────────────────────────────────────────

function _compressDelta(samples) {
    if (samples.length === 0) return { base: 0, deltas: [], tss: [], strategy: "delta" };
    const base   = _roundTo(samples[0].value, DELTA_PRECISION);
    const deltas = [];
    const tss    = [];
    let prev     = base;

    for (const s of samples) {
        const v = _roundTo(s.value, DELTA_PRECISION);
        deltas.push(_roundTo(v - prev, DELTA_PRECISION));
        tss.push(s.ts ?? null);
        prev = v;
    }

    return {
        base, deltas, tss,
        strategy:       "delta",
        originalCount:  samples.length,
        compressedCount: 2 + deltas.length,  // base + deltas array
    };
}

function _decompressDelta(compressed) {
    const samples = [];
    let current   = compressed.base;
    for (let i = 0; i < compressed.deltas.length; i++) {
        current += compressed.deltas[i];
        samples.push({ value: _roundTo(current, DELTA_PRECISION), ts: compressed.tss?.[i] ?? null });
    }
    return samples;
}

// ── compressSignificantPoints ─────────────────────────────────────────

function _compressSignificantPoints(samples) {
    if (samples.length <= 2) {
        return { points: samples, strategy: "significant_points", originalCount: samples.length, compressedCount: samples.length };
    }

    const points = [samples[0]];
    let lastKept = samples[0].value;

    for (let i = 1; i < samples.length - 1; i++) {
        const v    = samples[i].value;
        const next = samples[i + 1].value;
        const delta = Math.abs(v - lastKept);
        // Keep: significant delta OR inflection point (direction change)
        const prevDir = v - lastKept;
        const nextDir = next - v;
        const inflection = prevDir * nextDir < 0;

        if (delta >= SIGNIFICANCE_THRESHOLD || inflection) {
            points.push(samples[i]);
            lastKept = v;
        }
    }
    points.push(samples[samples.length - 1]);

    return {
        points,
        strategy:       "significant_points",
        originalCount:  samples.length,
        compressedCount: points.length,
    };
}

function _decompressSignificantPoints(compressed) {
    return [...compressed.points];
}

// ── compress ──────────────────────────────────────────────────────────

function compress(samples = [], opts = {}) {
    const strategy = opts.strategy ?? _pickBestStrategy(samples);
    let result;

    switch (strategy) {
        case "rle":                result = _compressRLE(samples);                 break;
        case "delta":              result = _compressDelta(samples);               break;
        case "significant_points": result = _compressSignificantPoints(samples);   break;
        default:                   result = _compressRLE(samples);
    }

    const ratio = samples.length > 0 ? result.compressedCount / samples.length : 1;
    _compressionLog.push({ strategy, originalCount: samples.length, compressedCount: result.compressedCount, ratio: +ratio.toFixed(3) });

    return { ...result, compressionRatio: +ratio.toFixed(3) };
}

function _pickBestStrategy(samples) {
    if (samples.length < 4) return "rle";
    const rle  = _compressRLE(samples);
    const sp   = _compressSignificantPoints(samples);
    // Pick whichever gives fewer points
    return rle.compressedCount <= sp.compressedCount ? "rle" : "significant_points";
}

// ── decompress ────────────────────────────────────────────────────────

function decompress(compressed = {}) {
    switch (compressed.strategy) {
        case "rle":                return _decompressRLE(compressed);
        case "delta":              return _decompressDelta(compressed);
        case "significant_points": return _decompressSignificantPoints(compressed);
        default:                   return [];
    }
}

// ── estimateCompressionRatio ──────────────────────────────────────────

function estimateCompressionRatio(samples = []) {
    if (samples.length === 0) return 1;
    const rle  = _compressRLE(samples);
    const sp   = _compressSignificantPoints(samples);
    const best = Math.min(rle.compressedCount, sp.compressedCount);
    return +(best / samples.length).toFixed(3);
}

// ── compressSession ───────────────────────────────────────────────────

function compressSession(sessionEvents = []) {
    if (sessionEvents.length === 0) return { compressed: false, reason: "no_events" };

    // Group events by type for per-type compression
    const byType = new Map();
    for (const e of sessionEvents) {
        const t = e.type ?? "unknown";
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t).push({ value: e.seqNum ?? 0, ts: e.ts });
    }

    const compressedTypes = {};
    let totalOriginal = 0, totalCompressed = 0;

    for (const [type, samples] of byType) {
        const c = compress(samples);
        compressedTypes[type] = c;
        totalOriginal   += c.originalCount ?? samples.length;
        totalCompressed += c.compressedCount ?? samples.length;
    }

    return {
        compressed:       true,
        totalOriginal,
        totalCompressed,
        compressionRatio: totalOriginal > 0 ? +(totalCompressed / totalOriginal).toFixed(3) : 1,
        byType:           compressedTypes,
        eventTypeCount:   byType.size,
    };
}

// ── getCompressionStats / reset ───────────────────────────────────────

function getCompressionStats() {
    if (_compressionLog.length === 0) return { compressions: 0 };
    const avgRatio = _compressionLog.reduce((s, l) => s + l.ratio, 0) / _compressionLog.length;
    const byStrategy = {};
    for (const l of _compressionLog) byStrategy[l.strategy] = (byStrategy[l.strategy] ?? 0) + 1;
    return { compressions: _compressionLog.length, avgCompressionRatio: +avgRatio.toFixed(3), byStrategy };
}

function reset() { _compressionLog = []; }

module.exports = {
    STRATEGIES, SIGNIFICANCE_THRESHOLD,
    compress, decompress, estimateCompressionRatio,
    compressSession, getCompressionStats, reset,
};
