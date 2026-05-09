"use strict";
/**
 * Persistent task queue — disk-backed, survives restarts.
 * States: pending → running → completed | failed
 */

const fs   = require("fs");
const path = require("path");

const QUEUE_FILE = path.join(__dirname, "../data/task-queue.json");
let _counter = Date.now();

function _load() {
    try {
        return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
    } catch { return []; }
}

function _save(tasks) {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(tasks, null, 2));
}

/**
 * Add a new task to the queue.
 * @param {object} opts
 * @param {string}  opts.input          - natural-language command to execute
 * @param {string}  [opts.type]         - hint label (terminal/dev/research/browser)
 * @param {string}  [opts.scheduledFor] - ISO timestamp (defaults to now)
 * @param {string}  [opts.recurringCron]- cron pattern for recurring tasks
 * @param {number}  [opts.maxRetries]   - default 3
 * @param {number}  [opts.retryDelay]   - ms between retries, default 15000
 */
function addTask({ input, type = "auto", scheduledFor, recurringCron, maxRetries = 3, retryDelay = 15000 }) {
    const tasks = _load();
    const task = {
        id:            `tq_${++_counter}`,
        input,
        type,
        status:        "pending",
        retries:       0,
        maxRetries,
        retryDelay,
        scheduledFor:  scheduledFor || new Date().toISOString(),
        recurringCron: recurringCron || null,
        createdAt:     new Date().toISOString(),
        startedAt:     null,
        completedAt:   null,
        lastError:     null,
        executionLog:  []
    };
    tasks.push(task);
    _save(tasks);
    console.log(`[TaskQueue] added ${task.id} type="${task.type}" scheduledFor=${task.scheduledFor}`);
    return task;
}

/** Return all tasks whose scheduledFor is now or in the past and status=pending. */
function getDuePending() {
    const now = Date.now();
    return _load().filter(t =>
        t.status === "pending" &&
        new Date(t.scheduledFor).getTime() <= now
    );
}

/** Update fields on a task by id. Persists immediately. */
function update(id, fields) {
    const tasks = _load();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(tasks[idx], fields);
    _save(tasks);
    return tasks[idx];
}

/** Return all tasks (full history). */
function getAll() { return _load(); }

/** On startup: reset "running" tasks back to "pending" (crash recovery). */
function recoverStale() {
    const tasks = _load();
    let changed = 0;
    for (const t of tasks) {
        if (t.status === "running") {
            t.status = "pending";
            t.executionLog.push({ ts: new Date().toISOString(), event: "recovered — was running on crash" });
            changed++;
        }
    }
    if (changed > 0) {
        _save(tasks);
        console.log(`[TaskQueue] recovered ${changed} stale running task(s) → pending`);
    }
}

/**
 * Prune old terminal tasks to keep disk file bounded.
 * Keeps all pending/running tasks, all recurring tasks, and the most recent
 * `keepCompleted` completed/failed/cancelled tasks.
 */
function pruneOldTasks(keepCompleted = 50) {
    const tasks = _load();
    const active    = tasks.filter(t => t.status === "pending" || t.status === "running");
    const recurring = tasks.filter(t => t.recurringCron && t.status !== "cancelled");
    const terminal  = tasks
        .filter(t => !t.recurringCron && t.status !== "pending" && t.status !== "running")
        .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt))
        .slice(0, keepCompleted);

    const kept = [...new Map([...active, ...recurring, ...terminal].map(t => [t.id, t])).values()];
    const pruned = tasks.length - kept.length;
    if (pruned > 0) {
        _save(kept);
        console.log(`[TaskQueue] pruned ${pruned} old completed/failed task(s) — ${kept.length} remain`);
    }
    return pruned;
}

/**
 * Abandon tasks that have been "pending" longer than maxAgeHours.
 * Guards against queue rot when the executor silently can't handle a task type.
 * Returns count of tasks abandoned.
 */
