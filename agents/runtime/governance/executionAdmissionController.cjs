"use strict";
/**
 * executionAdmissionController — workflow admission control, overload prevention,
 * execution throttling, and runtime saturation protection.
 *
 * validateAdmission(spec)           → { admitted, admId, workflowId }
 * throttleWorkflow(spec)            → { throttled, workflowId }
 * rejectWorkflow(spec)              → { rejected, rejId, workflowId }
 * getAdmissionState()               → AdmissionState
 * calculateAdmissionPressure(spec)  → { score, pressure }
 * reset()
 *
 * Detects: runtime overload, unsafe concurrency spikes, replay saturation,
 *          recovery saturation, unstable workflow bursts.
 */

const REJECTION_REASONS = [
    "runtime_overloaded", "concurrency_spike", "replay_saturated",
    "recovery_saturated", "workflow_burst", "blacklisted",
    "queue_depth_exceeded", "retry_burst_limit", "workflow_throttled",
];

const DEFAULT_LIMITS = {
    maxConcurrent:   50,
    maxQueueDepth:   200,
    maxRetryBurst:   10,
    maxRecoveryLoad: 20,
};

let _admissions = new Map();
let _throttled  = new Set();
let _rejected   = [];
let _counter    = 0;
let _limits     = { ...DEFAULT_LIMITS };

// ── validateAdmission ─────────────────────────────────────────────────

function validateAdmission(spec = {}) {
    const {
        workflowId          = null,
        currentConcurrent   = 0,
        currentQueueDepth   = 0,
        currentRetryBurst   = 0,
        currentRecoveryLoad = 0,
        recoveryMode        = false,
        isolationDomain     = "default",
    } = spec;

    if (!workflowId) return { admitted: false, reason: "workflowId_required" };

    if (_throttled.has(workflowId))
        return { admitted: false, reason: "workflow_throttled", workflowId };

    if (currentConcurrent >= _limits.maxConcurrent)
        return { admitted: false, reason: "runtime_overloaded",
                 concurrent: currentConcurrent, max: _limits.maxConcurrent };

    if (currentQueueDepth >= _limits.maxQueueDepth)
        return { admitted: false, reason: "queue_depth_exceeded",
                 queueDepth: currentQueueDepth, max: _limits.maxQueueDepth };

    if (currentRetryBurst >= _limits.maxRetryBurst)
        return { admitted: false, reason: "retry_burst_limit",
                 retryBurst: currentRetryBurst, max: _limits.maxRetryBurst };

    if (!recoveryMode && currentRecoveryLoad >= _limits.maxRecoveryLoad)
        return { admitted: false, reason: "recovery_saturated",
                 recoveryLoad: currentRecoveryLoad, max: _limits.maxRecoveryLoad };

    const admId = `adm-${++_counter}`;
    _admissions.set(workflowId, {
        admId, workflowId, isolationDomain, recoveryMode,
        admittedAt: new Date().toISOString(), status: "admitted",
    });

    return { admitted: true, admId, workflowId };
}

// ── throttleWorkflow ──────────────────────────────────────────────────

function throttleWorkflow(spec = {}) {
    const { workflowId = null, reason = "pressure" } = spec;
    if (!workflowId) return { throttled: false, reason: "workflowId_required" };

    _throttled.add(workflowId);
    const rec = _admissions.get(workflowId);
    if (rec) rec.status = "throttled";

    return { throttled: true, workflowId, reason };
}

// ── rejectWorkflow ────────────────────────────────────────────────────

function rejectWorkflow(spec = {}) {
    const { workflowId = null, reason = "unspecified" } = spec;
    if (!workflowId) return { rejected: false, reason: "workflowId_required" };

    const rejId = `rej-${++_counter}`;
    _rejected.push({ rejId, workflowId, reason, rejectedAt: new Date().toISOString() });

    const rec = _admissions.get(workflowId);
    if (rec) rec.status = "rejected";

    return { rejected: true, rejId, workflowId, reason };
}

// ── getAdmissionState ─────────────────────────────────────────────────

function getAdmissionState() {
    const admitted  = [..._admissions.values()].filter(r => r.status === "admitted").length;
    return {
        totalAdmitted:  admitted,
        totalThrottled: _throttled.size,
        totalRejected:  _rejected.length,
        limits:         { ..._limits },
    };
}

// ── calculateAdmissionPressure ────────────────────────────────────────

function calculateAdmissionPressure(spec = {}) {
    const { currentConcurrent = 0, currentQueueDepth = 0 } = spec;

    const concurrencyRatio = currentConcurrent / _limits.maxConcurrent;
    const queueRatio       = currentQueueDepth  / _limits.maxQueueDepth;
    const score            = Math.min(1, (concurrencyRatio + queueRatio) / 2);

    const pressure = score >= 0.9 ? "critical"
                   : score >= 0.7 ? "high"
                   : score >= 0.4 ? "medium"
                   :                "low";

    return {
        score:             +score.toFixed(3),
        pressure,
        concurrencyRatio:  +concurrencyRatio.toFixed(3),
        queueRatio:        +queueRatio.toFixed(3),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _admissions = new Map();
    _throttled  = new Set();
    _rejected   = [];
    _counter    = 0;
    _limits     = { ...DEFAULT_LIMITS };
}

module.exports = {
    REJECTION_REASONS,
    validateAdmission, throttleWorkflow, rejectWorkflow,
    getAdmissionState, calculateAdmissionPressure, reset,
};
