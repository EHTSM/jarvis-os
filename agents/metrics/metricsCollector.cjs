"use strict";
/**
 * Metrics Collector — aggregates real runtime data from all existing monitors.
 * Sources:
 *   systemMonitor   — execution counts, history (updated on every executorAgent call)
 *   performanceTracker — per-agent timing, call counts, failure rates
 *   logManager      — structured log ring buffer (last 500 entries)
 *   taskQueue       — disk-persisted autonomous queue state
 *   process         — real memory usage, uptime
 *
 * No fake data. No simulated values.
 */

const path = require("path");

// All sourced from existing in-process singletons — no new state
const ROOT = path.join(__dirname, "../../");

let systemMonitor, performanceTracker, logManager, taskQueue;

function _load() {
    if (!systemMonitor)     systemMonitor     = require(ROOT + "agents/automation/systemMonitor.cjs");
    if (!performanceTracker) performanceTracker = require(ROOT + "agents/multi/performanceTracker.cjs");
    if (!logManager)        logManager        = require(ROOT + "agents/automation/logManager.cjs");
    if (!taskQueue) {
        try { taskQueue = require(ROOT + "agents/taskQueue.cjs"); } catch { taskQueue = null; }
    }
}

function _memoryStats() {
    const m = process.memoryUsage();
    return {
        rss_mb:       +(m.rss       / 1048576).toFixed(1),
        heap_used_mb: +(m.heapUsed  / 1048576).toFixed(1),
        heap_total_mb:+(m.heapTotal / 1048576).toFixed(1),
        external_mb:  +(m.external  / 1048576).toFixed(1)
    };
}

function _queueStats() {
    if (!taskQueue) return { available: false };
    try {
        const all = taskQueue.getAll();
        return {
            total:     all.length,
            pending:   all.filter(t => t.status === "pending").length,
            running:   all.filter(t => t.status === "running").length,
            completed: all.filter(t => t.status === "completed").length,
            failed:    all.filter(t => t.status === "failed").length,
            cancelled: all.filter(t => t.status === "cancelled").length,
            recurring: all.filter(t => t.recurringCron).length
        };
    } catch { return { available: false }; }
}

function _taskTypeBreakdown(history) {
    const breakdown = {};
    for (const entry of history) {
        const k = entry.type || entry.taskType || "unknown";
        breakdown[k] = (breakdown[k] || 0) + 1;
    }
    return breakdown;
}

/**
 * snapshot() — full observability snapshot.
 * Every value is derived from live in-process state.
 */
function snapshot() {
    _load();

    const monitorHealth  = systemMonitor.health();
    const monitorHistory = systemMonitor.recentHistory(50);
    const perfSummary    = performanceTracker.summary().filter(s => s.calls > 0);
    const perfRecent     = performanceTracker.recent(20);
    const allLogs        = logManager.getHistory(100);
    const recentErrors   = allLogs
        .filter(l => l.level === "ERROR" || l.level === "WARN")
        .slice(-15)
        .map(l => ({ ts: l.ts, level: l.level, msg: l.msg, ...(l.type ? { type: l.type } : {}) }));

    return {
        timestamp:     new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        memory:        _memoryStats(),
        executions: {
            total:        monitorHealth.executions,
            failures:     monitorHealth.failures,
            success_rate: monitorHealth.success_rate,
            last_task:    monitorHealth.last_task,
            last_result:  monitorHealth.last_result,
            last_ts:      monitorHealth.last_ts,
            started_at:   monitorHealth.started_at
        },
        queue:              _queueStats(),
        task_type_breakdown: _taskTypeBreakdown(monitorHistory),
        agent_stats:        perfSummary,
        recent_executions:  perfRecent.map(r => ({
            ts:        r.ts,
            agent:     r.agent,
            task_type: r.taskType,
            elapsed_ms: r.elapsedMs,
            success:   r.success
        })),
        recent_errors: recentErrors,
        log_buffer_size: allLogs.length
    };
}

/**
 * health() — lightweight liveness check (used by GET /health).
 */
function health() {
    _load();
    const mon = systemMonitor.health();
    const q   = _queueStats();
    const mem = _memoryStats();

    const recentErrors = logManager.getHistory(50)
        .filter(l => l.level === "ERROR")
        .slice(-5)
        .map(l => ({ ts: l.ts, msg: l.msg }));

    return {
        status:         "ok",
        timestamp:      new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        memory:         mem,
        executions: {
            total:        mon.executions,
            failures:     mon.failures,
            success_rate: mon.success_rate,
            last_task:    mon.last_task,
            last_ts:      mon.last_ts
        },
        queue: q,
        recent_errors: recentErrors
    };
}

/**
 * queueStatus() — detailed queue state (used by GET /queue/status).
 */
function queueStatus() {
    _load();
    if (!taskQueue) return { available: false };
    const all = taskQueue.getAll();
    return {
        ...(_queueStats()),
        tasks: all.map(t => ({
            id:            t.id,
            input:         t.input,
            type:          t.type,
            status:        t.status,
            retries:       t.retries,
            max_retries:   t.maxRetries,
            recurring_cron: t.recurringCron,
            scheduled_for: t.scheduledFor,
            created_at:    t.createdAt,
            started_at:    t.startedAt,
            completed_at:  t.completedAt,
            last_error:    t.lastError,
            executions:    t.executionLog?.length || 0,
            last_output:   t.executionLog?.slice(-1)[0]?.output?.slice(0, 200) || null
        }))
    };
}

/**
 * agentStatus() — execution stats per agent (used by GET /agents/status).
 */
function agentStatus() {
    _load();
    return {
        agent_stats:       performanceTracker.summary().filter(s => s.calls > 0),
        recent_executions: performanceTracker.recent(30).map(r => ({
            ts:         r.ts,
            agent:      r.agent,
            task_type:  r.taskType,
            elapsed_ms: r.elapsedMs,
            success:    r.success
        }))
    };
}

module.exports = { snapshot, health, queueStatus, agentStatus };
