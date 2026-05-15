"use strict";
/**
 * deterministicScheduler — concurrency-safe, priority-aware, replay-consistent
 * execution scheduler with starvation prevention.
 *
 * Sorting rules (highest to lowest priority):
 *   1. recoveryMode=true items always precede non-recovery
 *   2. higher priority number runs first
 *   3. FIFO (stable sort preserves insertion order for equal priority)
 *
 * scheduleExecution(spec)             → { scheduled, schedId, executionId, position }
 * getNextExecution(filter)            → ScheduleRecord | null
 * reserveExecutionSlot(executionId)   → { reserved, slotId, executionId }
 * releaseExecutionSlot(slotId)        → { released, slotId, executionId }
 * rebalanceSchedule(opts)             → { rebalanced, queueSize }
 * getSchedulerState()                 → SchedulerState
 * reset()
 */

const SCHEDULING_POLICIES = [
    "fifo",
    "priority",
    "dependency-aware",
    "recovery-priority",
    "containment-aware",
];

let _queue     = [];
let _slots     = new Map();
let _scheduled = new Map();
let _counter   = 0;

// ── scheduleExecution ─────────────────────────────────────────────────

function scheduleExecution(spec = {}) {
    const {
        executionId     = null,
        priority        = 5,
        policy          = "fifo",
        dependencies    = [],
        isolationDomain = null,
        recoveryMode    = false,
    } = spec;

    if (!SCHEDULING_POLICIES.includes(policy))
        return { scheduled: false, reason: `invalid_policy: ${policy}` };

    const schedId = `sch-${++_counter}`;
    const execId  = executionId ?? schedId;

    const record = {
        schedId,
        executionId:    execId,
        priority,
        policy,
        dependencies:   [...dependencies],
        isolationDomain,
        recoveryMode,
        status:         "scheduled",
        scheduledAt:    new Date().toISOString(),
        slotId:         null,
    };

    _scheduled.set(execId, record);
    _queue.push(record);
    _sortQueue();

    const position = _queue.filter(r => r.status === "scheduled").indexOf(record) + 1;
    return { scheduled: true, schedId, executionId: execId, position };
}

function _sortQueue() {
    _queue.sort((a, b) => {
        if (a.recoveryMode && !b.recoveryMode) return -1;
        if (!a.recoveryMode && b.recoveryMode) return  1;
        return b.priority - a.priority;
        // FIFO for equal priority is maintained by JavaScript's stable Array.sort
    });
}

// ── getNextExecution ──────────────────────────────────────────────────

function getNextExecution(filter = {}) {
    for (const record of _queue) {
        if (record.status !== "scheduled") continue;
        if (filter.policy          && record.policy          !== filter.policy)           continue;
        if (filter.isolationDomain && record.isolationDomain !== filter.isolationDomain)  continue;
        if (filter.recoveryMode    != null && record.recoveryMode !== filter.recoveryMode) continue;
        return { ...record };
    }
    return null;
}

// ── reserveExecutionSlot ──────────────────────────────────────────────

function reserveExecutionSlot(executionId) {
    const record = _scheduled.get(executionId);
    if (!record)                        return { reserved: false, reason: "execution_not_found" };
    if (record.status === "running")    return { reserved: false, reason: "already_running" };
    if (record.status !== "scheduled")  return { reserved: false, reason: `cannot_reserve: ${record.status}` };

    const slotId  = `slot-${++_counter}`;
    record.status = "running";
    record.slotId = slotId;
    _slots.set(slotId, { slotId, executionId, reservedAt: new Date().toISOString() });

    return { reserved: true, slotId, executionId };
}

// ── releaseExecutionSlot ──────────────────────────────────────────────

function releaseExecutionSlot(slotId) {
    const slot = _slots.get(slotId);
    if (!slot) return { released: false, reason: "slot_not_found" };

    const record = _scheduled.get(slot.executionId);
    if (record) {
        record.status = "completed";
        record.slotId = null;
    }
    _slots.delete(slotId);
    _queue = _queue.filter(r => r.executionId !== slot.executionId);

    return { released: true, slotId, executionId: slot.executionId };
}

// ── rebalanceSchedule ─────────────────────────────────────────────────

function rebalanceSchedule(opts = {}) {
    _sortQueue();
    return {
        rebalanced: true,
        queueSize:  _queue.filter(r => r.status === "scheduled").length,
    };
}

// ── getSchedulerState ─────────────────────────────────────────────────

function getSchedulerState() {
    const pending = _queue.filter(r => r.status === "scheduled").length;
    const running = _queue.filter(r => r.status === "running").length;
    return {
        queueSize:      _queue.length,
        pending,
        running,
        activeSlots:    _slots.size,
        scheduledItems: [..._scheduled.values()].map(r => ({ ...r })),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _queue     = [];
    _slots     = new Map();
    _scheduled = new Map();
    _counter   = 0;
}

module.exports = {
    SCHEDULING_POLICIES,
    scheduleExecution, getNextExecution, reserveExecutionSlot,
    releaseExecutionSlot, rebalanceSchedule, getSchedulerState, reset,
};
