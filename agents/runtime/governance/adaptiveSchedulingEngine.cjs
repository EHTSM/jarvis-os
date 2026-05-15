"use strict";
/**
 * adaptiveSchedulingEngine — adaptive workflow scheduling, execution
 * prioritization, scheduling policy selection, and pressure-aware scheduling.
 *
 * scheduleWorkflow(spec)          → { scheduled, schedId, workflowId, policy }
 * selectSchedulingPolicy(spec)    → { policy, reason }
 * reprioritizeWorkflow(id, p)     → { reprioritized, schedId, oldPriority }
 * getSchedulingQueue(opts)        → ScheduleEntry[]
 * detectSchedulingPressure()      → PressureReport
 * reset()
 *
 * Policies: fifo, priority-first, shortest-job-first, recovery-priority,
 *           starvation-safe, isolation-aware, deterministic-fair-share
 */

const SCHEDULING_POLICIES = [
    "fifo", "priority-first", "shortest-job-first",
    "recovery-priority", "starvation-safe",
    "isolation-aware", "deterministic-fair-share",
];

let _queue         = [];
let _counter       = 0;
let _currentPolicy = "priority-first";

// ── scheduleWorkflow ──────────────────────────────────────────────────

function scheduleWorkflow(spec = {}) {
    const {
        workflowId        = null,
        priority          = 5,
        estimatedDuration = null,
        retryCount        = 0,
        recoveryMode      = false,
        isolationDomain   = "default",
        isolationPressure = 0,
        contentionScore   = 0,
    } = spec;

    if (!workflowId) return { scheduled: false, reason: "workflowId_required" };

    const schedId = `sched-${++_counter}`;
    _queue.push({
        schedId,
        workflowId,
        priority,
        estimatedDuration,
        retryCount,
        recoveryMode,
        isolationDomain,
        isolationPressure,
        contentionScore,
        age:         0,
        status:      "scheduled",
        scheduledAt: new Date().toISOString(),
    });

    return { scheduled: true, schedId, workflowId, policy: _currentPolicy };
}

// ── selectSchedulingPolicy ────────────────────────────────────────────

function selectSchedulingPolicy(spec = {}) {
    const {
        activeRecoveryCount = 0,
        starvationDetected  = false,
        currentPressure     = 0,
    } = spec;

    let policy;
    let reason;

    if (activeRecoveryCount > 0) {
        policy = "recovery-priority";
        reason = "active_recovery_detected";
    } else if (starvationDetected) {
        policy = "starvation-safe";
        reason = "starvation_detected";
    } else if (currentPressure >= 0.8) {
        policy = "deterministic-fair-share";
        reason = "high_pressure";
    } else if (currentPressure >= 0.5) {
        policy = "priority-first";
        reason = "medium_pressure";
    } else {
        policy = "fifo";
        reason = "nominal";
    }

    _currentPolicy = policy;
    return { policy, reason };
}

// ── reprioritizeWorkflow ──────────────────────────────────────────────

function reprioritizeWorkflow(schedId, newPriority) {
    const entry = _queue.find(e => e.schedId === schedId);
    if (!entry)                        return { reprioritized: false, reason: "schedule_not_found" };
    if (entry.status !== "scheduled")  return { reprioritized: false, reason: "not_in_scheduled_state" };

    const oldPriority = entry.priority;
    entry.priority    = newPriority;
    return { reprioritized: true, schedId, workflowId: entry.workflowId, oldPriority, newPriority };
}

// ── getSchedulingQueue ────────────────────────────────────────────────

function getSchedulingQueue(opts = {}) {
    const { policy = _currentPolicy, status = null } = opts;
    let queue = [..._queue];
    if (status != null) queue = queue.filter(e => e.status === status);

    switch (policy) {
        case "fifo":
            break;  // insertion order preserved
        case "priority-first":
            queue.sort((a, b) => b.priority - a.priority);
            break;
        case "shortest-job-first":
            queue.sort((a, b) => {
                const da = a.estimatedDuration ?? Infinity;
                const db = b.estimatedDuration ?? Infinity;
                return da - db;
            });
            break;
        case "recovery-priority":
            queue.sort((a, b) => {
                if (a.recoveryMode !== b.recoveryMode)
                    return a.recoveryMode ? -1 : 1;
                return b.priority - a.priority;
            });
            break;
        case "starvation-safe":
            queue.sort((a, b) => b.age - a.age);
            break;
        case "isolation-aware":
            queue.sort((a, b) => b.isolationPressure - a.isolationPressure);
            break;
        case "deterministic-fair-share":
            queue.sort((a, b) => {
                const scoreA = a.priority - a.contentionScore;
                const scoreB = b.priority - b.contentionScore;
                return scoreB - scoreA;
            });
            break;
    }

    return queue;
}

// ── detectSchedulingPressure ──────────────────────────────────────────

function detectSchedulingPressure() {
    const scheduled    = _queue.filter(e => e.status === "scheduled");
    const queueDepth   = scheduled.length;
    const avgAge       = queueDepth > 0
        ? scheduled.reduce((s, e) => s + e.age, 0) / queueDepth : 0;
    const avgContention = queueDepth > 0
        ? scheduled.reduce((s, e) => s + e.contentionScore, 0) / queueDepth : 0;

    const score    = Math.min(1, (queueDepth / 100) + (avgAge / 1000) + avgContention);
    const pressure = score >= 0.8 ? "critical"
                   : score >= 0.6 ? "high"
                   : score >= 0.3 ? "medium"
                   :                "low";

    return {
        queueDepth,
        avgAge:        +avgAge.toFixed(2),
        avgContention: +avgContention.toFixed(3),
        pressureScore: +score.toFixed(3),
        pressure,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _queue         = [];
    _counter       = 0;
    _currentPolicy = "priority-first";
}

module.exports = {
    SCHEDULING_POLICIES,
    scheduleWorkflow, selectSchedulingPolicy, reprioritizeWorkflow,
    getSchedulingQueue, detectSchedulingPressure, reset,
};
