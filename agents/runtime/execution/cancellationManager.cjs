"use strict";
/**
 * cancellationManager — graceful and forced process cancellation.
 *
 * register(executionId)
 * cancel(executionId, opts?)        → { cancelled, executionId, method }
 *   opts.force: boolean             — SIGKILL instead of SIGTERM
 * isCancelled(executionId)          → boolean
 * setProcess(executionId, proc)     — attach spawned process for kill
 * onCancel(executionId, handler)    — register cleanup hook
 * runCleanupHooks(executionId)      → Promise (runs all registered cleanup hooks)
 * deregister(executionId)
 * reset()
 */

// executionId → { cancelled, method, cancelledAt, process?, handlers[] }
const _tokens = new Map();

function register(executionId) {
    _tokens.set(executionId, { cancelled: false, method: null, cancelledAt: null, process: null, handlers: [] });
}

function cancel(executionId, opts = {}) {
    const token = _tokens.get(executionId);
    if (!token)         return { cancelled: false, reason: "not_registered",    executionId };
    if (token.cancelled) return { cancelled: true,  reason: "already_cancelled", executionId, method: token.method };

    token.cancelled  = true;
    token.method     = opts.force ? "forced" : "graceful";
    token.cancelledAt = new Date().toISOString();

    if (token.process) {
        try {
            token.process.kill(opts.force ? "SIGKILL" : "SIGTERM");
        } catch (_) { /* process may already be gone */ }
    }

    return { cancelled: true, executionId, method: token.method };
}

function isCancelled(executionId) {
    return _tokens.get(executionId)?.cancelled ?? false;
}

function setProcess(executionId, proc) {
    const token = _tokens.get(executionId);
    if (token) token.process = proc;
}

function onCancel(executionId, handler) {
    const token = _tokens.get(executionId);
    if (token) token.handlers.push(handler);
}

async function runCleanupHooks(executionId) {
    const token = _tokens.get(executionId);
    if (!token) return;
    for (const fn of token.handlers) {
        try { await fn(); } catch (_) { /* swallow — cleanup must not crash */ }
    }
}

function deregister(executionId) { _tokens.delete(executionId); }
function reset()                 { _tokens.clear(); }

module.exports = { register, cancel, isCancelled, setProcess, onCancel, runCleanupHooks, deregister, reset };
