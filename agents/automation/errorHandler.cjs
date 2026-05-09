/**
 * Error Handler — catches all automation failures and returns safe responses.
 * Prevents raw crashes from propagating to the API layer.
 */

const logManager = require("./logManager.cjs");

function handle(err, context = {}) {
    const message = err?.message || String(err);
    const stack   = err?.stack   || null;

    logManager.error("Automation failure", { error: message, ...context });

    return {
        success:   false,
        error:     message,
        context,
        ts:        new Date().toISOString(),
        ...(process.env.NODE_ENV !== "production" && stack ? { stack } : {})
    };
}

function wrap(fn, context = {}) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (err) {
            return handle(err, context);
        }
    };
}

module.exports = { handle, wrap };
