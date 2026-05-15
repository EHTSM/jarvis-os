"use strict";
/**
 * runtimeOrchestrator — main entry point for the runtime layer.
 *
 * Public API:
 *   dispatch(input, options)  — synchronous: plan + execute, return results
 *   queue(input, priority)    — async: enqueue for background drain
 *   drainQueue()              — pop one item from priorityQueue and execute it
 *   status()                  — live diagnostics snapshot
 *   registerAgent(config)     — register an agent at runtime
 *
 * The drainQueue() is called externally (e.g., by autonomousLoop) or
 * via the periodic drain interval started inside this module.
 */

const logger   = require("../../backend/utils/logger");
const registry = require("./agentRegistry.cjs");
const pq       = require("./priorityQueue.cjs");
const engine   = require("./executionEngine.cjs");
const history  = require("./executionHistory.cjs");
const memory   = require("./memoryContext.cjs");

// Lazy-load planner — avoids circular deps at require time
let _planner = null;
function _getPlanner() {
    if (!_planner) {
        try { _planner = require("../planner.cjs"); } catch { _planner = null; }
    }
    return _planner;
}

// ── Drain interval ────────────────────────────────────────────────
// Process queued background tasks every 5s when queue is non-empty.
let _drainRef = null;
function _ensureDrainLoop() {
    if (_drainRef) return;
    _drainRef = setInterval(async () => {
        if (pq.size() > 0) await drainQueue();
    }, 5_000).unref();
}

// ── Planner wrapper ───────────────────────────────────────────────
function _plan(input) {
    const planner = _getPlanner();
    if (planner?.plannerAgent) {
        try { return planner.plannerAgent(input); } catch { /* fall through */ }
    }
    // Minimal fallback: single AI task
    return [{ type: "ai", label: input, payload: { query: input }, input }];
}

/**
 * Dispatch: plan the input, execute all sub-tasks, return aggregated result.
 * Blocks until all tasks complete (or fail with retries exhausted).
 *
 * @param {string} input   — user/system input
 * @param {object} options — { taskId, timeoutMs, retries, priority }
 * @returns {Promise<{ success, tasks, results, reply, durationMs }>}
 */
async function dispatch(input, options = {}) {
    const t0     = Date.now();
    const tasks  = _plan(input);
    const ctx    = memory.getContextForTask(input, tasks[0]?.type || "ai");

    logger.info(`[Runtime] dispatch — ${tasks.length} task(s) from input "${input.slice(0, 60)}"`);

    const results = await Promise.allSettled(
        tasks.map(task =>
            engine.executeTask(
                { ...task, input },
                { ...options, context: ctx }
            )
        )
    );

    const settled = results.map((r, i) =>
        r.status === "fulfilled" ? r.value : { success: false, error: r.reason?.message, taskType: tasks[i]?.type }
    );

    const allOk  = settled.every(r => r.success);
    const reply  = settled.map(r => r.result?.message || r.result?.result || r.error || "").filter(Boolean).join("\n").trim();
    const durationMs = Date.now() - t0;

    // Record back into memory
    memory.recordExecution(input, tasks, settled, {
        agentId:     settled[0]?.agentId || "runtime",
        durationMs,
        success:     allOk,
    });

    logger.info(`[Runtime] dispatch done in ${durationMs}ms — success=${allOk}`);
    return { success: allOk, tasks, results: settled, reply, durationMs };
}

/**
 * Queue an input for background execution.
 * @param {string} input
 * @param {number} priority — use pq.PRIORITY.*
 * @returns {number} queue entry id
 */
function queue(input, priority = pq.PRIORITY.NORMAL) {
    const id = pq.enqueue({ input }, priority);
    _ensureDrainLoop();
    logger.info(`[Runtime] queued id=${id} priority=${priority} — "${input.slice(0, 60)}"`);
    return id;
}

/**
 * Drain one item from the priority queue and execute it.
 * Called by the internal drain loop and by external callers (autonomousLoop).
 */
async function drainQueue() {
    const entry = pq.dequeue();
    if (!entry) return null;
    logger.info(`[Runtime] draining queue id=${entry.id} waitMs=${Date.now() - entry.enqueuedAt}`);
    try {
        return await dispatch(entry.task.input);
    } catch (err) {
        logger.error(`[Runtime] drain error for id=${entry.id}: ${err.message}`);
        return null;
    }
}

/**
 * Register an agent with the registry.
 * Convenience wrapper so callers import only this module.
 */
function registerAgent(config) {
    return registry.register(config);
}

/**
 * Live diagnostics snapshot.
 * @returns {{ queue, agents, history, uptime }}
 */
function status() {
    return {
        queue:   { size: pq.size(), items: pq.snapshot() },
        agents:  registry.listAll(),
        history: history.stats(),
        uptime:  process.uptime(),
    };
}

module.exports = { dispatch, queue, drainQueue, registerAgent, status };
