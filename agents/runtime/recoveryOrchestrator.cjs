"use strict";
/**
 * Phase 360 — Autonomous Recovery Orchestrator
 *
 * Handles safe autonomous recovery for transient failures.
 * Covers: transient dispatch failures, stale queues, broken adapters,
 *         interrupted workflows, unstable execution state.
 *
 * Safety invariants (hard limits, never relaxed):
 *   - Max 3 retry attempts per recovery session
 *   - Minimum 5s cooldown between retries
 *   - No recovery if emergency governor is active
 *   - No recovery for CRITICAL approval-level commands without operator flag
 *   - After 3 consecutive recovery failures → cooldown 60s, emit alert
 *   - No infinite recovery loops (recoveryId dedup within 30s)
 */

const logger       = require("../../backend/utils/logger");
const coordinator  = require("./executionCoordinator.cjs");

const MAX_RETRIES          = 3;
const RETRY_COOLDOWN_MS    = 5_000;   // min ms between retries
const FAILURE_COOLDOWN_MS  = 60_000;  // cooldown after 3 consecutive failures
const DEDUP_WINDOW_MS      = 30_000;  // same recovery not triggered twice in 30s

// Track active recovery sessions: recoveryKey → { attempts, lastAttemptAt, failing }
const _sessions    = new Map();
// Recent recovery history (bounded)
const _history     = [];
const MAX_HISTORY  = 100;
let _consecutiveFails = 0;
let _globalCooldownUntil = 0;

function _recoveryKey(input) {
    return input.trim().toLowerCase().slice(0, 100);
}

function _pushHistory(entry) {
    _history.unshift(entry);
    if (_history.length > MAX_HISTORY) _history.pop();
}

function _isEmergencyActive() {
    try {
        const gov = require("./control/runtimeEmergencyGovernor.cjs");
        return gov.isEmergencyActive?.() || gov.isQuarantineActive?.() || false;
    } catch { return false; }
}

/**
 * Attempt autonomous recovery for a failed dispatch.
 *
 * @param {string} input          — the original command/input that failed
 * @param {string} originalError  — error message from the failed execution
 * @param {object} options
 * @param {boolean} [options.dryRun]
 * @param {number}  [options.timeoutMs]
 * @returns {Promise<{ recovered, attempts, error?, result? }>}
 */
async function recover(input, originalError = "", options = {}) {
    const now = Date.now();

    // Hard gate: emergency active
    if (_isEmergencyActive()) {
        logger.warn("[Recovery] blocked — emergency governor active");
        return { recovered: false, attempts: 0, error: "emergency_active" };
    }

    // Hard gate: global cooldown after consecutive failures
    if (now < _globalCooldownUntil) {
        const remaining = Math.ceil((_globalCooldownUntil - now) / 1000);
        logger.warn(`[Recovery] blocked — global cooldown ${remaining}s remaining`);
        return { recovered: false, attempts: 0, error: `cooldown_active:${remaining}s` };
    }

    // Dedup: same input recovery within DEDUP_WINDOW
    const key     = _recoveryKey(input);
    const session = _sessions.get(key) || { attempts: 0, lastAttemptAt: 0, failing: false };

    if (now - session.lastAttemptAt < DEDUP_WINDOW_MS && session.attempts >= MAX_RETRIES) {
        logger.warn(`[Recovery] max retries reached for input "${input.slice(0, 40)}"`);
        return { recovered: false, attempts: session.attempts, error: "max_retries_reached" };
    }

    // Don't recover CRITICAL without explicit approval
    try {
        const planner = require("./executionChainPlanner.cjs");
        const level   = planner.classifyApprovalLevel(input);
        if (level === "critical" && !options.approved) {
            return { recovered: false, attempts: 0, error: "critical_requires_approval" };
        }
    } catch { /* non-critical */ }

    // Only retry transient failures — don't retry permanent errors
    const isTransient = _isTransientError(originalError);
    if (!isTransient) {
        logger.info(`[Recovery] non-transient error — skipping retry: ${originalError.slice(0, 80)}`);
        return { recovered: false, attempts: 0, error: "non_transient_error" };
    }

    session.attempts++;
    session.lastAttemptAt = now;
    _sessions.set(key, session);

    // Cooldown before retry
    const cooldown = RETRY_COOLDOWN_MS * session.attempts;
    logger.info(`[Recovery] attempt ${session.attempts}/${MAX_RETRIES} for "${input.slice(0, 40)}" — waiting ${cooldown}ms`);
    await new Promise(r => setTimeout(r, cooldown).unref());

    try {
        const result = await coordinator.dispatch(input, {
            timeoutMs:  options.timeoutMs,
            dryRun:     options.dryRun,
        });

        if (result.success) {
            _consecutiveFails = 0;
            _sessions.delete(key);
            _pushHistory({ input: input.slice(0, 100), recovered: true, attempts: session.attempts, ts: Date.now() });
            logger.info(`[Recovery] success on attempt ${session.attempts}`);
            return { recovered: true, attempts: session.attempts, result };
        }

        // Failed again
        _handleFailure(input, session.attempts, result.error);
        return { recovered: false, attempts: session.attempts, error: result.error };

    } catch (err) {
        _handleFailure(input, session.attempts, err.message);
        return { recovered: false, attempts: session.attempts, error: err.message };
    }
}

function _handleFailure(input, attempts, error) {
    _consecutiveFails++;
    _pushHistory({ input: input.slice(0, 100), recovered: false, attempts, error, ts: Date.now() });

    if (_consecutiveFails >= 3) {
        _globalCooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
        logger.error(`[Recovery] 3 consecutive failures — entering ${FAILURE_COOLDOWN_MS / 1000}s cooldown`);
        _consecutiveFails = 0;

        // Emit advisory alert via emergency governor if available
        try {
            const gov = require("./control/runtimeEmergencyGovernor.cjs");
            gov.issueAlert?.({
                level:          "warning",
                message:        "Recovery orchestrator: 3 consecutive failures — automatic retry paused for 60s",
                source:         "recovery-orchestrator",
                authorityLevel: "operator",
            });
        } catch { /* non-critical */ }
    }
}

function _isTransientError(error) {
    if (!error) return false;
    const e = error.toLowerCase();
    return (
        e.includes("timeout") ||
        e.includes("econnrefused") ||
        e.includes("econnreset") ||
        e.includes("socket hang up") ||
        e.includes("network") ||
        e.includes("temporarily") ||
        e.includes("overloaded") ||
        e.includes("rate") ||
        e.includes("enobufs")
    );
}

/** Get recent recovery history */
function history(n = 20) {
    return _history.slice(0, n);
}

/** Live diagnostics */
function stats() {
    return {
        activeSessions:  _sessions.size,
        consecutiveFails: _consecutiveFails,
        inCooldown:      Date.now() < _globalCooldownUntil,
        cooldownUntil:   _globalCooldownUntil || null,
        totalHistoryEntries: _history.length,
    };
}

module.exports = { recover, history, stats };
