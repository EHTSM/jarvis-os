"use strict";
/**
 * Autonomous task loop — polls the task queue every 10 s and executes due tasks.
 * Uses node-cron for recurring tasks.
 * Retry logic: failed tasks are re-queued with exponential-ish delay until maxRetries.
 */

const cron       = require("node-cron");
const taskQueue  = require("./taskQueue.cjs");

let _running        = false;
let _intervalHandle = null;
const _cronJobs     = {};       // task.id → cron.ScheduledTask
const POLL_MS         = 10_000;   // check queue every 10 seconds
const TASK_TIMEOUT_MS = 30_000;   // single task must complete within 30s
const STUCK_AGE_HOURS = 2;        // abandon pending tasks older than this

// ── Self-healing counters ────────────────────────────────────────────
let _consecutiveTickErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// ── Repeated-failure tracker (in-memory, session-scoped) ─────────────
// Maps input-prefix → { count, lastError, lastTs }
const _failureTracker = new Map();
const FAILURE_TRACK_PREFIX_LEN = 40;

function _recordFailure(input, error) {
    const key = input.slice(0, FAILURE_TRACK_PREFIX_LEN);
    const existing = _failureTracker.get(key) || { count: 0, lastError: "", lastTs: null };
    existing.count++;
    existing.lastError = error;
    existing.lastTs    = new Date().toISOString();
    _failureTracker.set(key, existing);
    // Emit a loud warning if a specific input keeps failing
    if (existing.count === 3) {
        console.warn(`[AutoLoop] REPEATED FAILURE (3x): "${key}..." — ${error}`);
    }
}

function getFailureReport() {
    const entries = [];
    for (const [key, val] of _failureTracker) {
        entries.push({ input: key, ...val });
    }
    return entries.sort((a, b) => b.count - a.count).slice(0, 20);
}

// ── Slow-task + execution timing tracker ────────────────────────────
const SLOW_TASK_MS    = 15_000;   // warn if a task takes longer than this
const _slowTasks      = [];       // ring buffer of last 20 slow tasks
const _execTimings    = [];       // ring buffer of last 100 exec times
const MAX_SLOW        = 20;
const MAX_EXEC_TIMING = 100;

// Per task-type cumulative stats: type → { count, totalMs, failures }
const _typeStats = new Map();

function _recordExecTiming(task, elapsedMs, success) {
    const entry = {
        ts:        new Date().toISOString(),
        id:        task.id,
        input:     task.input.slice(0, 60),
        type:      task.type || "auto",
        elapsedMs,
        success
    };

    _execTimings.push(entry);
    if (_execTimings.length > MAX_EXEC_TIMING) _execTimings.shift();

    // Per-type cumulative stats
    const t = _typeStats.get(entry.type) || { count: 0, totalMs: 0, failures: 0 };
    t.count++;
    t.totalMs += elapsedMs;
    if (!success) t.failures++;
    _typeStats.set(entry.type, t);

    // Slow-task detection
    if (elapsedMs >= SLOW_TASK_MS) {
        console.warn(`[AutoLoop] SLOW TASK ${task.id} (${elapsedMs}ms): "${task.input.slice(0, 50)}"`);
        _slowTasks.push(entry);
        if (_slowTasks.length > MAX_SLOW) _slowTasks.shift();
    }
}

function getTimingReport() {
    const typeBreakdown = [];
    for (const [type, stats] of _typeStats) {
        typeBreakdown.push({
            type,
            count:       stats.count,
            failures:    stats.failures,
            avg_ms:      stats.count ? Math.round(stats.totalMs / stats.count) : 0,
            success_rate: stats.count
                ? +(((stats.count - stats.failures) / stats.count) * 100).toFixed(1)
                : 100
        });
    }
    return {
        slow_tasks:     _slowTasks.slice(-10).reverse(),
        slow_threshold: SLOW_TASK_MS,
        recent_execs:   _execTimings.slice(-20).reverse(),
        type_breakdown: typeBreakdown.sort((a, b) => b.count - a.count)
    };
}

