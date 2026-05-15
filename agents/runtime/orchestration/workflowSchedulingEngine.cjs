"use strict";
/**
 * workflowSchedulingEngine — schedules workflows for future/delayed execution,
 * retry scheduling, and recovery-aware rescheduling.
 *
 * scheduleWorkflow(spec)         → { scheduled, scheduleId }
 * getDueWorkflows(nowMs?)        → ScheduledEntry[]
 * cancelSchedule(scheduleId)     → { cancelled }
 * rescheduleRetry(spec)          → { rescheduled, scheduleId, scheduledAt }
 * rescheduleRecovery(spec)       → { rescheduled, scheduleId, scheduledAt }
 * getSchedule(scheduleId)        → ScheduledEntry | null
 * getSchedulingMetrics()         → SchedulingMetrics
 * reset()
 *
 * Retry backoff: exponential with jitter cap.
 *   delay = min(base * 2^(retryCount-1), maxDelay) + jitter
 * MAX_SCHEDULE_ENTRIES = 5000
 */

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS  = 60000;
const MAX_SCHEDULE_ENTRIES = 5000;

let _schedule = new Map();   // scheduleId → ScheduledEntry
let _counter  = 0;
let _fired    = 0;
let _cancelled = 0;

function _backoff(retryCount, baseMs = BASE_RETRY_DELAY_MS) {
    const exp    = baseMs * Math.pow(2, retryCount - 1);
    const capped = Math.min(exp, MAX_RETRY_DELAY_MS);
    const jitter = Math.floor(Math.random() * Math.min(capped * 0.1, 1000));
    return capped + jitter;
}

// ── scheduleWorkflow ───────────────────────────────────────────────────

function scheduleWorkflow(spec = {}) {
    const {
        workflowId     = null,
        sourceSubsystem = null,
        scheduledAt    = null,      // ISO timestamp; null = run immediately
        delayMs        = 0,
        priorityScore  = 50,
        authorityLevel = "operator",
        retryCount     = 0,
        recovery       = false,
        correlationId  = null,
        payload        = null,
    } = spec;

    if (!workflowId)      return { scheduled: false, reason: "workflowId_required" };
    if (!sourceSubsystem) return { scheduled: false, reason: "sourceSubsystem_required" };
    if (_schedule.size >= MAX_SCHEDULE_ENTRIES)
        return { scheduled: false, reason: "schedule_capacity_exceeded" };

    const nowMs     = Date.now();
    const runAt     = scheduledAt
        ? new Date(scheduledAt).getTime()
        : nowMs + delayMs;

    const scheduleId = `sched-${++_counter}`;
    const entry = {
        scheduleId, workflowId, sourceSubsystem,
        scheduledAt:   new Date(runAt).toISOString(),
        runAtMs:       runAt,
        priorityScore,
        authorityLevel,
        retryCount,
        recovery,
        correlationId: correlationId ?? null,
        payload:       payload ? Object.freeze({ ...payload }) : null,
        state:         "scheduled",
        createdAt:     new Date().toISOString(),
    };

    _schedule.set(scheduleId, entry);
    return { scheduled: true, scheduleId, workflowId, scheduledAt: entry.scheduledAt };
}

// ── getDueWorkflows ────────────────────────────────────────────────────

function getDueWorkflows(nowMs = Date.now()) {
    const due = [..._schedule.values()]
        .filter(e => e.state === "scheduled" && e.runAtMs <= nowMs)
        .sort((a, b) => b.priorityScore - a.priorityScore || a.runAtMs - b.runAtMs);

    // Mark as fired
    for (const e of due) { e.state = "fired"; _fired++; }

    return due;
}

// ── cancelSchedule ─────────────────────────────────────────────────────

function cancelSchedule(scheduleId) {
    if (!scheduleId) return { cancelled: false, reason: "scheduleId_required" };
    const e = _schedule.get(scheduleId);
    if (!e) return { cancelled: false, reason: "schedule_not_found", scheduleId };
    if (e.state !== "scheduled")
        return { cancelled: false, reason: `schedule_not_cancellable: ${e.state}`, scheduleId };
    e.state = "cancelled";
    _cancelled++;
    return { cancelled: true, scheduleId, workflowId: e.workflowId };
}

// ── rescheduleRetry ────────────────────────────────────────────────────

function rescheduleRetry(spec = {}) {
    const {
        workflowId     = null,
        sourceSubsystem = null,
        retryCount     = 1,
        correlationId  = null,
        payload        = null,
        baseDelayMs    = BASE_RETRY_DELAY_MS,
    } = spec;

    if (!workflowId) return { rescheduled: false, reason: "workflowId_required" };
    const delayMs = _backoff(retryCount, baseDelayMs);
    const r = scheduleWorkflow({
        workflowId, sourceSubsystem: sourceSubsystem ?? "retry_scheduler",
        delayMs, retryCount, correlationId, payload,
    });
    return r.scheduled
        ? { rescheduled: true, scheduleId: r.scheduleId, scheduledAt: r.scheduledAt, delayMs, retryCount }
        : { rescheduled: false, reason: r.reason };
}

// ── rescheduleRecovery ─────────────────────────────────────────────────

function rescheduleRecovery(spec = {}) {
    const {
        workflowId      = null,
        sourceSubsystem = null,
        delayMs         = 2000,
        correlationId   = null,
        payload         = null,
    } = spec;

    if (!workflowId) return { rescheduled: false, reason: "workflowId_required" };
    const r = scheduleWorkflow({
        workflowId, sourceSubsystem: sourceSubsystem ?? "recovery_scheduler",
        delayMs, recovery: true, priorityScore: 75, correlationId, payload,
    });
    return r.scheduled
        ? { rescheduled: true, scheduleId: r.scheduleId, scheduledAt: r.scheduledAt }
        : { rescheduled: false, reason: r.reason };
}

// ── getSchedule ────────────────────────────────────────────────────────

function getSchedule(scheduleId) {
    if (!scheduleId) return null;
    return _schedule.get(scheduleId) ?? null;
}

// ── getSchedulingMetrics ───────────────────────────────────────────────

function getSchedulingMetrics() {
    const all         = [..._schedule.values()];
    const byState     = {};
    for (const e of all) byState[e.state] = (byState[e.state] ?? 0) + 1;
    const retryEntries   = all.filter(e => e.retryCount > 0).length;
    const recoveryEntries = all.filter(e => e.recovery).length;

    return {
        totalScheduled:   all.length,
        firedCount:       _fired,
        cancelledCount:   _cancelled,
        pendingCount:     byState.scheduled ?? 0,
        retryEntries,
        recoveryEntries,
        byState,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _schedule  = new Map();
    _counter   = 0;
    _fired     = 0;
    _cancelled = 0;
}

module.exports = {
    BASE_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS, MAX_SCHEDULE_ENTRIES,
    scheduleWorkflow, getDueWorkflows, cancelSchedule,
    rescheduleRetry, rescheduleRecovery, getSchedule,
    getSchedulingMetrics, reset,
};
