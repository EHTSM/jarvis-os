/**
 * Scheduler — delayed execution and cron-ready task management.
 * Uses native setTimeout; swap to node-cron for recurring tasks in production.
 */

const logManager = require("./logManager.cjs");

const _pending = new Map(); // id → { timer, task, scheduledAt }

function _genId() {
    return `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function scheduleDelay(task, delayMs, callback) {
    if (typeof delayMs !== "number" || delayMs < 0) {
        throw new Error("scheduleDelay: delayMs must be a non-negative number");
    }
    if (typeof callback !== "function") {
        throw new Error("scheduleDelay: callback must be a function");
    }

    const id          = _genId();
    const scheduledAt = new Date().toISOString();
    const runsAt      = new Date(Date.now() + delayMs).toISOString();

    logManager.info("Task scheduled", { id, type: task?.type, delayMs, runsAt });

    const timer = setTimeout(async () => {
        _pending.delete(id);
        logManager.info("Delayed task firing", { id, type: task?.type });
        try {
            await callback(task);
        } catch (err) {
            logManager.error("Delayed task error", { id, error: err.message });
        }
    }, delayMs);

    _pending.set(id, { timer, task, scheduledAt, runsAt });

    return { success: true, id, scheduled_at: scheduledAt, runs_at: runsAt, delay_ms: delayMs };
}

function cancel(id) {
    if (!_pending.has(id)) return { success: false, error: "Task ID not found" };
    clearTimeout(_pending.get(id).timer);
    _pending.delete(id);
    logManager.info("Task cancelled", { id });
    return { success: true, id };
}

function listPending() {
    return Array.from(_pending.entries()).map(([id, { task, scheduledAt, runsAt }]) => ({
        id,
        type:         task?.type || "unknown",
        scheduled_at: scheduledAt,
        runs_at:      runsAt
    }));
}

function toCronExpression(hour, minute = 0, options = {}) {
    const { dayOfWeek = "*", dayOfMonth = "*", month = "*" } = options;
    return `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
}

function parseCronFromTask(task) {
    if (task.cron_time) return { expression: task.cron_time, recurring: true };
    if (task.type === "daily_task") {
        const [h, m] = (task.time || "09:00").split(":").map(Number);
        return { expression: toCronExpression(h, m), recurring: true };
    }
    return null;
}

module.exports = { scheduleDelay, cancel, listPending, toCronExpression, parseCronFromTask };
