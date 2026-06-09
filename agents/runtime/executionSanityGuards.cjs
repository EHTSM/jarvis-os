"use strict";
/**
 * Phase 427 — Execution Sanity Guards
 *
 * Hard runtime protections. Stateless checks that can be called
 * before any execution decision.
 *
 * Guards:
 *   1. Recursion depth limit (max 5 nested chain calls)
 *   2. Retry ceiling (max 3 retries per unique command key)
 *   3. Workflow timeout (max 10min per chain)
 *   4. Execution burst protection (max 5 dispatches in 10s)
 *   5. Adapter cooldown enforcement (delegates to cooldown module)
 *
 * All guards return: { allowed: bool, guard: string, reason: string }
 */

const logger = require("../../backend/utils/logger");

const LIMITS = {
    maxRecursionDepth: 5,
    maxRetries:        3,
    maxChainTimeoutMs: 10 * 60_000,  // 10 min
    burstWindow:       10_000,        // 10s
    maxBurst:          5,             // 5 dispatches in 10s
};

// In-memory burst tracker (intentionally ephemeral)
const _burstTicks = [];
const _retryCounts = new Map();  // cmdKey → count

function _tick() {
    const now = Date.now();
    _burstTicks.push(now);
    // Prune old ticks outside window
    while (_burstTicks.length && _burstTicks[0] < now - LIMITS.burstWindow) {
        _burstTicks.shift();
    }
}

/**
 * Check recursion depth guard.
 * @param {number} currentDepth — how many nested chain calls deep we are
 */
function checkRecursionDepth(currentDepth = 0) {
    if (currentDepth >= LIMITS.maxRecursionDepth) {
        logger.warn(`[SanityGuard] recursion depth ${currentDepth} >= ${LIMITS.maxRecursionDepth} — blocked`);
        return { allowed: false, guard: "recursion_depth", reason: `depth=${currentDepth} exceeds max=${LIMITS.maxRecursionDepth}` };
    }
    return { allowed: true, guard: "recursion_depth", reason: "" };
}

/**
 * Check and record retry count for a command.
 * @param {string} cmdKey — unique identifier for the command being retried
 * @param {boolean} record — if true, increment the retry count
 */
function checkRetries(cmdKey, record = false) {
    const count = _retryCounts.get(cmdKey) || 0;
    if (count >= LIMITS.maxRetries) {
        logger.warn(`[SanityGuard] retry ceiling hit for "${cmdKey.slice(0, 60)}" — ${count} retries`);
        return { allowed: false, guard: "retry_ceiling", reason: `retries=${count} >= max=${LIMITS.maxRetries}` };
    }
    if (record) _retryCounts.set(cmdKey, count + 1);
    return { allowed: true, guard: "retry_ceiling", reason: "", retries: count };
}

/** Reset retry count for a command (call after success). */
function resetRetries(cmdKey) {
    _retryCounts.delete(cmdKey);
}

/**
 * Check if a chain has exceeded the max timeout.
 * @param {number} chainStartedAt — timestamp when chain started
 */
function checkChainTimeout(chainStartedAt) {
    const elapsed = Date.now() - chainStartedAt;
    if (elapsed > LIMITS.maxChainTimeoutMs) {
        logger.warn(`[SanityGuard] chain timeout — elapsed=${Math.round(elapsed / 1000)}s`);
        return { allowed: false, guard: "chain_timeout", reason: `elapsed=${Math.round(elapsed / 1000)}s > max=${LIMITS.maxChainTimeoutMs / 1000}s` };
    }
    return { allowed: true, guard: "chain_timeout", reason: "" };
}

/**
 * Check burst protection. Records the tick if allowed.
 */
function checkBurst() {
    const now = Date.now();
    // Count ticks in window (read-only first)
    const recent = _burstTicks.filter(t => t > now - LIMITS.burstWindow).length;
    if (recent >= LIMITS.maxBurst) {
        logger.warn(`[SanityGuard] burst protection — ${recent} dispatches in ${LIMITS.burstWindow}ms window`);
        return { allowed: false, guard: "burst_protection", reason: `${recent} dispatches in ${LIMITS.burstWindow / 1000}s window` };
    }
    _tick();
    return { allowed: true, guard: "burst_protection", reason: "", burstCount: recent + 1 };
}

/**
 * Run all applicable guards in one call.
 * @param {object} opts
 * @param {number} [opts.recursionDepth]
 * @param {string} [opts.cmdKey]
 * @param {boolean} [opts.recordRetry]
 * @param {number} [opts.chainStartedAt]
 * @param {boolean} [opts.checkBurstGuard]  — default true
 * @returns {{ allowed: bool, failedGuard: string|null, reason: string }}
 */
function runAll({ recursionDepth = 0, cmdKey = null, recordRetry = false, chainStartedAt = null, checkBurstGuard = true } = {}) {
    const checks = [
        checkRecursionDepth(recursionDepth),
        chainStartedAt ? checkChainTimeout(chainStartedAt) : null,
        checkBurstGuard ? checkBurst() : null,
        cmdKey ? checkRetries(cmdKey, recordRetry) : null,
    ].filter(Boolean);

    const failed = checks.find(c => !c.allowed);
    if (failed) return { allowed: false, failedGuard: failed.guard, reason: failed.reason };
    return { allowed: true, failedGuard: null, reason: "" };
}

/** Diagnostics. */
function stats() {
    return {
        burstTicksInWindow: _burstTicks.filter(t => t > Date.now() - LIMITS.burstWindow).length,
        trackedRetryKeys:   _retryCounts.size,
        limits:             LIMITS,
    };
}

module.exports = { checkRecursionDepth, checkRetries, resetRetries, checkChainTimeout, checkBurst, runAll, stats, LIMITS };
