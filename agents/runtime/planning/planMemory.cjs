"use strict";
/**
 * planMemory — stores plan outcome patterns for future reference.
 *
 * recordSuccess(planId, hash, pattern?)
 * recordFailure(planId, hash, reason, pattern?)
 * recordHighRisk(planId, riskFactors[])
 * recordDepFailure(depName, reason)
 * lookup(hash)                  → { found, outcome, pattern?, ts? }
 * getSuccessfulPatterns(n?)     → most-recent n
 * getFailedPatterns(n?)
 * getHighRiskPaths(n?)
 * getCommonDepFailures(n?)
 * reset()
 */

const _success  = [];
const _failed   = [];
const _highRisk = [];
const _depFails = new Map();

// ── record ─────────────────────────────────────────────────────────────

function recordSuccess(planId, hash, pattern = null) {
    _success.push({ planId, hash, pattern, ts: new Date().toISOString() });
}

function recordFailure(planId, hash, reason = "unknown", pattern = null) {
    _failed.push({ planId, hash, reason, pattern, ts: new Date().toISOString() });
}

function recordHighRisk(planId, riskFactors = []) {
    _highRisk.push({ planId, riskFactors: [...riskFactors], ts: new Date().toISOString() });
}

function recordDepFailure(depName, reason = "unavailable") {
    if (!_depFails.has(depName)) _depFails.set(depName, { count: 0, reasons: [] });
    const rec = _depFails.get(depName);
    rec.count++;
    if (!rec.reasons.includes(reason)) rec.reasons.push(reason);
}

// ── lookup ─────────────────────────────────────────────────────────────
// Checks success first, then failure — most recent wins.

function lookup(hash) {
    const s = [..._success].reverse().find(r => r.hash === hash);
    if (s) return { found: true, outcome: "success", pattern: s.pattern, ts: s.ts };
    const f = [..._failed].reverse().find(r => r.hash === hash);
    if (f) return { found: true, outcome: "failure", reason: f.reason, pattern: f.pattern, ts: f.ts };
    return { found: false };
}

// ── getters ────────────────────────────────────────────────────────────

function getSuccessfulPatterns(n = 10) { return _success.slice(-n).reverse(); }
function getFailedPatterns(n = 10)     { return _failed.slice(-n).reverse(); }
function getHighRiskPaths(n = 10)      { return _highRisk.slice(-n).reverse(); }

function getCommonDepFailures(n = 10) {
    return [..._depFails.entries()]
        .map(([name, rec]) => ({ name, count: rec.count, reasons: rec.reasons }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

function reset() {
    _success.length  = 0;
    _failed.length   = 0;
    _highRisk.length = 0;
    _depFails.clear();
}

module.exports = {
    recordSuccess,
    recordFailure,
    recordHighRisk,
    recordDepFailure,
    lookup,
    getSuccessfulPatterns,
    getFailedPatterns,
    getHighRiskPaths,
    getCommonDepFailures,
    reset,
};
