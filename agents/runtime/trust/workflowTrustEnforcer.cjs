"use strict";
/**
 * workflowTrustEnforcer — execution autonomy control based on reliability history.
 *
 * register(workflowId, opts?)    — create trust record
 * recordOutcome(workflowId, success)  — update trust state
 * getStatus(workflowId)
 *   → { trustLevel, throttled, requiresApproval, autonomyLevel, streak, successRate }
 * canExecute(workflowId)
 *   → { allowed, reason, requiresApproval, throttleMs }
 * reset()
 *
 * Trust levels:
 *   "autonomous"  — successRate ≥ 0.80 AND consecutiveFails < 2
 *   "monitored"   — successRate ≥ 0.50 AND consecutiveFails < 3
 *   "throttled"   — consecutiveFails ≥ 3 OR successRate < 0.50
 *   "suspended"   — consecutiveFails ≥ 5 OR successRate < 0.20
 */

const CONSECUTIVE_THROTTLE  = 3;
const CONSECUTIVE_SUSPEND   = 5;
const THROTTLE_MS           = 2_000;

// workflowId → { outcomes[], consecutiveFails, consecutiveSuccesses, registeredAt, meta }
const _workflows = new Map();

function register(workflowId, opts = {}) {
    if (_workflows.has(workflowId)) return _workflows.get(workflowId);
    const rec = {
        workflowId,
        outcomes:             [],
        consecutiveFails:     0,
        consecutiveSuccesses: 0,
        registeredAt:         new Date().toISOString(),
        meta:                 opts,
    };
    _workflows.set(workflowId, rec);
    return rec;
}

function recordOutcome(workflowId, success) {
    if (!_workflows.has(workflowId)) register(workflowId);
    const rec = _workflows.get(workflowId);
    rec.outcomes.push({ success: !!success, ts: new Date().toISOString() });

    if (success) {
        rec.consecutiveFails     = 0;
        rec.consecutiveSuccesses++;
    } else {
        rec.consecutiveSuccesses = 0;
        rec.consecutiveFails++;
    }
}

function getStatus(workflowId) {
    if (!_workflows.has(workflowId)) register(workflowId);
    const rec = _workflows.get(workflowId);

    const outcomes    = rec.outcomes;
    const total       = outcomes.length;
    const successes   = outcomes.filter(o => o.success).length;
    const successRate = total > 0 ? parseFloat((successes / total).toFixed(3)) : null;

    const trustLevel  = _computeTrustLevel(rec, successRate);
    const throttled   = trustLevel === "throttled" || trustLevel === "suspended";
    const requiresApproval = trustLevel === "suspended" || trustLevel === "throttled";

    const autonomyLevels = {
        autonomous: "full",
        monitored:  "supervised",
        throttled:  "restricted",
        suspended:  "blocked",
    };

    return {
        workflowId,
        trustLevel,
        throttled,
        requiresApproval,
        autonomyLevel:        autonomyLevels[trustLevel] || "supervised",
        streak:               successes > 0 ? rec.consecutiveSuccesses : -rec.consecutiveFails,
        successRate,
        consecutiveFails:     rec.consecutiveFails,
        totalRuns:            total,
    };
}

function canExecute(workflowId) {
    const status = getStatus(workflowId);

    if (status.trustLevel === "suspended") {
        return {
            allowed:          false,
            reason:           `suspended: ${status.consecutiveFails} consecutive failures`,
            requiresApproval: true,
            throttleMs:       0,
        };
    }
    if (status.trustLevel === "throttled") {
        return {
            allowed:          true,
            reason:           `throttled: execution delayed ${THROTTLE_MS}ms`,
            requiresApproval: true,
            throttleMs:       THROTTLE_MS,
        };
    }
    if (status.trustLevel === "monitored") {
        return {
            allowed:          true,
            reason:           "monitored: execution allowed with oversight",
            requiresApproval: false,
            throttleMs:       0,
        };
    }

    return {
        allowed:          true,
        reason:           "autonomous: trusted workflow",
        requiresApproval: false,
        throttleMs:       0,
    };
}

const MIN_SAMPLES_FOR_RATE = 5;   // need this many runs before rate-based tiers kick in

function _computeTrustLevel(rec, successRate) {
    const total = rec.outcomes.length;
    // Consecutive-fail signals take priority — they're always actionable
    if (rec.consecutiveFails >= CONSECUTIVE_SUSPEND)  return "suspended";
    if (rec.consecutiveFails >= CONSECUTIVE_THROTTLE) return "throttled";
    // Rate-based signals only meaningful with sufficient history
    if (successRate !== null && total >= MIN_SAMPLES_FOR_RATE) {
        if (successRate < 0.20) return "suspended";
        if (successRate < 0.50) return "throttled";
    }
    if (successRate === null || successRate < 0.80) return "monitored";
    if (rec.consecutiveFails >= 2)                  return "monitored";
    return "autonomous";
}

function listAll() {
    return [..._workflows.keys()].map(id => getStatus(id));
}

function reset() { _workflows.clear(); }

module.exports = {
    register,
    recordOutcome,
    getStatus,
    canExecute,
    listAll,
    reset,
    CONSECUTIVE_THROTTLE,
    CONSECUTIVE_SUSPEND,
    THROTTLE_MS,
};
