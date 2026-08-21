"use strict";
/**
 * Autonomous task loop — polls the task queue every 10 s and executes due tasks.
 * Uses node-cron for recurring tasks.
 * Retry logic: failed tasks are re-queued with exponential-ish delay until maxRetries.
 */

const cron = require("node-cron");
const taskQueue = require("./taskQueue.cjs");
const prereqGate = require("./runtime/prerequisiteGate.cjs");
const aiService = require("../backend/services/aiService.js");
const { execFile } = require("child_process");

let _running = false;
let _intervalHandle = null;
const _cronJobs = {};       // task.id → cron.ScheduledTask
// Queue/Worker/Background Execution Audit (2026-08-22): cron.schedule()'s
// callback fires on its own timer regardless of whether the PREVIOUS fire's
// _runTask for the same task.id is still awaiting — unlike _tick()'s own
// _dispatching guard below, nothing here stopped a slow recurring task from
// overlapping itself. _runTask can run multiple planner sub-tasks
// sequentially, each individually timeout-capped at TASK_TIMEOUT_MS, so a
// 2-3-subtask job can genuinely exceed a tight (e.g. once-a-minute) cron
// interval — a client-supplied recurringCron via POST /tasks has no minimum-
// interval floor. Live-reproduced with the real node-cron dependency (1s
// interval, 1.8s simulated task): maxConcurrent 2, both invocations writing
// taskQueue.update(task.id, ...) concurrently. Same duplicate-execution bug
// class already fixed for browserScheduler._inFlight and
// contentScheduler._processingIds — reusing that exact in-flight-Set pattern
// here rather than inventing a new one.
const _cronInFlight = new Set();  // task.id currently executing via its own cron fire
const POLL_MS = 10_000;   // check queue every 10 seconds
const TASK_TIMEOUT_MS = 30_000;   // single task must complete within 30s
const STUCK_AGE_HOURS = 2;        // abandon pending tasks older than this
// A.5.2 runtime-stability finding: getDuePending() is unbounded — a real
// backlog of 359 simultaneously-overdue tasks (traced to an unrelated
// unclosed-verification-loop bug, since fixed at its source) made a single
// _tick() run every one of them sequentially before yielding, at up to
// TASK_TIMEOUT_MS each — sustained 100%+ CPU and an unresponsive server for
// minutes per tick. This cap is defense-in-depth: even with today's
// specific fan-out source closed, no future backlog (any cause) should be
// able to block a tick for more than a bounded number of tasks. The
// remainder stays "pending" and is naturally picked up by the very next
// tick 10s later — reusing the loop's own existing polling cadence as the
// drain mechanism rather than adding a second scheduler.
const MAX_TASKS_PER_TICK = 20;

// ── Self-healing counters ────────────────────────────────────────────
let _consecutiveTickErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// Depth guard — prevents tick from re-entering while a dispatch is in flight
let _dispatching = false;

// ── Repeated-failure tracker (in-memory, session-scoped) ─────────────
// Maps input-prefix → { count, lastError, lastTs }
const _failureTracker = new Map();
const FAILURE_TRACK_PREFIX_LEN = 40;

function _recordFailure(input, error) {
    const key = input.slice(0, FAILURE_TRACK_PREFIX_LEN);
    const existing = _failureTracker.get(key) || { count: 0, lastError: "", lastTs: null };
    existing.count++;
    existing.lastError = error;
    existing.lastTs = new Date().toISOString();
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
const SLOW_TASK_MS = 15_000;   // warn if a task takes longer than this
const _slowTasks = [];       // ring buffer of last 20 slow tasks
const _execTimings = [];       // ring buffer of last 100 exec times
const MAX_SLOW = 20;
const MAX_EXEC_TIMING = 100;

// Per task-type cumulative stats: type → { count, totalMs, failures }
const _typeStats = new Map();

function _recordExecTiming(task, elapsedMs, success) {
    const entry = {
        ts: new Date().toISOString(),
        id: task.id,
        input: task.input.slice(0, 60),
        type: task.type || "auto",
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
            count: stats.count,
            failures: stats.failures,
            avg_ms: stats.count ? Math.round(stats.totalMs / stats.count) : 0,
            success_rate: stats.count
                ? +(((stats.count - stats.failures) / stats.count) * 100).toFixed(1)
                : 100
        });
    }
    return {
        slow_tasks: _slowTasks.slice(-10).reverse(),
        slow_threshold: SLOW_TASK_MS,
        recent_execs: _execTimings.slice(-20).reverse(),
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

async function _gitHealthProbe() {
    return await new Promise(resolve => {
        execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: require("path").resolve(__dirname, ".."), timeout: 3_000 }, (err) => resolve(!err));
    });
}

