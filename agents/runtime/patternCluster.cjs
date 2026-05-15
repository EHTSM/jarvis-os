"use strict";
/**
 * patternCluster — workflow failure memory clustering.
 *
 * Groups failures by (failureType × stepName) and tracks which strategies
 * worked. Persists to data/pattern-clusters.json so knowledge accumulates
 * across runs.
 *
 * Key operations:
 *   record(type, stepName, strategyId, success)  — add an outcome
 *   getBestStrategy(type, stepName)              — top-performing strategy
 *   getSimilar(type, stepName)                   — related clusters
 *   getClusters()                                — full snapshot
 *   stats()                                      — aggregate cluster stats
 */

const fs   = require("fs");
const path = require("path");

const CLUSTER_FILE = path.join(__dirname, "../../data/pattern-clusters.json");
const MIN_SAMPLES_FOR_BEST = 2; // need at least 2 attempts before recommending a strategy

// ── Persistence ───────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(CLUSTER_FILE, "utf8")); }
    catch { return {}; }
}

function _save(data) {
    try {
        const dir = path.dirname(CLUSTER_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CLUSTER_FILE, JSON.stringify(data, null, 2));
    } catch { /* non-critical */ }
}

let _store = _load();

// ── Cluster key ───────────────────────────────────────────────────────
// Primary grouping: failureType + normalized stepName
// Normalization: strip unique suffixes like trailing numbers/hashes

function _clusterKey(failureType, stepName) {
    const normalized = stepName.replace(/[-_]\w{6,}$/, "").replace(/\d+$/, "");
    return `${failureType}::${normalized}`;
}

// ── Record an outcome ─────────────────────────────────────────────────

function record(failureType, stepName, strategyId, success, meta = {}) {
    if (!failureType || !stepName || !strategyId) return;
    const key = _clusterKey(failureType, stepName);

    if (!_store[key]) {
        _store[key] = {
            id:           key,
            failureType,
            stepName:     stepName.replace(/\d+$/, ""),
            strategies:   {},
            totalAttempts: 0,
            totalSuccesses: 0,
            lastSeen:     null,
            bestStrategy: null,
            successRate:  0,
        };
    }

    const cluster = _store[key];
    cluster.totalAttempts++;
    if (success) cluster.totalSuccesses++;
    cluster.lastSeen = new Date().toISOString();

    if (!cluster.strategies[strategyId]) {
        cluster.strategies[strategyId] = { attempts: 0, successes: 0 };
    }
    cluster.strategies[strategyId].attempts++;
    if (success) cluster.strategies[strategyId].successes++;

    // Recompute derived fields
    cluster.successRate  = cluster.totalAttempts > 0
        ? cluster.totalSuccesses / cluster.totalAttempts
        : 0;

    cluster.bestStrategy = _computeBest(cluster.strategies);

    _save(_store);
}

function _computeBest(strategies) {
    return Object.entries(strategies)
        .filter(([, v]) => v.attempts >= MIN_SAMPLES_FOR_BEST)
        .map(([id, v])  => ({ id, rate: v.successes / v.attempts, attempts: v.attempts }))
        .sort((a, b)    => b.rate - a.rate || b.attempts - a.attempts)[0]?.id || null;
}

// ── Query ─────────────────────────────────────────────────────────────

/**
 * Returns the historically best strategy id for this failure+step combo,
 * or null if not enough data.
 */
function getBestStrategy(failureType, stepName) {
    const key     = _clusterKey(failureType, stepName);
    const cluster = _store[key];
    return cluster?.bestStrategy || null;
}

/**
 * Returns clusters that share the same failureType — useful for
 * cross-step pattern matching.
 */
function getSimilar(failureType, stepName) {
    const myKey = _clusterKey(failureType, stepName);
    return Object.values(_store)
        .filter(c => c.failureType === failureType && c.id !== myKey)
        .sort((a, b) => b.successRate - a.successRate);
}

/**
 * Returns all clusters with derived fields computed.
 */
function getClusters() {
    return Object.values(_store).map(c => ({
        ...c,
        strategies: { ...c.strategies },
    }));
}

/**
 * Aggregate stats across all clusters.
 */
function stats() {
    const clusters = getClusters();
    const total    = clusters.reduce((s, c) => s + c.totalAttempts, 0);
    const success  = clusters.reduce((s, c) => s + c.totalSuccesses, 0);
    const byType   = {};
    for (const c of clusters) {
        if (!byType[c.failureType]) byType[c.failureType] = { attempts: 0, successes: 0 };
        byType[c.failureType].attempts  += c.totalAttempts;
        byType[c.failureType].successes += c.totalSuccesses;
    }
    return {
        clusterCount: clusters.length,
        totalAttempts: total,
        totalSuccesses: success,
        globalSuccessRate: total > 0 ? parseFloat((success / total).toFixed(3)) : 0,
        byType,
    };
}

/** Wipe all state (tests only). */
function reset() { _store = {}; _save(_store); }

module.exports = { record, getBestStrategy, getSimilar, getClusters, stats, reset };
