"use strict";
/**
 * recoveryManager — advanced deployment recovery operations.
 *
 * verifyRollback(deploymentId, record?)
 *   → { verified, checks[], issues[] }
 *
 * repairHealthCheck(config, maxRetries?)
 *   → Promise<{ recovered, attempts, lastResult }>
 *
 * repairEnvironment(requiredVars[])
 *   → { repaired, present[], missing[], score }
 *
 * resolvePortConflict(port, opts?)
 *   → Promise<{ resolved, suggestedPort, tried[] }>
 *
 * restoreDependencies(deps[], restoreFn?)
 *   → Promise<{ restored[], failed[], success }>
 *
 * reset()
 */

const pcd = require("./portConflictDetector.cjs");

let _log = [];
let _seq = 0;

// ── verifyRollback ────────────────────────────────────────────────────

function verifyRollback(deploymentId, record = {}) {
    const checks = [];
    const issues  = [];

    const addCheck = (name, ok, detail) => {
        checks.push({ name, passed: !!ok, detail: detail || "" });
        if (!ok) issues.push(name);
    };

    addCheck(
        "deployment_id_present",
        !!deploymentId,
        "deployment id must be provided"
    );
    addCheck(
        "status_is_rolled_back",
        record.status === "rolled_back" || record.status === undefined,
        `status: ${record.status || "unknown"}`
    );
    addCheck(
        "rollback_event_present",
        !record.events || record.events.some(e =>
            e.event === "rollback_complete" || e.event === "manual_rollback_triggered"
        ),
        "events log checked for rollback confirmation"
    );

    return { verified: issues.length === 0, checks, issues };
}

// ── repairHealthCheck ─────────────────────────────────────────────────

async function repairHealthCheck(config, maxRetries = 3) {
    const healthFn = config.healthCheck;
    if (typeof healthFn !== "function") {
        return { recovered: false, attempts: 0, lastResult: null, error: "no_health_check_fn" };
    }

    let attempts    = 0;
    let lastResult  = null;
    const delayMs   = config.retryDelayMs ?? 0;

    while (attempts < maxRetries) {
        attempts++;
        try {
            lastResult = await Promise.resolve(healthFn());
            if (lastResult?.healthy) {
                _emit("health_check_recovered", { deploymentId: config.id, attempts });
                return { recovered: true, attempts, lastResult };
            }
        } catch (e) {
            lastResult = { healthy: false, error: e.message };
        }
        if (delayMs > 0 && attempts < maxRetries) await _sleep(delayMs);
    }

    return { recovered: false, attempts, lastResult };
}

// ── repairEnvironment ─────────────────────────────────────────────────

function repairEnvironment(requiredVars = []) {
    const present = [];
    const missing = [];

    for (const v of requiredVars) {
        const name = typeof v === "string" ? v : v.name;
        if (process.env[name] !== undefined) {
            present.push(name);
        } else {
            missing.push(name);
        }
    }

    const score   = requiredVars.length > 0
        ? Math.round(present.length / requiredVars.length * 100)
        : 100;

    return { repaired: missing.length === 0, present, missing, score };
}

// ── resolvePortConflict ───────────────────────────────────────────────

async function resolvePortConflict(port, opts = {}) {
    const tried = [];
    const searchEnd = opts.searchEnd ?? Math.min(port + 50, 65535);

    // First try the requested port
    const initial = await pcd.checkPort(port);
    tried.push(port);

    if (initial.available) {
        return { resolved: true, suggestedPort: port, tried };
    }

    // Search for an alternative
    for (let p = port + 1; p <= searchEnd; p++) {
        tried.push(p);
        const r = await pcd.checkPort(p);
        if (r.available) {
            _emit("port_conflict_resolved", { original: port, resolved: p });
            return { resolved: true, suggestedPort: p, tried };
        }
    }

    return { resolved: false, suggestedPort: null, tried };
}

// ── restoreDependencies ───────────────────────────────────────────────

async function restoreDependencies(deps = [], restoreFn = null) {
    const restored = [];
    const failed   = [];

    const fn = typeof restoreFn === "function"
        ? restoreFn
        : async (dep) => ({ ok: true, dep });

    for (const dep of deps) {
        try {
            const result = await Promise.resolve(fn(dep));
            if (result?.ok !== false) restored.push(dep);
            else                      failed.push(dep);
        } catch {
            failed.push(dep);
        }
    }

    _emit("dependencies_restored", { restored: restored.length, failed: failed.length });
    return { restored, failed, success: failed.length === 0 };
}

// ── internals ─────────────────────────────────────────────────────────

function _emit(type, data = {}) {
    _log.push({ seq: ++_seq, ts: new Date().toISOString(), type, ...data });
}

function _sleep(ms) {
    return new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        if (t.unref) t.unref();
    });
}

function getLog()  { return [..._log]; }
function reset()   { _log = []; _seq = 0; }

module.exports = {
    verifyRollback,
    repairHealthCheck,
    repairEnvironment,
    resolvePortConflict,
    restoreDependencies,
    getLog,
    reset,
};