async function _checkRuntimeReadiness() {
    return prereqGate.checkPrerequisites({
        aiService,
        gitRunner: _gitHealthProbe,
    });
}

// Lazy-load to avoid circular deps at module load time
function _getPlanner() { return require("./planner.cjs").plannerAgent; }
function _getExecutor() { return require("./executor.cjs").executorAgent; }

// ── Execute one queued task ──────────────────────────────────────────
async function _runTask(task) {
    const logEntry = (event, extra = {}) => ({
        ts: new Date().toISOString(), event, ...extra
    });
    const _taskStart = Date.now();

    console.log(`[AutoLoop] START task ${task.id} input="${task.input.slice(0, 60)}"`);
    taskQueue.update(task.id, {
        status: "running",
        startedAt: new Date().toISOString()
    });

    try {
        const plannerAgent = _getPlanner();
        const executorAgent = _getExecutor();

        const parsedTasks = plannerAgent(task.input);
        const results = [];

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
                typeof r.result?.reply === "string" ? r.result.reply :
                    typeof r.result?.message === "string" ? r.result.message :
                        JSON.stringify(r.result)).slice(0, 300);
            return `[${r.type}] ${text}`;
        }).join("\n");

        // Executors report failure by RETURNING { success:false, error } rather than
        // throwing (see agents/executor.cjs and runtime/bootstrapRuntime.cjs:224, which
        // sets success:false for "AI backend unavailable"). Because nothing threw, the
        // catch block below never ran and every task was stamped "completed" — so a
        // mission whose stages all failed (no AI provider, command blocked by the
        // allowlist) still reported orchStatus "completed" with the error text sitting
        // in its output. That is a fake success: missionOrchestrator's _pollLoopTask()
        // reads task.status, so the failure never propagated to the mission.
        // Honour the failure signal the executors already return.
        const failed = results.filter(r => r.result && r.result.success === false);
        const allFailed = results.length > 0 && failed.length === results.length;

        const fresh = taskQueue.getAll().find(t => t.id === task.id) || task;

        if (allFailed) {
            const errMsg = failed
                .map(r => r.result.error || r.result.result || `${r.type} failed`)
                .join("; ")
                .slice(0, 300);
            const elapsedF = Date.now() - _taskStart;
            _recordExecTiming(task, elapsedF, false);

            // OOPLIX V1 MASTER AUDIT (2026-08-16, A-to-Z backend coverage
            // audit): this branch previously always went straight to a
            // permanent "failed" on the very first attempt, completely
            // bypassing the retry/backoff logic the catch{} block below
            // already has for THROWN failures. A transient error (network
            // blip, temporary AI provider outage) that an executor reports
            // via {success:false} rather than throwing got zero retries,
            // while the identical failure surfacing as a thrown exception
            // got up to maxRetries with backoff — a real asymmetry, not by
            // design. agents/runtime/executionEngine.cjs already has the
            // correct, proven pattern for this exact scenario (its own
            // comment: "legacy executor can return a soft failure... without
            // throwing") — check result.nonRetriable (a real, established,
            // dozens-of-call-sites-wide convention: engineeringCapabilities.cjs,
            // businessMissionAutomation.cjs, growthOS.cjs, etc. already set
            // it correctly; only this loop never read it) and only skip
            // retry when a handler explicitly says retrying can't help.
            // Recurring tasks are unaffected — they were already correctly
            // rescheduled via their own cron, not this retry path.
            const anyNonRetriable = failed.some(r => r.result?.nonRetriable);
            if (task.recurringCron || anyNonRetriable) {
                taskQueue.update(task.id, {
                    status: task.recurringCron ? "pending" : "failed",
                    lastError: errMsg,
                    scheduledFor: task.recurringCron
                        ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
                        : fresh.scheduledFor,
                    executionLog: [
                        ...(fresh.executionLog || []),
                        logEntry("failed_execution", { error: errMsg, nonRetriable: anyNonRetriable })
                    ]
                });
                return { success: false, summary, error: errMsg };
            }

            const retries = (fresh.retries || 0) + 1;
            const delay = (task.retryDelay || 15000) * retries;
            if (retries >= (task.maxRetries || 3)) {
                taskQueue.update(task.id, {
                    status: "failed",
                    retries,
                    lastError: errMsg,
                    executionLog: [
                        ...(fresh.executionLog || []),
                        logEntry("failed_final", { error: errMsg, retries })
                    ]
                });
                console.log(`[AutoLoop] FAIL  task ${task.id} — exhausted ${retries} retries (soft failure)`);
            } else {
                const nextRun = new Date(Date.now() + delay).toISOString();
                taskQueue.update(task.id, {
                    status: "pending",
                    retries,
                    scheduledFor: nextRun,
                    lastError: errMsg,
                    executionLog: [
                        ...(fresh.executionLog || []),
                        logEntry("retry_scheduled", { attempt: retries, nextRun, error: errMsg })
                    ]
                });
                console.log(`[AutoLoop] RETRY task ${task.id} attempt ${retries}/${task.maxRetries} @ ${nextRun} (soft failure)`);
            }
            return { success: false, summary, error: errMsg };
        }

        taskQueue.update(task.id, {
            status: task.recurringCron ? "pending" : "completed",
            completedAt: new Date().toISOString(),
            // For recurring: reschedule 1 year forward (cron handles actual timing)
            scheduledFor: task.recurringCron
                ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
                : fresh.scheduledFor,
            // partialFailure: some sub-tasks failed but at least one succeeded — the
            // task still completed, but the degradation is recorded rather than hidden.
            ...(failed.length ? { partialFailure: failed.length } : {}),
            executionLog: [
                ...(fresh.executionLog || []),
                logEntry("completed", { output: summary.slice(0, 500) })
            ]
        });

        const elapsed = Date.now() - _taskStart;
        _recordExecTiming(task, elapsed, true);
        if (process.env.DEBUG === "1") { const logger = require("../backend/utils/logger"); logger.debug(`[AutoLoop] DONE  task ${task.id} (${elapsed}ms)`); }
        return { success: true, summary };
    } catch (err) {
        const elapsed = Date.now() - _taskStart;
        _recordExecTiming(task, elapsed, false);
        console.error(`[AutoLoop] ERROR task ${task.id} (${elapsed}ms): ${err.message}`);
        _recordFailure(task.input, err.message);

        const fresh = taskQueue.getAll().find(t => t.id === task.id) || task;
        const retries = (fresh.retries || 0) + 1;
        const delay = (task.retryDelay || 15000) * retries;   // linear back-off

        if (retries >= (task.maxRetries || 3)) {
            taskQueue.update(task.id, {
                status: "failed",
                retries,
                lastError: err.message,
                executionLog: [
                    ...(fresh.executionLog || []),
                    logEntry("failed_final", { error: err.message, retries })
                ]
            });
            console.log(`[AutoLoop] FAIL  task ${task.id} — exhausted ${retries} retries`);
        } else {
            const nextRun = new Date(Date.now() + delay).toISOString();
            taskQueue.update(task.id, {
                status: "pending",
                retries,
                scheduledFor: nextRun,
                lastError: err.message,
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
    if (_dispatching) return;   // skip if previous tick still running

    // Respect emergency stop — governor gates runtimeOrchestrator AND autonomousLoop
    try {
        const governor = require("./runtime/control/runtimeEmergencyGovernor.cjs");
        if (governor.isEmergencyActive()) {
            console.log("[AutoLoop] EMERGENCY STOP active — tick suppressed");
            return;
        }
    } catch { /* non-critical — never prevent normal operation for missing governor */ }

    _dispatching = true;
    try {
        // Sweep for tasks stuck in pending before executing new work
        taskQueue.abandonStuckTasks(STUCK_AGE_HOURS);

        const due = taskQueue.getDuePending();
        if (due.length === 0) return;

        const prereq = await _checkRuntimeReadiness();
        if (!prereq.ok) {
            console.warn(`[AutoLoop] skipping tick — prerequisites unavailable: ${prereq.reasons.join("; ")}`);
            return;
        }

        const batch = due.slice(0, MAX_TASKS_PER_TICK);
        console.log(`[AutoLoop] tick — ${due.length} task(s) due${due.length > batch.length ? ` (processing ${batch.length}, remainder picked up next tick)` : ""}`);
        for (const task of batch) {
            await _runTask(task);
        }
    } finally {
        _dispatching = false;
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
        if (_cronInFlight.has(task.id)) {
            console.warn(`[AutoLoop] cron fire for ${task.id} skipped — prior run still in flight`);
            return;
        }
        const all = taskQueue.getAll();
        const fresh = all.find(t => t.id === task.id);
        if (!fresh || fresh.status === "cancelled" || fresh.status === "failed") {
            job.stop();
            delete _cronJobs[task.id];
            return;
        }
        _cronInFlight.add(task.id);
        try {
            // Temporarily mark pending so _runTask sees a fresh copy
            taskQueue.update(task.id, { status: "pending", scheduledFor: new Date().toISOString() });
            await _runTask({ ...fresh, status: "pending" });
        } finally {
            _cronInFlight.delete(task.id);
        }
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

module.exports = { start, stop, addTask, getQueue: () => taskQueue.getAll(), getFailureReport, getTimingReport, _runTask };
