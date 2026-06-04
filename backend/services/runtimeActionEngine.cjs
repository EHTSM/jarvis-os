"use strict";
/**
 * RuntimeActionEngine — execute, queue, retry, cancel and audit actions.
 *
 * Wraps the existing runtimeOrchestrator + taskQueue + auditLog stack.
 * All mutations are audit-logged and persisted via taskQueue's disk-backed store.
 *
 * Public API:
 *   execute(input, opts)          → { actionId, success, output, durationMs }
 *   queue(input, opts)            → { actionId, status: "queued" }
 *   retry(actionId)               → { actionId, status: "queued" }
 *   cancel(actionId)              → { actionId, status: "cancelled" }
 *   getAction(actionId)           → task object | null
 *   listActions(opts)             → { actions[], total, stats }
 *   getAuditTrail(opts)           → { entries[] }
 */

const path        = require("path");
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const taskQueue    = require("../../agents/taskQueue.cjs");
const auditLog     = require("../utils/auditLog.cjs");
const execLog      = require("../utils/execLog.cjs");
const logger       = require("../utils/logger");

// ── In-memory action index (action executions, not queue tasks) ───────────
// Keyed by actionId. Persists via execLog for durability.
const _actions = new Map();  // actionId → ActionRecord
let _seq = 0;

function _id() { return `act_${Date.now()}_${(++_seq).toString(36)}`; }

/**
 * Execute an action synchronously via the runtime orchestrator.
 */
async function execute(input, opts = {}) {
    const actionId  = _id();
    const startedAt = new Date().toISOString();
    const start     = Date.now();

    const record = {
        actionId, input: input.slice(0, 500),
        type:     opts.type || "action",
        status:   "running",
        startedAt,
        completedAt: null,
        durationMs:  null,
        success:     null,
        output:      null,
        error:       null,
        retryOf:     opts.retryOf || null,
        source:      opts.source  || "api",
    };
    _actions.set(actionId, record);

    auditLog.append({
        type:     "dispatch",
        actionId, input: input.slice(0, 200),
        source:   opts.source || "api",
        ts:       startedAt,
    });

    try {
        const result = await orchestrator.dispatch(input, {
            timeoutMs: opts.timeoutMs || 30_000,
            retries:   0,   // engine-level retries are handled by retry()
        });
        const durationMs = Date.now() - start;

        record.status      = result.success ? "completed" : "failed";
        record.success     = result.success;
        record.output      = (result.reply || result.output || "").slice(0, 1000);
        record.error       = result.error  || null;
        record.durationMs  = durationMs;
        record.completedAt = new Date().toISOString();

        execLog.append({
            agentId:   "RuntimeActionEngine",
            taskType:  record.type,
            taskId:    actionId,
            success:   record.success,
            durationMs,
            input:     input.slice(0, 120),
            output:    record.output.slice(0, 120),
            error:     record.error,
        });

        auditLog.append({ type: record.success ? "complete" : "failed", actionId, durationMs });
        return { actionId, success: record.success, output: record.output, durationMs, error: record.error };

    } catch (err) {
        const durationMs = Date.now() - start;
        record.status      = "failed";
        record.success     = false;
        record.error       = err.message;
        record.durationMs  = durationMs;
        record.completedAt = new Date().toISOString();

        execLog.append({
            agentId: "RuntimeActionEngine", taskType: record.type,
            taskId: actionId, success: false, durationMs,
            input: input.slice(0, 120), error: err.message,
        });
        auditLog.append({ type: "failed", actionId, error: err.message, durationMs });
        logger.error(`[RuntimeActionEngine] execute failed: ${err.message}`);
        return { actionId, success: false, output: null, durationMs, error: err.message };
    }
}

/**
 * Queue an action for async background execution via taskQueue.
 */
