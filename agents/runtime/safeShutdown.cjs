"use strict";
/**
 * safeShutdown — graceful shutdown coordinator.
 *
 * onShutdown(fn, priority, name)  — register a cleanup handler (lower priority = runs first)
 * shutdown(reason)                → { reason, handlersRun, results[] }
 * isShuttingDown()                → boolean
 * shutdownSignal()                → the reason/signal that triggered shutdown, or null
 * registerSignalHandlers()        — hook SIGTERM / SIGINT (idempotent)
 * reset()                         — for tests; clears all state
 */

const _handlers = [];
let   _inProgress = false;
let   _signal     = null;

function onShutdown(fn, priority = 50, name = "") {
    _handlers.push({ fn, priority, name: name || "(anon)" });
    _handlers.sort((a, b) => a.priority - b.priority);
}

async function shutdown(reason = "requested") {
    if (_inProgress) return { already: true };
    _inProgress = true;
    _signal     = reason;

    const results = [];
    for (const h of _handlers) {
        try {
            await Promise.resolve(h.fn(reason));
            results.push({ name: h.name, ok: true });
        } catch (e) {
            results.push({ name: h.name, ok: false, error: e.message });
        }
    }
    return { reason, handlersRun: results.length, results };
}

function isShuttingDown() { return _inProgress; }
function shutdownSignal()  { return _signal; }

function reset() {
    _handlers.length = 0;
    _inProgress      = false;
    _signal          = null;
    _sigRegistered   = false;
}

let _sigRegistered = false;

function registerSignalHandlers(exitOnShutdown = false) {
    if (_sigRegistered) return;
    _sigRegistered = true;
    for (const sig of ["SIGTERM", "SIGINT"]) {
        process.once(sig, async () => {
            await shutdown(sig);
            if (exitOnShutdown) process.exit(0);
        });
    }
}

module.exports = {
    onShutdown, shutdown, isShuttingDown, shutdownSignal,
    registerSignalHandlers, reset,
};
