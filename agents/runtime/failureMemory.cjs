"use strict";
/**
 * failureMemory — persistent failure-pattern store.
 *
 * Records outcomes per (failureType, strategyId) pair and exposes
 * historical success rates so recoveryEngine can blend priors with
 * observed reality.
 *
 * Persisted to data/failure-memory.json; non-critical (all methods
 * are safe to call even if the disk write fails).
 *
 * Schema:
 *   { [failureType]: { [strategyId]: { attempts, successes, lastSeen } } }
 */

const fs   = require("fs");
const path = require("path");

const MEMORY_FILE = path.join(__dirname, "../../data/failure-memory.json");

let _mem = _load();

function _load() {
    try { return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); }
    catch { return {}; }
}

function _save() {
    try {
        const dir = path.dirname(MEMORY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(_mem, null, 2));
    } catch { /* non-critical */ }
}

// ── Write ─────────────────────────────────────────────────────────────

function recordOutcome(failureType, strategyId, success) {
    if (!failureType || !strategyId) return;
    if (!_mem[failureType]) _mem[failureType] = {};
    const e = _mem[failureType][strategyId] || { attempts: 0, successes: 0, lastSeen: null };
    e.attempts++;
    if (success) e.successes++;
    e.lastSeen = new Date().toISOString();
    _mem[failureType][strategyId] = e;
    _save();
}

// ── Read ──────────────────────────────────────────────────────────────

/** Returns null when < minSamples data points exist. */
function getSuccessRate(failureType, strategyId, minSamples = 3) {
    const e = _mem[failureType]?.[strategyId];
    if (!e || e.attempts < minSamples) return null;
    return e.successes / e.attempts;
}

function getAttemptCount(failureType, strategyId) {
    return _mem[failureType]?.[strategyId]?.attempts || 0;
}

/** Top N strategies by historical success rate for a given failure type. */
function topStrategies(failureType, n = 3) {
    const data = _mem[failureType] || {};
    return Object.entries(data)
        .filter(([, e]) => e.attempts > 0)
        .map(([id, e]) => ({ id, rate: e.successes / e.attempts, attempts: e.attempts }))
        .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts)
        .slice(0, n);
}

/** Full snapshot (for tests and diagnostics). */
function snapshot() { return JSON.parse(JSON.stringify(_mem)); }

/** Wipe all in-memory and on-disk state. Tests only. */
function reset() { _mem = {}; _save(); }

module.exports = { recordOutcome, getSuccessRate, getAttemptCount, topStrategies, snapshot, reset };
