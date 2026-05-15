"use strict";
/**
 * orchestrationMemory — persists orchestration intelligence.
 *
 * Stores:
 *   - historically unstable workflows
 *   - overload patterns
 *   - trusted execution paths
 *   - stable dependency routes
 *   - successful recovery patterns
 */

let _unstable         = new Map();  // fingerprint → { reason, count, lastSeenAt }
let _overloadPatterns = [];
let _trustedPaths     = new Map();  // fingerprint → { strategy, successCount, ts }
let _stableRoutes     = new Map();  // routeKey → { quality, uses, ts }
let _recoveryPatterns = new Map();  // fingerprint → RecoveryPattern[]

// ── unstable workflows ────────────────────────────────────────────────

function recordUnstable(fingerprint, reason) {
    const existing = _unstable.get(fingerprint);
    _unstable.set(fingerprint, {
        reason,
        count:      (existing?.count ?? 0) + 1,
        lastSeenAt: new Date().toISOString(),
    });
}

function isUnstable(fingerprint)    { return _unstable.has(fingerprint); }

function getUnstable()              {
    return [..._unstable.entries()].map(([fp, meta]) => ({ fingerprint: fp, ...meta }));
}

function clearUnstable(fingerprint) { _unstable.delete(fingerprint); }

// ── overload patterns ─────────────────────────────────────────────────

function recordOverloadPattern(pattern) {
    _overloadPatterns.push({
        ...pattern,
        recordedAt: new Date().toISOString(),
    });
    if (_overloadPatterns.length > 100) _overloadPatterns.shift();
}

function getOverloadPatterns()      { return [..._overloadPatterns]; }

// ── trusted paths ─────────────────────────────────────────────────────

function recordTrustedPath(fingerprint, strategy, durationMs = 0) {
    const existing = _trustedPaths.get(fingerprint);
    _trustedPaths.set(fingerprint, {
        strategy,
        successCount: (existing?.successCount ?? 0) + 1,
        avgDurationMs: existing
            ? (existing.avgDurationMs * existing.successCount + durationMs) / (existing.successCount + 1)
            : durationMs,
        ts: new Date().toISOString(),
    });
}

function getTrustedPath(fingerprint) { return _trustedPaths.get(fingerprint) ?? null; }

function getAllTrustedPaths()         {
    return [..._trustedPaths.entries()].map(([fp, meta]) => ({ fingerprint: fp, ...meta }));
}

// ── stable dependency routes ──────────────────────────────────────────

function recordStableRoute(routeKey, quality = 1.0) {
    const existing = _stableRoutes.get(routeKey);
    _stableRoutes.set(routeKey, {
        quality,
        uses:  (existing?.uses ?? 0) + 1,
        ts:    new Date().toISOString(),
    });
}

function getStableRoute(routeKey)    { return _stableRoutes.get(routeKey) ?? null; }

function getAllStableRoutes()         {
    return [..._stableRoutes.entries()].map(([key, meta]) => ({ routeKey: key, ...meta }));
}

// ── recovery patterns ─────────────────────────────────────────────────

function recordRecoveryPattern(fingerprint, pattern) {
    if (!_recoveryPatterns.has(fingerprint)) _recoveryPatterns.set(fingerprint, []);
    _recoveryPatterns.get(fingerprint).push({
        ...pattern,
        recordedAt: new Date().toISOString(),
    });
}

function getRecoveryPatterns(fingerprint) {
    return [...(_recoveryPatterns.get(fingerprint) ?? [])];
}

function getBestRecoveryPattern(fingerprint) {
    const patterns = _recoveryPatterns.get(fingerprint) ?? [];
    return patterns.filter(p => p.success).at(-1) ?? null;
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _unstable         = new Map();
    _overloadPatterns = [];
    _trustedPaths     = new Map();
    _stableRoutes     = new Map();
    _recoveryPatterns = new Map();
}

module.exports = {
    recordUnstable, isUnstable, getUnstable, clearUnstable,
    recordOverloadPattern, getOverloadPatterns,
    recordTrustedPath, getTrustedPath, getAllTrustedPaths,
    recordStableRoute, getStableRoute, getAllStableRoutes,
    recordRecoveryPattern, getRecoveryPatterns, getBestRecoveryPattern,
    reset,
};