function queue(input, opts = {}) {
    const task = taskQueue.add({
        input,
        type:         opts.type         || "action",
        scheduledFor: opts.scheduledFor || null,
        recurringCron:opts.recurringCron || null,
        maxRetries:   opts.maxRetries   ?? 3,
        metadata:     { source: opts.source || "api", ...( opts.metadata || {}) },
    });
    auditLog.append({ type: "dispatch", actionId: task.id, input: input.slice(0, 200), mode: "queued" });
    return { actionId: task.id, status: "queued", task };
}

/**
 * Retry a previously failed/cancelled action.
 * Looks up original input from taskQueue or in-memory store.
 */
function retry(actionId) {
    // Try taskQueue first (persisted)
    let originalInput = null;
    try {
        const all  = taskQueue.getAll();
        const task = all.find(t => t.id === actionId);
        if (task) originalInput = task.input;
    } catch { /* ignore */ }

    // Fall back to in-memory record
    if (!originalInput && _actions.has(actionId)) {
        originalInput = _actions.get(actionId).input;
    }

    if (!originalInput) {
        throw new Error(`Action ${actionId} not found — cannot retry`);
    }

    const newTask = taskQueue.add({
        input:      originalInput,
        type:       "action",
        maxRetries: 3,
        metadata:   { retryOf: actionId },
    });
    auditLog.append({ type: "retry", originalActionId: actionId, newActionId: newTask.id });
    return { actionId: newTask.id, status: "queued", retryOf: actionId };
}

/**
 * Cancel a queued action.
 */
function cancel(actionId) {
    // Cancel in taskQueue (persisted tasks)
    let cancelled = false;
    try {
        const updated = taskQueue.update(actionId, { status: "cancelled" });
        if (updated) cancelled = true;
    } catch { /* ignore */ }

    // Also mark in-memory if present
    if (_actions.has(actionId)) {
        const r = _actions.get(actionId);
        if (r.status === "running" || r.status === "queued") {
            r.status = "cancelled";
            r.completedAt = new Date().toISOString();
            cancelled = true;
        }
    }

    if (!cancelled) throw new Error(`Action ${actionId} not found or already complete`);
    auditLog.append({ type: "cancel", actionId });
    return { actionId, status: "cancelled" };
}

/** Retrieve a single action by ID. */
function getAction(actionId) {
    // Check in-memory first
    if (_actions.has(actionId)) return _actions.get(actionId);
    // Fall back to task queue
    try {
        const all = taskQueue.getAll();
        return all.find(t => t.id === actionId) || null;
    } catch { return null; }
}

/** List actions with optional filters. */
function listActions({ status, type, limit = 50, offset = 0 } = {}) {
    const mem   = Array.from(_actions.values());
    const queue = (() => { try { return taskQueue.getAll(); } catch { return []; } })();

    // Merge, deduplicate by id, in-memory wins
    const seen = new Set(mem.map(a => a.actionId));
    const merged = [
        ...mem,
        ...queue.filter(t => !seen.has(t.id)).map(t => ({
            actionId: t.id, input: t.input, type: t.type,
            status: t.status, startedAt: t.createdAt,
            completedAt: t.completedAt || null, error: t.lastError || null,
        })),
    ].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));

    let filtered = merged;
    if (status) filtered = filtered.filter(a => a.status === status);
    if (type)   filtered = filtered.filter(a => a.type   === type);

    const stats = {
        total:     filtered.length,
        running:   filtered.filter(a => a.status === "running").length,
        completed: filtered.filter(a => a.status === "completed").length,
        failed:    filtered.filter(a => a.status === "failed").length,
        queued:    filtered.filter(a => a.status === "pending" || a.status === "queued").length,
        cancelled: filtered.filter(a => a.status === "cancelled").length,
    };

    return { actions: filtered.slice(offset, offset + limit), total: filtered.length, stats };
}

/** Return recent audit trail entries from execLog. */
function getAuditTrail({ limit = 100 } = {}) {
    try {
        return { entries: execLog.tail(limit) };
    } catch { return { entries: [] }; }
}

module.exports = { execute, queue, retry, cancel, getAction, listActions, getAuditTrail };
