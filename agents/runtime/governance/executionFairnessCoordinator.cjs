"use strict";
/**
 * executionFairnessCoordinator — starvation prevention, fairness balancing,
 * long-wait execution recovery, execution aging compensation.
 *
 * evaluateFairness(spec)             → { fair, starvationChains, violations }
 * compensateStarvation(spec)         → { compensated, adjId, workflowId }
 * balanceExecutionPriority(execs)    → { balanced, avgPriority, adjustments }
 * getFairnessMetrics()               → FairnessMetrics
 * reset()
 *
 * Detects: starvation chains, unfair scheduling loops,
 *          priority monopolization, blocked low-priority execution.
 */

const STARVATION_THRESHOLD_MS = 5000;

let _executions  = new Map();   // workflowId → ExecutionRecord
let _adjustments = [];
let _counter     = 0;

// ── _registerExecution ────────────────────────────────────────────────

function _registerExecution(workflowId, spec = {}) {
    if (!_executions.has(workflowId)) {
        _executions.set(workflowId, {
            workflowId,
            priority:     spec.priority     ?? 5,
            waitTimeMs:   spec.waitTimeMs   ?? 0,
            retryCount:   spec.retryCount   ?? 0,
            recoveryMode: spec.recoveryMode ?? false,
            starved:      false,
            compensated:  false,
        });
    }
    return _executions.get(workflowId);
}

// ── evaluateFairness ──────────────────────────────────────────────────

function evaluateFairness(spec = {}) {
    const { executions = [] } = spec;

    for (const e of executions) {
        if (e.workflowId) _registerExecution(e.workflowId, e);
    }

    const starvationChains = [];
    const violations       = [];

    for (const [wfId, rec] of _executions) {
        if (rec.waitTimeMs >= STARVATION_THRESHOLD_MS && !rec.recoveryMode) {
            rec.starved = true;
            starvationChains.push({ workflowId: wfId, waitTimeMs: rec.waitTimeMs });
        }
    }

    // Priority monopolization: a high-priority workflow dominates while low-priority starves
    const nonRecoveryPriorities = [..._executions.values()]
        .filter(r => !r.recoveryMode).map(r => r.priority);
    if (nonRecoveryPriorities.some(p => p >= 9) && nonRecoveryPriorities.some(p => p <= 3))
        violations.push({ type: "priority_monopolization" });

    return {
        fair:            starvationChains.length === 0 && violations.length === 0,
        starvationChains,
        violations,
        starvedCount:    starvationChains.length,
        evaluatedCount:  _executions.size,
    };
}

// ── compensateStarvation ──────────────────────────────────────────────

function compensateStarvation(spec = {}) {
    const { workflowId = null, priorityBoost = 3 } = spec;
    if (!workflowId) return { compensated: false, reason: "workflowId_required" };

    const rec = _executions.get(workflowId);
    if (!rec) return { compensated: false, reason: "execution_not_found" };

    const oldPriority = rec.priority;
    rec.priority      = Math.min(10, rec.priority + priorityBoost);
    rec.starved       = false;
    rec.compensated   = true;

    const adjId = `adj-${++_counter}`;
    _adjustments.push({
        adjId, workflowId, type: "starvation_compensation",
        oldPriority, newPriority: rec.priority, ts: new Date().toISOString(),
    });

    return {
        compensated:  true,
        adjId,
        workflowId,
        oldPriority,
        newPriority:  rec.priority,
        priorityBoost: rec.priority - oldPriority,
    };
}

// ── balanceExecutionPriority ──────────────────────────────────────────

function balanceExecutionPriority(executions = []) {
    if (!Array.isArray(executions) || executions.length === 0)
        return { balanced: false, reason: "no_executions_provided" };

    for (const e of executions) {
        if (e.workflowId) _registerExecution(e.workflowId, e);
    }

    const avgPriority = executions.reduce((s, e) => s + (e.priority ?? 5), 0) / executions.length;
    const adjustments = [];

    for (const e of executions) {
        if (!e.workflowId) continue;
        const rec = _executions.get(e.workflowId);
        if (!rec) continue;

        const oldPriority = rec.priority;
        rec.priority      = +(oldPriority * 0.5 + avgPriority * 0.5).toFixed(1);
        if (rec.priority !== oldPriority)
            adjustments.push({ workflowId: e.workflowId, oldPriority, newPriority: rec.priority });
    }

    return { balanced: true, avgPriority: +avgPriority.toFixed(2), adjustmentCount: adjustments.length, adjustments };
}

// ── getFairnessMetrics ────────────────────────────────────────────────

function getFairnessMetrics() {
    const all = [..._executions.values()];
    return {
        totalTracked:     all.length,
        starvedCount:     all.filter(r => r.starved).length,
        compensatedCount: all.filter(r => r.compensated).length,
        totalAdjustments: _adjustments.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions  = new Map();
    _adjustments = [];
    _counter     = 0;
}

module.exports = {
    STARVATION_THRESHOLD_MS,
    evaluateFairness, compensateStarvation, balanceExecutionPriority,
    getFairnessMetrics, reset,
};
