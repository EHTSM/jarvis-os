"use strict";
/**
 * executionEngine — async task executor with:
 *   - context injection from memoryContext
 *   - capability-based agent routing via taskRouter + agentRegistry
 *   - exponential backoff retries (max 3 attempts)
 *   - circuit breaker enforcement (per AgentRecord)
 *   - execution history recording
 *   - per-task timeout (default 30s)
 *
 * Falls back to the existing executor.cjs if no registered agent matches.
 */

const logger   = require("../../backend/utils/logger");
const registry = require("./agentRegistry.cjs");
const router   = require("./taskRouter.cjs");
const history  = require("./executionHistory.cjs");
const memory   = require("./memoryContext.cjs");
const dlq      = require("./deadLetterQueue.cjs");

const MAX_ATTEMPTS   = 3;
const BASE_BACKOFF   = 1_000;   // ms
const MAX_BACKOFF    = 30_000;  // ms
const DEFAULT_TIMEOUT = 30_000; // ms

// Lazy-load the existing executor as the universal fallback
let _legacyExecutor = null;
function _getLegacy() {
    if (!_legacyExecutor) {
        try { _legacyExecutor = require("../executor.cjs"); } catch { _legacyExecutor = null; }
    }
    return _legacyExecutor;
}

function _backoffMs(attempt) {
    return Math.min(BASE_BACKOFF * Math.pow(2, attempt), MAX_BACKOFF);
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms).unref());
}

function _withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms).unref()
        ),
    ]);
}

/**
 * Execute a single task object.
 *
 * @param {object} task    — planner task: { type, label, payload, input }
 * @param {object} options — { taskId, timeoutMs, retries, context }
 * @returns {Promise<{ success, result, agentId, durationMs, attempts, error }>}
 */
async function executeTask(task, options = {}) {
    const taskId     = options.taskId    || `t-${Date.now().toString(36)}`;
    const timeoutMs  = options.timeoutMs || DEFAULT_TIMEOUT;
    const maxRetries = options.retries   !== undefined ? options.retries : MAX_ATTEMPTS;

    // Inject memory context
    const ctx = options.context || memory.getContextForTask(task.input || task.label || "", task.type);

    const capability = router.resolveCapability(task.type);
    let   lastError  = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            await _sleep(_backoffMs(attempt - 1));
        }

        const agent = registry.findForCapability(capability);

        // If we have a registered agent, use it
        if (agent) {
            agent.acquireSlot();
            const t0 = Date.now();
            try {
                const result = await _withTimeout(
                    agent.handler(task, ctx),
                    timeoutMs,
                    `${agent.id}/${task.type}`
                );
                const durationMs = Date.now() - t0;
                agent.recordSuccess(durationMs);
                history.record({
                    agentId: agent.id, taskType: task.type, taskId,
                    success: true, durationMs,
                    input:  task.input || task.label || "",
                    output: result?.message || result?.result || "",
                });
                return { success: true, result, agentId: agent.id, durationMs, attempts: attempt + 1, error: null };
            } catch (err) {
                agent.recordFailure();
                lastError = err;
                history.record({
                    agentId: agent.id, taskType: task.type, taskId,
                    success: false, durationMs: Date.now() - t0,
                    input:  task.input || task.label || "",
                    error:  err.message,
                });
                logger.warn(`[ExecEngine] ${agent.id}/${task.type} attempt ${attempt + 1} failed: ${err.message}`);
            }
        } else {
            // No registered agent — try legacy executor (no circuit breaker)
            const legacy = _getLegacy();
            if (legacy?.execute) {
                const t0 = Date.now();
                try {
                    const result = await _withTimeout(
                        legacy.execute(task, ctx),
                        timeoutMs,
                        `legacy/${task.type}`
                    );
                    const durationMs = Date.now() - t0;
                    history.record({
                        agentId: "legacy", taskType: task.type, taskId,
                        success: true, durationMs,
                        input:  task.input || task.label || "",
                        output: result?.message || result?.result || "",
                    });
                    return { success: true, result, agentId: "legacy", durationMs, attempts: attempt + 1, error: null };
                } catch (err) {
                    lastError = err;
                    history.record({
                        agentId: "legacy", taskType: task.type, taskId,
                        success: false, durationMs: Date.now() - t0,
                        input:  task.input || task.label || "",
                        error:  err.message,
                    });
                    logger.warn(`[ExecEngine] legacy/${task.type} attempt ${attempt + 1} failed: ${err.message}`);
                }
            } else {
                // Nothing can handle this — bail immediately, no retry
                const msg = `No handler for capability "${capability}" (type: ${task.type})`;
                logger.warn(`[ExecEngine] ${msg}`);
                return { success: false, result: null, agentId: null, durationMs: 0, attempts: 1, error: msg };
            }
        }
    }

    const finalError = lastError?.message || "unknown";
    logger.error(`[ExecEngine] ${task.type} FAILED after ${maxRetries} attempts: ${finalError}`);
    // Push to dead-letter queue so the failure is not silently lost
    try {
        dlq.push({ taskId, taskType: task.type, input: task.input || task.label || "", error: finalError, attempts: maxRetries, agentId: null });
    } catch { /* non-critical */ }
    return { success: false, result: null, agentId: null, durationMs: 0, attempts: maxRetries, error: finalError };
}

module.exports = { executeTask };
