"use strict";
/**
 * executionLimits — operational ceilings that prevent runaway execution.
 *
 * DEFAULT_LIMITS: maxRetries, maxDepth, maxRepairLoops, maxExecutionMs
 *
 * enforce(context, limits?)
 *   → { allowed, reason, violated[] }
 *
 * wrapWithTimeout(fn, ms)
 *   → async fn that rejects with "execution_timeout" after ms
 *
 * trackDepth(workflowId)    → { depth, allowed }  — increments nesting counter
 * releaseDepth(workflowId)  — decrements nesting counter
 *
 * createLimiter(limits?)    → stateful limiter object:
 *   .tick(phase)            → { allowed, reason }
 *   .exceeded()             → boolean
 *   .summary()              → { retries, repairLoops, violations }
 *
 * reset()
 */

const DEFAULT_LIMITS = {
    maxRetries:      5,
    maxDepth:        10,
    maxRepairLoops:  3,
    maxExecutionMs:  30_000,
};

// workflowId → current nesting depth
const _depths = new Map();

// ── enforce ───────────────────────────────────────────────────────────

function enforce(context = {}, limits = {}) {
    const L       = { ...DEFAULT_LIMITS, ...limits };
    const violated = [];

    if ((context.retries      ?? 0) > L.maxRetries)     violated.push("maxRetries");
    if ((context.depth        ?? 0) > L.maxDepth)       violated.push("maxDepth");
    if ((context.repairLoops  ?? 0) > L.maxRepairLoops) violated.push("maxRepairLoops");
    if ((context.elapsedMs    ?? 0) > L.maxExecutionMs) violated.push("maxExecutionMs");

    return {
        allowed:  violated.length === 0,
        reason:   violated.length > 0 ? `limit_exceeded: ${violated.join(", ")}` : "ok",
        violated,
    };
}

// ── wrapWithTimeout ───────────────────────────────────────────────────

function wrapWithTimeout(fn, ms) {
    return async function wrapped(...args) {
        return Promise.race([
            Promise.resolve(fn(...args)),
            new Promise((_, rej) => {
                const t = setTimeout(() => rej(new Error("execution_timeout")), ms);
                if (t.unref) t.unref();
            }),
        ]);
    };
}

// ── depth tracking ────────────────────────────────────────────────────

function trackDepth(workflowId, limits = {}) {
    const max   = limits.maxDepth ?? DEFAULT_LIMITS.maxDepth;
    const depth = (_depths.get(workflowId) ?? 0) + 1;
    _depths.set(workflowId, depth);
    return { depth, allowed: depth <= max };
}

function releaseDepth(workflowId) {
    const d = _depths.get(workflowId) ?? 0;
    if (d <= 1) _depths.delete(workflowId);
    else        _depths.set(workflowId, d - 1);
}

function getDepth(workflowId) {
    return _depths.get(workflowId) ?? 0;
}

// ── createLimiter ─────────────────────────────────────────────────────

function createLimiter(limits = {}) {
    const L = { ...DEFAULT_LIMITS, ...limits };
    let retries     = 0;
    let repairLoops = 0;
    let violations  = [];
    let startMs     = Date.now();

    return {
        tick(phase = "retry") {
            if (phase === "retry"      || phase === "retries")     retries++;
            if (phase === "repair"     || phase === "repairLoops") repairLoops++;

            const ctx = {
                retries,
                repairLoops,
                elapsedMs: Date.now() - startMs,
                depth:     0,
            };
            const result = enforce(ctx, L);
            if (!result.allowed) violations.push(...result.violated.filter(v => !violations.includes(v)));
            return result;
        },
        exceeded()  { return violations.length > 0; },
        summary()   { return { retries, repairLoops, violations: [...violations] }; },
        reset()     { retries = 0; repairLoops = 0; violations = []; startMs = Date.now(); },
    };
}

function reset() { _depths.clear(); }

module.exports = {
    enforce,
    wrapWithTimeout,
    trackDepth,
    releaseDepth,
    getDepth,
    createLimiter,
    reset,
    DEFAULT_LIMITS,
};
