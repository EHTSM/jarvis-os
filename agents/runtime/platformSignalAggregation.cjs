"use strict";
/**
 * Phase 736 — Platform Signal Aggregation
 *
 * Aggregate runtime signals from all active platform dimensions into a
 * unified signal surface. Reduces operator noise by deduplicating,
 * classifying, and prioritizing cross-dimension signals.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE   = path.join(__dirname, "../../data/platform-signal-aggregation.json");
const MAX_SIGNALS = 500;
const DEDUP_MS    = 3 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { signals: [] }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function _fingerprint(signal) {
    return `${signal.source}:${signal.dimension}:${signal.check}:${signal.severity}`;
}

function ingestSignal(signal) {
    if (!signal || !signal.source || !signal.dimension) {
        return { ok: false, error: "signal missing source or dimension" };
    }
    const db  = _load();
    const now = Date.now();
    const fp  = _fingerprint(signal);
    const dup = db.signals.find(s => s.fp === fp && now - s.ts < DEDUP_MS);
    if (dup) return { ok: true, duplicate: true, fp };

    db.signals.push({ ...signal, fp, ts: now });
    if (db.signals.length > MAX_SIGNALS) db.signals = db.signals.slice(-MAX_SIGNALS);
    _save(db);
    return { ok: true, fp };
}

function aggregateSignals({ maxAge = 60 * 60 * 1000, severity } = {}) {
    const db  = _load();
    const now = Date.now();
    let signals = db.signals.filter(s => now - s.ts <= maxAge);
    if (severity) signals = signals.filter(s => s.severity === severity);

    const byDimension = {};
    signals.forEach(s => {
        if (!byDimension[s.dimension]) byDimension[s.dimension] = [];
        byDimension[s.dimension].push(s);
    });

    const criticalCount = signals.filter(s => s.severity === "critical").length;
    const warningCount  = signals.filter(s => s.severity === "warning").length;

    return {
        ok:             criticalCount === 0,
        total:          signals.length,
        criticalCount,
        warningCount,
        byDimension,
        topSignals:     signals.filter(s => s.severity === "critical").slice(0, 5),
        summary:        `Aggregated ${signals.length} signals — critical=${criticalCount} warnings=${warningCount}`,
    };
}

function collectPlatformSignals() {
    const sources = [
        { mod: "./platformMaturityResilience.cjs",     fn: "platformMaturityResilienceReport",    dim: "maturity-resilience" },
        { mod: "./platformProductivityResilience.cjs", fn: "platformProductivityResilienceReport", dim: "productivity-resilience" },
        { mod: "./platformCoordinationResilience2.cjs",fn: "platformCoordinationResilience2Report",dim: "coordination-resilience" },
    ];

    let collected = 0;
    sources.forEach(({ mod, fn, dim }) => {
        const m = _tryRequire(mod);
        if (!m || !m[fn]) return;
        try {
            const report = m[fn]();
            const allSignals = Object.values(report.dimensions || {}).flatMap(d => d.signals || []);
            allSignals.forEach(s => {
                ingestSignal({ source: mod, dimension: dim, check: s.check, severity: s.severity || "info", detail: s.detail });
                collected++;
            });
        } catch {}
    });

    return { ok: true, collected, summary: `Collected ${collected} signals from ${sources.length} sources` };
}

function signalSurface() {
    collectPlatformSignals();
    return aggregateSignals({ maxAge: 2 * 60 * 60 * 1000 });
}

function clearStaleSignals(olderThanMs = 6 * 60 * 60 * 1000) {
    const db  = _load();
    const now = Date.now();
    const before = db.signals.length;
    db.signals = db.signals.filter(s => now - s.ts <= olderThanMs);
    _save(db);
    return { ok: true, removed: before - db.signals.length, remaining: db.signals.length };
}

module.exports = { ingestSignal, aggregateSignals, collectPlatformSignals, signalSurface, clearStaleSignals };
