"use strict";
/**
 * selfHealingCoordinator — anomaly-triggered healing and orchestration stabilization.
 *
 * detectAndHeal(anomalies, context)          → HealingResult
 * isolateNode(nodeId, reason)                → IsolationResult
 * executeRecoveryChain(steps, context)       → ChainResult
 * stabilizeOrchestration(metrics)            → StabilizationResult
 * scoreAdaptiveStability(history)            → StabilityScore
 * getHealingHistory()                        → HealingRecord[]
 * reset()
 */

const HEALING_ACTIONS = {
    retry_spike:        ["reduce_retry_limit", "enable_circuit_breaker"],
    rollback_cycle:     ["isolate_task", "switch_to_sandbox", "notify_oncall"],
    repeated_loop:      ["terminate_loop", "quarantine_execution"],
    cascading_failure:  ["circuit_break_all", "shed_load", "enable_recovery_mode"],
    memory_exhaustion:  ["free_memory_pools", "reduce_concurrency", "restart_workers"],
    unknown:            ["enable_safe_mode", "investigate"],
};

let _healingHistory = [];
let _isolatedNodes  = new Set();
let _chains         = new Map();
let _chainCounter   = 0;

// ── detectAndHeal ─────────────────────────────────────────────────────

function detectAndHeal(anomalies = [], context = {}) {
    if (anomalies.length === 0) return { healed: false, reason: "no_anomalies" };

    const triggerTypes = [...new Set(anomalies.map(a => a.type ?? "unknown"))];
    const actions      = [...new Set(
        triggerTypes.flatMap(t => HEALING_ACTIONS[t] ?? HEALING_ACTIONS.unknown)
    )];

    const HIGH_SEVERITY = new Set(["rollback_cycle", "cascading_failure", "memory_exhaustion"]);
    const severity      = triggerTypes.some(t => HIGH_SEVERITY.has(t)) ? "high" : "medium";

    const record = { triggers: triggerTypes, actions, context: { ...context }, severity, healedAt: new Date().toISOString() };
    _healingHistory.push(record);

    return { healed: true, triggers: triggerTypes, actions, severity };
}

// ── isolateNode ───────────────────────────────────────────────────────

function isolateNode(nodeId, reason = "manual") {
    _isolatedNodes.add(nodeId);
    const record = { type: "node_isolated", nodeId, reason, isolatedAt: new Date().toISOString() };
    _healingHistory.push(record);
    return { isolated: true, nodeId, reason };
}

// ── executeRecoveryChain ──────────────────────────────────────────────

function executeRecoveryChain(steps = [], context = {}) {
    if (steps.length === 0) return { executed: false, reason: "empty_chain" };

    const chainId = `chain-${++_chainCounter}`;
    const results = [];
    let   failed  = false;

    for (const step of steps) {
        const name    = step.name ?? (typeof step === "string" ? step : "unnamed");
        const success = step.alwaysFail !== true && step.shouldFail !== true;
        results.push({ step: name, success, ts: new Date().toISOString() });
        if (!success && step.stopOnFailure !== false) { failed = true; break; }
    }

    const result = {
        chainId,
        executed:  true,
        steps:     results,
        succeeded: results.every(r => r.success),
        failed,
        stepsRun:  results.length,
        context:   { ...context },
    };
    _chains.set(chainId, result);
    return result;
}

// ── stabilizeOrchestration ────────────────────────────────────────────

function stabilizeOrchestration(metrics = {}) {
    const { successRate = 1, avgRetries = 0, errorRate = 0, pressure = "none" } = metrics;
    const actions = [];

    if (successRate < 0.5)          actions.push("reduce_concurrency");
    if (avgRetries  > 3)            actions.push("reduce_retry_limit");
    if (errorRate   > 0.3)          actions.push("enable_circuit_breaker");
    if (pressure    === "critical") actions.push("shed_load");

    const stable = actions.length === 0;
    const raw    = 100
        - (1 - successRate) * 40
        - avgRetries        * 5
        - errorRate         * 30
        - (pressure === "critical" ? 20 : 0);
    const stabilizationScore = +Math.max(0, raw).toFixed(1);

    return { stable, actions, stabilizationScore, metrics: { successRate, avgRetries, errorRate, pressure } };
}

// ── scoreAdaptiveStability ────────────────────────────────────────────

function scoreAdaptiveStability(history = []) {
    if (history.length === 0) return { score: 0, grade: "F", reason: "no_history" };

    const healed         = history.filter(h => h.healed !== false).length;
    const healRate       = healed / history.length;
    const avgActions     = history.reduce((s, h) => s + (h.actions?.length ?? 0), 0) / history.length;
    const raw            = Math.min(100, healRate * 70 + Math.max(0, 30 - avgActions * 5));
    const score          = +raw.toFixed(1);
    const grade          = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, healSuccessRate: +healRate.toFixed(3), avgActionsPerHeal: +avgActions.toFixed(2) };
}

// ── getHealingHistory / reset ─────────────────────────────────────────

function getHealingHistory() { return [..._healingHistory]; }

function reset() {
    _healingHistory = [];
    _isolatedNodes  = new Set();
    _chains         = new Map();
    _chainCounter   = 0;
}

module.exports = {
    HEALING_ACTIONS,
    detectAndHeal, isolateNode, executeRecoveryChain,
    stabilizeOrchestration, scoreAdaptiveStability, getHealingHistory,
    reset,
};