function abandonStuckTasks(maxAgeHours = 2) {
    const tasks   = _load();
    const cutoff  = Date.now() - maxAgeHours * 3_600_000;
    let   changed = 0;
    for (const t of tasks) {
        if (t.status !== "pending") continue;
        if (new Date(t.scheduledFor || t.createdAt).getTime() > cutoff) continue;
        // Never abandon recurring tasks — they reschedule far into the future by design
        if (t.recurringCron) continue;
        t.status    = "failed";
        t.lastError = `Abandoned — stuck in pending for >${maxAgeHours}h`;
        t.completedAt = new Date().toISOString();
        t.executionLog = [...(t.executionLog || []), {
            ts: new Date().toISOString(),
            event: "abandoned",
            reason: `Pending >${maxAgeHours}h without execution`
        }];
        changed++;
    }
    if (changed > 0) {
        _save(tasks);
        console.log(`[TaskQueue] abandoned ${changed} stuck task(s) older than ${maxAgeHours}h`);
    }
    return changed;
}

/**
 * Hard-delete a task by id (for permanent removal, not just cancel).
 */
function deleteTask(id) {
    const tasks = _load();
    const before = tasks.length;
    const kept   = tasks.filter(t => t.id !== id);
    if (kept.length < before) { _save(kept); return true; }
    return false;
}

/**
 * Return a queue health snapshot: counts by status, oldest-pending age, failure rate.
 */
function getHealthReport() {
    const tasks = _load();
    const now   = Date.now();
    const counts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    let   oldestPendingMs = 0;
    let   failedLast24h  = 0;

    // Wait-time and exec-time accumulators per type
    // waitMs = startedAt - scheduledFor (time in queue before execution)
    // execMs = completedAt - startedAt  (actual execution duration)
    const _typeWait = {};   // type → { count, totalMs }
    const _typeExec = {};   // type → { count, totalMs }

    for (const t of tasks) {
        counts[t.status] = (counts[t.status] || 0) + 1;
        if (t.status === "pending") {
            const age = now - new Date(t.scheduledFor || t.createdAt).getTime();
            if (age > oldestPendingMs) oldestPendingMs = age;
        }
        if (t.status === "failed" && t.completedAt) {
            if ((now - new Date(t.completedAt).getTime()) < 86_400_000) failedLast24h++;
        }

        const type = t.type || "auto";
        if (t.startedAt && (t.scheduledFor || t.createdAt)) {
            const waitMs = new Date(t.startedAt).getTime() - new Date(t.scheduledFor || t.createdAt).getTime();
            if (waitMs >= 0) {
                if (!_typeWait[type]) _typeWait[type] = { count: 0, totalMs: 0 };
                _typeWait[type].count++;
                _typeWait[type].totalMs += waitMs;
            }
        }
        if (t.startedAt && t.completedAt) {
            const execMs = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
            if (execMs >= 0) {
                if (!_typeExec[type]) _typeExec[type] = { count: 0, totalMs: 0 };
                _typeExec[type].count++;
                _typeExec[type].totalMs += execMs;
            }
        }
    }

    const timing = Object.keys({ ..._typeWait, ..._typeExec }).map(type => ({
        type,
        avg_wait_ms: _typeWait[type]
            ? Math.round(_typeWait[type].totalMs / _typeWait[type].count) : null,
        avg_exec_ms: _typeExec[type]
            ? Math.round(_typeExec[type].totalMs / _typeExec[type].count) : null
    }));

    const total = tasks.length || 1;
    return {
        counts,
        total:             tasks.length,
        oldestPendingMins: Math.round(oldestPendingMs / 60_000),
        failedLast24h,
        failureRate:       Math.round(((counts.failed || 0) / total) * 100),
        healthy:           (counts.pending || 0) <= 20 && oldestPendingMs < 3_600_000,
        timing
    };
}

module.exports = {
    addTask, getDuePending, update, getAll,
    recoverStale, pruneOldTasks,
    abandonStuckTasks, deleteTask, getHealthReport
};
