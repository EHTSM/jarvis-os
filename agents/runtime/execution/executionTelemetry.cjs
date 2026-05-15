"use strict";
/**
 * executionTelemetry — execution event bus + audit log + execution metrics.
 *
 * ── Event bus (backward-compatible) ─────────────────────────────────────────
 * EVENTS                                        → string[]
 * on(event, handler)                            → void
 * off(event, handler)                           → void
 * emit(event, data)                             → void
 * getLog()                                      → EventEntry[]
 * clearLog()                                    → void
 *
 * ── Audit / metrics (new) ────────────────────────────────────────────────────
 * recordExecution(record)                       → { recorded, executionId }
 * updateExecution(executionId, updates)         → { updated }
 * recordVerification(record)                    → { recorded, verificationId }
 * recordRollback(record)                        → { recorded, rollbackRecordId }
 * getExecutionMetrics(filter)                   → Metrics
 * getAuditTrail(filter)                         → AuditEntry[]
 *
 * reset()                                       → clears both layers
 */

const MAX_ENTRIES = 2000;

// ── Event bus ─────────────────────────────────────────────────────────

const EVENTS = [
    // Original events (test 40 compatibility)
    "step_started",
    "step_completed",
    "step_failed",
    "rollback_started",
    "rollback_completed",
    "execution_cancelled",
    // New lifecycle events
    "execution_admitted",
    "execution_rejected",
    "execution_verified",
    "verification_failed",
    "rollback_triggered",
    "capability_degraded",
    "capability_restored",
    "mode_changed",
];

const _handlers = new Map();
const _log      = [];

function on(event, handler) {
    if (!_handlers.has(event)) _handlers.set(event, new Set());
    _handlers.get(event).add(handler);
}

function off(event, handler) {
    _handlers.get(event)?.delete(handler);
}

function emit(event, data = {}) {
    const entry = { event, data, ts: new Date().toISOString() };
    _log.push(entry);
    for (const fn of (_handlers.get(event) ?? [])) {
        try { fn(data); } catch (_) { /* swallow — handler errors must not crash executor */ }
    }
}

function getLog()   { return [..._log]; }
function clearLog() { _log.length = 0; }

// ── Audit store ───────────────────────────────────────────────────────

let _executions    = new Map();   // executionId → ExecutionRecord
let _verifications = [];          // VerificationAuditEntry[]
let _rollbacks     = [];          // RollbackAuditEntry[]
let _counter       = 0;

// ── recordExecution ───────────────────────────────────────────────────

function recordExecution(record = {}) {
    const id = record.executionId ?? `exec-tel-${++_counter}`;
    const entry = {
        executionId:        id,
        capabilityUsed:     record.capabilityUsed     ?? null,
        ticketId:           record.ticketId           ?? null,
        class:              record.class              ?? null,
        operation:          record.operation          ?? null,
        riskLevel:          record.riskLevel          ?? null,
        startedAt:          record.startedAt          ?? new Date().toISOString(),
        completedAt:        record.completedAt        ?? null,
        latencyMs:          record.latencyMs          ?? null,
        retries:            record.retries            ?? 0,
        status:             record.status             ?? "running",
        verificationStatus: record.verificationStatus ?? null,
        rollbackStatus:     record.rollbackStatus     ?? null,
        resourcePressure:   record.resourcePressure   ?? 0,
        errorMessage:       record.errorMessage       ?? null,
        recordedAt:         new Date().toISOString(),
    };
    // Compute latency if both timestamps present
    if (entry.completedAt && entry.startedAt && entry.latencyMs == null)
        entry.latencyMs = _diffMs(entry.startedAt, entry.completedAt);

    _executions.set(id, entry);
    if (_executions.size > MAX_ENTRIES) _executions.delete(_executions.keys().next().value);
    return { recorded: true, executionId: id };
}

// ── updateExecution ───────────────────────────────────────────────────

function updateExecution(executionId, updates = {}) {
    const entry = _executions.get(executionId);
    if (!entry) return { updated: false, reason: "not_found" };
    Object.assign(entry, updates);
    if (updates.completedAt && entry.startedAt && updates.latencyMs == null)
        entry.latencyMs = _diffMs(entry.startedAt, updates.completedAt);
    return { updated: true, executionId };
}

