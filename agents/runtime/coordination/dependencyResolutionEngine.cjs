"use strict";
/**
 * dependencyResolutionEngine — validate dependency readiness, detect blockages,
 * propagate failures downstream, and analyze execution impact.
 *
 * resolveDependencies(execId, spec)           → ResolutionRecord
 * getBlockedExecutions()                      → ResolutionRecord[]
 * propagateDependencyFailure(failedDepId)     → { propagated, affectedCount, affected }
 * analyzeDependencyImpact(executionId)        → ImpactRecord
 * validateDependencyHealth(executionId)       → HealthRecord
 * reset()
 */

let _executions = new Map();
let _counter    = 0;

// ── resolveDependencies ───────────────────────────────────────────────

function resolveDependencies(executionId, spec = {}) {
    const {
        dependencies          = [],
        completedDependencies = [],
        failedDependencies    = [],
    } = spec;

    const blockedOn  = dependencies.filter(
        d => !completedDependencies.includes(d) && !failedDependencies.includes(d)
    );
    const hasFailed  = dependencies.some(d => failedDependencies.includes(d));

    const status = hasFailed        ? "failed"
                 : blockedOn.length > 0 ? "blocked"
                 :                        "ready";

    const record = {
        resolutionId:         `res-${++_counter}`,
        executionId,
        dependencies:         [...dependencies],
        completedDependencies: [...completedDependencies],
        failedDependencies:   [...failedDependencies],
        blockedOn,
        status,
        resolvedAt:           new Date().toISOString(),
    };
    _executions.set(executionId, record);
    return record;
}

// ── getBlockedExecutions ──────────────────────────────────────────────

function getBlockedExecutions() {
    return [..._executions.values()].filter(e => e.status === "blocked");
}

// ── propagateDependencyFailure ────────────────────────────────────────

function propagateDependencyFailure(failedDependencyId) {
    const affected = [];
    for (const record of _executions.values()) {
        if (!record.dependencies.includes(failedDependencyId)) continue;
        if (record.failedDependencies.includes(failedDependencyId)) continue;

        record.failedDependencies.push(failedDependencyId);
        record.blockedOn = record.blockedOn.filter(d => d !== failedDependencyId);
        record.status    = "failed";
        affected.push(record.executionId);
    }
    return { propagated: true, affectedCount: affected.length, affected };
}

// ── analyzeDependencyImpact ───────────────────────────────────────────

function analyzeDependencyImpact(executionId) {
    const downstream = [];
    const visited    = new Set();

    function walk(id) {
        for (const r of _executions.values()) {
            if (r.dependencies.includes(id) && !visited.has(r.executionId)) {
                visited.add(r.executionId);
                downstream.push(r.executionId);
                walk(r.executionId);
            }
        }
    }
    walk(executionId);

    const record = _executions.get(executionId);
    if (!record && downstream.length === 0) return { found: false, executionId };

    return {
        found:              true,
        executionId,
        status:             record ? record.status : null,
        blockedOn:          record ? record.blockedOn : [],
        downstreamAffected: downstream,
        impactDepth:        downstream.length,
    };
}

// ── validateDependencyHealth ──────────────────────────────────────────

function validateDependencyHealth(executionId) {
    const record = _executions.get(executionId);
    if (!record) return { healthy: false, reason: "execution_not_found" };

    const healthy = record.blockedOn.length === 0 && record.failedDependencies.length === 0;
    return {
        healthy,
        executionId,
        status:             record.status,
        blockedOn:          record.blockedOn,
        failedDependencies: record.failedDependencies,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions = new Map();
    _counter    = 0;
}

module.exports = {
    resolveDependencies, getBlockedExecutions, propagateDependencyFailure,
    analyzeDependencyImpact, validateDependencyHealth, reset,
};
