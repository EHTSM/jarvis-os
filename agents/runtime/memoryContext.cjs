"use strict";
/**
 * memoryContext — injects recent execution history into task context.
 * Replaced the archived stub with a live connection to executionHistory.
 */

function _history() {
    try { return require("./executionHistory.cjs"); } catch { return null; }
}

/**
 * Build context to inject into task execution.
 * Returns last 5 executions as history + a formatted prompt snippet.
 */
function getContextForTask(input, type) {
    try {
        const hist = _history();
        if (!hist) return { similar: [], prompt: "", history: [] };

        const recent = hist.recent(10);
        if (!recent.length) return { similar: [], prompt: "", history: [] };

        // Find semantically similar entries by keyword overlap with the input
        const inputWords = new Set(
            (input || "").toLowerCase().split(/\W+/).filter(w => w.length > 3)
        );
        const similar = recent.filter(e => {
            if (!e.input) return false;
            const eWords = e.input.toLowerCase().split(/\W+/);
            return eWords.some(w => w.length > 3 && inputWords.has(w));
        }).slice(0, 3);

        // Build a compact context prompt from the last 5 executions
        const last5 = recent.slice(0, 5);
        const promptLines = last5.map(e => {
            const status = e.success ? "ok" : "failed";
            return `[${status}] ${e.input?.slice(0, 80) || "(unknown)"}${e.error ? ` — error: ${e.error.slice(0, 60)}` : ""}`;
        });

        const prompt = promptLines.length
            ? `Recent execution context:\n${promptLines.join("\n")}`
            : "";

        return { similar, prompt, history: last5 };
    } catch {
        return { similar: [], prompt: "", history: [] };
    }
}

/**
 * Record a completed task execution back into context memory.
 * Delegates to executionHistory which is the real store.
 */
function recordExecution(input, tasks, results, meta = {}) {
    try {
        const hist = _history();
        if (!hist || typeof hist.record !== "function") return;
        const firstResult = Array.isArray(results) ? results[0] : results;
        hist.record({
            agentId:    meta.agentId    || "runtime",
            taskType:   (tasks?.[0]?.type) || "general",
            taskId:     (tasks?.[0]?.id)   || "",
            success:    meta.success !== false,
            durationMs: meta.durationMs    || 0,
            error:      meta.error         || (firstResult?.error) || null,
            input:      input,
            output:     (firstResult?.output || firstResult?.result || "").slice(0, 120),
        });
    } catch { /* non-critical */ }
}

module.exports = { getContextForTask, recordExecution };