// ── recordVerification ────────────────────────────────────────────────

function recordVerification(record = {}) {
    const entry = {
        verificationId: `vtel-${++_counter}`,
        executionId:    record.executionId ?? null,
        type:           record.type        ?? null,
        outcome:        record.outcome     ?? null,
        passRate:       record.passRate    ?? null,
        durationMs:     record.durationMs  ?? null,
        ts:             new Date().toISOString(),
    };
    _verifications.push(entry);
    if (_verifications.length > MAX_ENTRIES) _verifications.shift();
    return { recorded: true, verificationId: entry.verificationId };
}

// ── recordRollback ────────────────────────────────────────────────────

function recordRollback(record = {}) {
    const entry = {
        rollbackRecordId: `rtel-${++_counter}`,
        executionId:      record.executionId ?? null,
        rollbackId:       record.rollbackId  ?? null,
        target:           record.target      ?? null,
        success:          record.success     ?? null,
        durationMs:       record.durationMs  ?? null,
        ts:               new Date().toISOString(),
    };
    _rollbacks.push(entry);
    if (_rollbacks.length > MAX_ENTRIES) _rollbacks.shift();
    return { recorded: true, rollbackRecordId: entry.rollbackRecordId };
}

// ── getExecutionMetrics ───────────────────────────────────────────────

function getExecutionMetrics(filter = {}) {
    let execs = [..._executions.values()];
    if (filter.status)    execs = execs.filter(e => e.status    === filter.status);
    if (filter.class)     execs = execs.filter(e => e.class     === filter.class);
    if (filter.riskLevel) execs = execs.filter(e => e.riskLevel === filter.riskLevel);

    const completed   = execs.filter(e => e.status === "completed");
    const failed      = execs.filter(e => e.status === "failed");
    const latencies   = completed.map(e => e.latencyMs).filter(l => l != null);
    const avgLatency  = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    const avgRetries  = execs.length > 0 ? execs.reduce((a, e) => a + (e.retries ?? 0), 0) / execs.length : 0;
    const avgPressure = execs.length > 0 ? execs.reduce((a, e) => a + (e.resourcePressure ?? 0), 0) / execs.length : 0;

    return {
        total:         execs.length,
        completed:     completed.length,
        failed:        failed.length,
        running:       execs.filter(e => e.status === "running").length,
        successRate:   execs.length > 0 ? +(completed.length / execs.length).toFixed(3) : 0,
        avgLatencyMs:  avgLatency != null ? +avgLatency.toFixed(2) : null,
        avgRetries:    +avgRetries.toFixed(3),
        avgPressure:   +avgPressure.toFixed(3),
        verifications: _verifications.length,
        rollbacks:     _rollbacks.length,
    };
}

// ── getAuditTrail ─────────────────────────────────────────────────────

function getAuditTrail(filter = {}) {
    const limit  = filter.limit ?? 200;
    const execId = filter.executionId;

    let records = [
        ...[..._executions.values()].map(e => ({ ...e, _type: "execution" })),
        ..._verifications.map(v => ({ ...v, _type: "verification" })),
        ..._rollbacks.map(r => ({ ...r, _type: "rollback" })),
    ];

    if (execId) records = records.filter(r => r.executionId === execId);

    records.sort((a, b) => {
        const at = a.recordedAt ?? a.ts ?? "";
        const bt = b.recordedAt ?? b.ts ?? "";
        return at < bt ? -1 : at > bt ? 1 : 0;
    });

    return records.slice(-limit);
}

// ── helpers ───────────────────────────────────────────────────────────

function _diffMs(startedAt, completedAt) {
    try { return Math.max(0, new Date(completedAt) - new Date(startedAt)); }
    catch (_) { return null; }
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    // Event bus
    _handlers.clear();
    _log.length = 0;
    // Audit
    _executions    = new Map();
    _verifications = [];
    _rollbacks     = [];
    _counter       = 0;
}

module.exports = {
    // Event bus (backward compat)
    EVENTS, on, off, emit, getLog, clearLog,
    // Audit / metrics
    recordExecution, updateExecution, recordVerification, recordRollback,
    getExecutionMetrics, getAuditTrail,
    // Shared
    reset,
};