function _withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Task timed out after ${ms}ms: ${label}`)), ms)
        )
    ]);
}

// Lazy-load to avoid circular deps at module load time
function _getPlanner()  { return require("./planner.cjs").plannerAgent; }
function _getExecutor() { return require("./executor.cjs").executorAgent; }

// ── Execute one queued task ──────────────────────────────────────────
async function _runTask(task) {
    const logEntry = (event, extra = {}) => ({
        ts: new Date().toISOString(), event, ...extra
    });
    const _taskStart = Date.now();

    console.log(`[AutoLoop] START task ${task.id} input="${task.input.slice(0, 60)}"`);
    taskQueue.update(task.id, {
        status:    "running",
        startedAt: new Date().toISOString()
    });

    try {
        const plannerAgent  = _getPlanner();
        const executorAgent = _getExecutor();

        const parsedTasks = plannerAgent(task.input);
        const results     = [];

        for (const pt of parsedTasks) {
            const result = await _withTimeout(
                executorAgent(pt),
                TASK_TIMEOUT_MS,
                `${pt.type}:${task.input.slice(0, 40)}`
            );
            results.push({ type: pt.type, result });
        }

        const summary = results.map(r => {
            const text = (typeof r.result?.result === "string" ? r.result.result :
                          typeof r.result?.reply   === "string" ? r.result.reply  :
                          typeof r.result?.message === "string" ? r.result.message :
                          JSON.stringify(r.result)).slice(0, 300);
            return `[${r.type}] ${text}`;
        }).join("\n");

        const fresh = taskQueue.getAll().find(t => t.id === task.id) || task;
        taskQueue.update(task.id, {
            status:      task.recurringCron ? "pending" : "completed",
            completedAt: new Date().toISOString(),
            // For recurring: reschedule 1 year forward (cron handles actual timing)
            scheduledFor: task.recurringCron
                ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
                : fresh.scheduledFor,
            executionLog: [
                ...(fresh.executionLog || []),
                logEntry("completed", { output: summary.slice(0, 500) })
            ]
        });

        const elapsed = Date.now() - _taskStart;
        _recordExecTiming(task, elapsed, true);
        console.log(`[AutoLoop] DONE  task ${task.id} (${elapsed}ms)`);
        return { success: true, summary };
    } catch (err) {
        const elapsed = Date.now() - _taskStart;
        _recordExecTiming(task, elapsed, false);
        console.error(`[AutoLoop] ERROR task ${task.id} (${elapsed}ms): ${err.message}`);
        _recordFailure(task.input, err.message);

        const fresh   = taskQueue.getAll().find(t => t.id === task.id) || task;
        const retries = (fresh.retries || 0) + 1;
        const delay   = (task.retryDelay || 15000) * retries;   // linear back-off

        if (retries >= (task.maxRetries || 3)) {
            taskQueue.update(task.id, {
                status:      "failed",
                retries,
                lastError:   err.message,
                executionLog: [
                    ...(fresh.executionLog || []),
                    logEntry("failed_final", { error: err.message, retries })
                ]
            });
            console.log(`[AutoLoop] FAIL  task ${task.id} — exhausted ${retries} retries`);
        } else {
            const nextRun = new Date(Date.now() + delay).toISOString();
            taskQueue.update(task.id, {
                status:       "pending",
                retries,
                scheduledFor: nextRun,
                lastError:    err.message,
                executionLog: [
                    ...(fresh.executionLog || []),
                    logEntry("retry_scheduled", { attempt: retries, nextRun, error: err.message })
                ]
            });
            console.log(`[AutoLoop] RETRY task ${task.id} attempt ${retries}/${task.maxRetries} @ ${nextRun}`);
        }
        return { success: false, error: err.message };
    }
}

// ── Poll tick ────────────────────────────────────────────────────────
async function _tick() {
    // Sweep for tasks stuck in pending before executing new work
    taskQueue.abandonStuckTasks(STUCK_AGE_HOURS);

    const due = taskQueue.getDuePending();
    if (due.length === 0) return;
    console.log(`[AutoLoop] tick — ${due.length} task(s) due`);
    for (const task of due) {
        await _runTask(task);
    }
}

// ── Register a cron task (skip if already registered) ───────────────
function _registerCron(task) {
    if (!task.recurringCron || _cronJobs[task.id]) return;
    if (!cron.validate(task.recurringCron)) {
        console.warn(`[AutoLoop] invalid cron pattern for ${task.id}: "${task.recurringCron}"`);
        return;
    }
    console.log(`[AutoLoop] cron register ${task.id} pattern="${task.recurringCron}" input="${task.input}"`);
    const job = cron.schedule(task.recurringCron, async () => {
        const all   = taskQueue.getAll();
        const fresh = all.find(t => t.id === task.id);
        if (!fresh || fresh.status === "cancelled" || fresh.status === "failed") {
            job.stop();
            delete _cronJobs[task.id];
            return;
        }
        // Temporarily mark pending so _runTask sees a fresh copy
        taskQueue.update(task.id, { status: "pending", scheduledFor: new Date().toISOString() });
        await _runTask({ ...fresh, status: "pending" });
    });
    _cronJobs[task.id] = job;
}

// ── Public API ───────────────────────────────────────────────────────
function start() {
    if (_running) return;
    _running = true;

    taskQueue.recoverStale();

    // Re-register any existing cron tasks that survived restart
    for (const t of taskQueue.getAll()) {
        if (t.recurringCron && t.status !== "cancelled" && t.status !== "failed") {
            _registerCron(t);
        }
    }

    _startInterval();
    console.log(`[AutoLoop] started — poll interval ${POLL_MS}ms, stuck-abandon after ${STUCK_AGE_HOURS}h`);

    // Check immediately on start (picks up any overdue tasks from before restart)
    _tick().catch(err => console.error("[AutoLoop] startup tick error:", err.message));
}

function _startInterval() {
    if (_intervalHandle) { clearInterval(_intervalHandle); _intervalHandle = null; }
    _intervalHandle = setInterval(() => {
        _tick().then(() => {
            _consecutiveTickErrors = 0;   // reset on success
        }).catch(err => {
            _consecutiveTickErrors++;
            console.error(`[AutoLoop] tick error #${_consecutiveTickErrors}: ${err.message}`);
            if (_consecutiveTickErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error(`[AutoLoop] ${MAX_CONSECUTIVE_ERRORS} consecutive failures — restarting interval`);
                _consecutiveTickErrors = 0;
                _startInterval();   // self-heal: clear and restart the interval
            }
        });
    }, POLL_MS);
}

function stop() {
    if (_intervalHandle) { clearInterval(_intervalHandle); _intervalHandle = null; }
    Object.values(_cronJobs).forEach(j => j.stop());
    _running = false;
    console.log("[AutoLoop] stopped");
}

/**
 * Add a task and optionally register it for cron execution.
 * This is the main entry point from the executor's queue_task handler.
 */
function addTask(opts) {
    const task = taskQueue.addTask(opts);
    if (opts.recurringCron) _registerCron(task);
    return task;
}

module.exports = { start, stop, addTask, getQueue: () => taskQueue.getAll(), getFailureReport, getTimingReport };
