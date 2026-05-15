"use strict";
/**
 * reliabilityWeighter — tier-based priority weight for workflow scheduling.
 *
 * weight(workflowId)          → { weight, tier, basis }
 * rank(workflowIds[])         → sorted [{workflowId, weight, tier}] desc
 * setOverride(id, weight)     — manual override for testing
 * clearOverride(id)
 * reset()
 *
 * Tiers: "trusted"(≥0.80) | "stable"(≥0.60) | "degraded"(≥0.40) | "unreliable"(<0.40)
 */

const history = require("../executionHistory.cjs");

const TIERS = [
    { name: "trusted",    min: 0.80 },
    { name: "stable",     min: 0.60 },
    { name: "degraded",   min: 0.40 },
    { name: "unreliable", min: 0.00 },
];

const _overrides = new Map();

function weight(workflowId) {
    if (_overrides.has(workflowId)) {
        const w = _overrides.get(workflowId);
        return { weight: w, tier: _tier(w), basis: "override" };
    }

    const recs = history.byType(`workflow:${workflowId}`);
    if (recs.length === 0) {
        return { weight: 0.50, tier: "stable", basis: "no_history" };
    }

    // Weighted: last 10 runs count more
    const recent  = recs.slice(0, 10);
    const older   = recs.slice(10, 30);

    const recentRate = recent.filter(r => r.success).length / recent.length;
    const olderRate  = older.length > 0
        ? older.filter(r => r.success).length / older.length
        : recentRate;

    const w = parseFloat((recentRate * 0.70 + olderRate * 0.30).toFixed(3));
    return { weight: w, tier: _tier(w), basis: "history" };
}

function rank(workflowIds) {
    return workflowIds
        .map(id => ({ workflowId: id, ...weight(id) }))
        .sort((a, b) => b.weight - a.weight);
}

function setOverride(workflowId, w) {
    _overrides.set(workflowId, Math.min(1, Math.max(0, w)));
}

function clearOverride(workflowId) {
    _overrides.delete(workflowId);
}

function reset() { _overrides.clear(); }

function _tier(w) {
    for (const t of TIERS) if (w >= t.min) return t.name;
    return "unreliable";
}

module.exports = { weight, rank, setOverride, clearOverride, reset, TIERS };
