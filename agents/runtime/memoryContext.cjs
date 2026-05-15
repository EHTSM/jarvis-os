"use strict";
/**
 * memoryContext — thin wrapper around contextEngine for the runtime layer.
 * Provides context injection for task execution and records results back.
 */

let _ctx = null;
function _engine() {
    if (!_ctx) {
        try {
            const { ContextEngine } = require("../contextEngine.cjs");
            _ctx = new ContextEngine();
        } catch {
            // contextEngine unavailable — return null-safe stubs
            _ctx = {
                findSimilar:      () => [],
                getContextPrompt: () => "",
                addConversation:  () => {},
                getHistory:       () => [],
            };
        }
    }
    return _ctx;
}

/**
 * Build a context object to inject into task execution.
 * @param {string} input  — raw user input for the task
 * @param {string} type   — task type
 * @returns {{ similar: object[], prompt: string, history: object[] }}
 */
function getContextForTask(input, type) {
    try {
        const engine  = _engine();
        const similar = engine.findSimilar(input) || [];
        const prompt  = engine.getContextPrompt()  || "";
        const history = (engine.getHistory()        || []).slice(-5);
        return { similar, prompt, history };
    } catch {
        return { similar: [], prompt: "", history: [] };
    }
}

/**
 * Record a completed task execution back into context memory.
 * @param {string} input
 * @param {object[]} tasks   — planner task objects
 * @param {object[]} results — execution results
 * @param {object}  meta     — { agentId, durationMs, success }
 */
function recordExecution(input, tasks, results, meta = {}) {
    try {
        _engine().addConversation(input, tasks, results, {
            processedBy: meta.agentId   || "runtime",
            duration:    meta.durationMs || 0,
            success:     meta.success,
        });
    } catch { /* non-critical */ }
}

module.exports = { getContextForTask, recordExecution };
