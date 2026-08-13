"use strict";
/**
 * Prerequisite gate for the autonomous runtime.
 *
 * Prevents the loop from re-queuing work indefinitely when upstream
 * prerequisites (AI availability, git health, local services) are failing.
 * The gate is intentionally conservative: repeated failures cause a temporary
 * block, and the runtime stays idle until the prerequisite state improves.
 */

const logger = require("../../backend/utils/logger");

const FAILURE_THRESHOLD = 3;
const BLOCK_WINDOW_MS = 60_000;
const _state = {
    consecutiveFailures: 0,
    blockedUntil: 0,
    lastFailureAt: null,
    lastReasons: [],
};

function resetGateState() {
    _state.consecutiveFailures = 0;
    _state.blockedUntil = 0;
    _state.lastFailureAt = null;
    _state.lastReasons = [];
}

async function checkPrerequisites({ aiService, gitRunner, now = Date.now() } = {}) {
    if (now < _state.blockedUntil) {
        const reasons = [...(_state.lastReasons || []), `runtime_blocked_until_${new Date(_state.blockedUntil).toISOString()}`];
        return {
            ok: false,
            blocked: true,
            reasons,
            state: { ..._state },
        };
    }

    const reasons = [];

    try {
        const aiStatus = aiService && typeof aiService.getAIStatus === "function"
            ? await aiService.getAIStatus()
            : null;
        const providers = aiStatus?.providers || [];
        const healthyProvider = providers.some(p => p?.health?.ok === true);
        if (!healthyProvider) {
            reasons.push("AI backend unavailable");
        }
    } catch (err) {
        reasons.push(`AI probe failed: ${err.message}`);
    }

    try {
        if (typeof gitRunner === "function") {
            const result = await gitRunner();
            if (result !== true) {
                reasons.push("git health check failed");
            }
        }
    } catch (err) {
        reasons.push(`git probe failed: ${err.message}`);
    }

    const ok = reasons.length === 0;
    if (!ok) {
        _state.consecutiveFailures += 1;
        _state.lastFailureAt = now;
        _state.lastReasons = reasons;
        if (_state.consecutiveFailures >= FAILURE_THRESHOLD) {
            _state.blockedUntil = now + BLOCK_WINDOW_MS;
            logger.warn(`[PrereqGate] repeated prerequisite failures (${_state.consecutiveFailures}) — blocking runtime for ${BLOCK_WINDOW_MS / 1000}s`);
        }
    } else {
        _state.consecutiveFailures = 0;
        _state.blockedUntil = 0;
        _state.lastReasons = [];
    }

    return {
        ok,
        blocked: false,
        reasons,
        state: { ..._state },
    };
}

function getGateState() {
    return { ..._state };
}

module.exports = { checkPrerequisites, getGateState, resetGateState };
