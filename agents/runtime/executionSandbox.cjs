"use strict";
/**
 * executionSandbox — in-memory execution isolation layer.
 *
 * Provides:
 *   - Isolated ctx (deep-cloned per run, mutations don't leak)
 *   - Recursive workflow loop detection
 *   - Step count safety limit (default MAX_STEPS = 50)
 *   - Execution duration limit (default MAX_DURATION_MS = 5 min)
 *
 * This is distinct from evaluation/sandbox.cjs which isolates the filesystem.
 * This module isolates the in-memory execution context.
 */

const { runWorkflow } = require("./autonomousWorkflow.cjs");

const MAX_STEPS       = 50;
const MAX_DURATION_MS = 5 * 60 * 1000;  // 5 minutes

// Track active workflow names to detect recursive invocation
const _activeByName = new Map();  // normalizedName → count

function _normalizeName(name) {
    return name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
}

function _cloneCtx(ctx) {
    try   { return JSON.parse(JSON.stringify(ctx)); }
    catch { return { ...ctx }; }
}

// ── API ───────────────────────────────────────────────────────────────

/**
 * Check whether a workflow with this name is already executing.
 * Used to detect unintended recursive invocations.
 */
function detectRecursion(name) {
    return (_activeByName.get(_normalizeName(name)) || 0) > 0;
}

/**
 * Run a workflow in an isolated execution context.
 *
 * @param {string}   name
 * @param {object[]} steps
 * @param {{
 *   maxSteps?:       number
 *   maxDurationMs?:  number
 *   allowRecursion?: boolean
 *   ctx?:            object
 * }} opts
 * @returns {Promise<WorkflowResult & { sandboxed: true }>}
 */
async function runIsolated(name, steps, opts = {}) {
    const { maxSteps = MAX_STEPS, maxDurationMs = MAX_DURATION_MS } = opts;

    // ── Safety checks ──────────────────────────────────────────────
    if (steps.length > maxSteps) {
        return _rejected(name, steps.length,
            `Step count ${steps.length} exceeds sandbox limit ${maxSteps}`);
    }

    if (detectRecursion(name) && !opts.allowRecursion) {
        return _rejected(name, steps.length,
            `Recursive execution detected for workflow "${name}"`);
    }

    // ── Isolated ctx ───────────────────────────────────────────────
    const isolatedCtx = _cloneCtx(opts.ctx || {});
    const norm        = _normalizeName(name);
    _activeByName.set(norm, (_activeByName.get(norm) || 0) + 1);

    // ── Timeout race ───────────────────────────────────────────────
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error(`Sandbox timeout: "${name}" exceeded ${maxDurationMs}ms`)),
            maxDurationMs
        );
        if (timeoutHandle.unref) timeoutHandle.unref();
    });

    try {
        const result = await Promise.race([
            runWorkflow(name, steps, { ...opts, ctx: isolatedCtx }),
            timeoutPromise,
        ]);
        return { ...result, sandboxed: true, sandboxTimeout: false };
    } catch (err) {
        return {
            id:             `sandbox-${Date.now().toString(36)}`,
            name,
            success:        false,
            error:          err.message,
            sandboxed:      true,
            sandboxTimeout: err.message.includes("Sandbox timeout"),
            steps:          { total: steps.length, completed: 0, failed: 0, skipped: 0 },
            durationMs:     maxDurationMs,
            healthScore:    0,
            stepDetails:    [],
        };
    } finally {
        clearTimeout(timeoutHandle);
        const cur = _activeByName.get(norm) || 0;
        if (cur <= 1) _activeByName.delete(norm);
        else          _activeByName.set(norm, cur - 1);
    }
}

function _rejected(name, stepCount, reason) {
    return {
        id:              `sandbox-rejected-${Date.now().toString(36)}`,
        name,
        success:         false,
        error:           reason,
        sandboxed:       true,
        sandboxRejected: true,
        sandboxTimeout:  false,
        steps:           { total: stepCount, completed: 0, failed: 0, skipped: 0 },
        durationMs:      0,
        healthScore:     0,
        stepDetails:     [],
    };
}

/** Names of currently executing sandboxed workflows. */
function activeWorkflows() {
    return [..._activeByName.entries()]
        .filter(([, count]) => count > 0)
        .map(([name]) => name);
}

module.exports = {
    runIsolated,
    detectRecursion,
    activeWorkflows,
    MAX_STEPS,
    MAX_DURATION_MS,
};
