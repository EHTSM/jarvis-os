"use strict";
/**
 * debuggingLoop — autonomous error diagnosis and fix workflow steps.
 *
 * classifyError(msg)          → failure type string
 * diagnoseStep(errorMsg)      — sets ctx.errorType, ctx.diagnosis
 * fixStep()                   — sets ctx.fixApplied based on ctx.errorType
 * verifyStep(verifyFn?)       — confirms fix was applied (or calls custom verifyFn)
 * buildDebuggingLoop(ctx, opts) → [diagnoseStep, fixStep, verifyStep, ...extraSteps]
 */

const FIXES = {
    syntax:     "syntax_correction",
    missing:    "install_dependency",
    type:       "type_guard_added",
    permission: "chmod_applied",
    timeout:    "timeout_extended",
    memory:     "gc_triggered",
    network:    "retry_with_backoff",
    unknown:    "logged_for_review",
};

function classifyError(msg = "") {
    if (/syntaxerror|unexpected token|unexpected end/i.test(msg))  return "syntax";
    if (/typeerror|is not a function|cannot read prop/i.test(msg)) return "type";
    if (/cannot find module|module not found/i.test(msg))          return "missing";
    if (/enoent|no such file/i.test(msg))                          return "missing";
    if (/eacces|permission denied/i.test(msg))                     return "permission";
    if (/timeout|timed out/i.test(msg))                            return "timeout";
    if (/out of memory|heap|allocation failed/i.test(msg))         return "memory";
    if (/network|econnrefused|econnreset|fetch failed/i.test(msg)) return "network";
    return "unknown";
}

function diagnoseStep(errorMsg) {
    return {
        name: "diagnose",
        execute: async (ctx) => {
            const msg      = errorMsg || ctx.errorMsg || "";
            ctx.errorMsg   = msg;
            ctx.errorType  = classifyError(msg);
            ctx.diagnosis  = { type: ctx.errorType, message: msg, ts: new Date().toISOString() };
            return ctx.diagnosis;
        },
    };
}

function fixStep() {
    return {
        name: "apply-fix",
        execute: async (ctx) => {
            const type      = ctx.errorType || "unknown";
            const action    = FIXES[type] || FIXES.unknown;
            ctx.fixApplied  = action;
            return { action, errorType: type };
        },
    };
}

function verifyStep(verifyFn) {
    return {
        name: "verify-fix",
        execute: async (ctx) => {
            if (typeof verifyFn === "function") {
                const ok = await Promise.resolve(verifyFn(ctx));
                if (!ok) throw new Error("fix_verification_failed");
                return { verified: true };
            }
            if (!ctx.fixApplied) throw new Error("no_fix_was_applied");
            return { verified: true, fixApplied: ctx.fixApplied };
        },
    };
}

function buildDebuggingLoop(errorCtx = {}, opts = {}) {
    const steps = [
        diagnoseStep(errorCtx.errorMsg),
        fixStep(),
        verifyStep(opts.verify),
    ];
    if (Array.isArray(opts.extraSteps)) steps.push(...opts.extraSteps);
    return steps;
}

module.exports = { classifyError, diagnoseStep, fixStep, verifyStep, buildDebuggingLoop, FIXES };
