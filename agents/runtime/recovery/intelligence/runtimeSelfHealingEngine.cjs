"use strict";
/**
 * runtimeSelfHealingEngine — runtime diagnosis, healing action selection,
 * replay-safe healing execution, and outcome validation.
 *
 * diagnoseRuntime(spec)          → { diagnosed, diagnosisId, issues, healingPlan }
 * executeHealingAction(spec)     → { executed, actionId, workflowId, action, outcome }
 * validateHealingOutcome(spec)   → { valid, improved, deltaScore }
 * getSelfHealingMetrics()        → SelfHealingMetrics
 * reset()
 *
 * Issue types:    latency_degradation | starvation_chain | queue_overflow |
 *                 error_spike | resource_contention | cascade_risk
 * Healing actions: increase_priority | reduce_concurrency | flush_queue |
 *                  restart_workflow | degrade_service | isolate_workflow | compensate_starvation
 */

const HEALING_ACTIONS = [
    "increase_priority", "reduce_concurrency", "flush_queue",
    "restart_workflow",  "degrade_service",    "isolate_workflow", "compensate_starvation",
];

const ISSUE_THRESHOLDS = {
    latency_degradation: { latencyMs: 1000 },
    starvation_chain:    { starvationCount: 2 },
    queue_overflow:      { queueDepth: 50 },
    error_spike:         { errorRate: 0.3 },
    resource_contention: { pressureScore: 0.6 },
    cascade_risk:        { cascadeDepth: 2 },
};

const ISSUE_ACTIONS = {
    latency_degradation: "reduce_concurrency",
    starvation_chain:    "compensate_starvation",
    queue_overflow:      "flush_queue",
    error_spike:         "restart_workflow",
    resource_contention: "degrade_service",
    cascade_risk:        "isolate_workflow",
};

let _diagnoses = [];
let _actions   = [];
let _counter   = 0;

// ── diagnoseRuntime ───────────────────────────────────────────────────

function diagnoseRuntime(spec = {}) {
    const {
        pressureScore   = 0,
        bottleneckCount = 0,
        starvationCount = 0,
        errorRate       = 0,
        queueDepth      = 0,
        latencyMs       = 0,
        cascadeDepth    = 0,
    } = spec;

    const issues = [];

    if (latencyMs       >= ISSUE_THRESHOLDS.latency_degradation.latencyMs)
        issues.push({ type: "latency_degradation",  value: latencyMs,       threshold: ISSUE_THRESHOLDS.latency_degradation.latencyMs });
    if (starvationCount >= ISSUE_THRESHOLDS.starvation_chain.starvationCount)
        issues.push({ type: "starvation_chain",     value: starvationCount, threshold: ISSUE_THRESHOLDS.starvation_chain.starvationCount });
    if (queueDepth      >= ISSUE_THRESHOLDS.queue_overflow.queueDepth)
        issues.push({ type: "queue_overflow",       value: queueDepth,      threshold: ISSUE_THRESHOLDS.queue_overflow.queueDepth });
    if (errorRate       >= ISSUE_THRESHOLDS.error_spike.errorRate)
        issues.push({ type: "error_spike",          value: errorRate,       threshold: ISSUE_THRESHOLDS.error_spike.errorRate });
    if (pressureScore   >= ISSUE_THRESHOLDS.resource_contention.pressureScore)
        issues.push({ type: "resource_contention",  value: pressureScore,   threshold: ISSUE_THRESHOLDS.resource_contention.pressureScore });
    if (cascadeDepth    >= ISSUE_THRESHOLDS.cascade_risk.cascadeDepth)
        issues.push({ type: "cascade_risk",         value: cascadeDepth,    threshold: ISSUE_THRESHOLDS.cascade_risk.cascadeDepth });

    // Build healing plan: deduplicated actions ordered by issue severity
    const seenActions  = new Set();
    const healingPlan  = [];
    for (const issue of issues) {
        const action = ISSUE_ACTIONS[issue.type];
        if (!seenActions.has(action)) {
            seenActions.add(action);
            healingPlan.push({ action, targetIssue: issue.type });
        }
    }

    const diagnosisId = `diag-${++_counter}`;
    _diagnoses.push({ diagnosisId, issueCount: issues.length, issues, healingPlan, diagnosedAt: new Date().toISOString() });

    return {
        diagnosed:   true,
        diagnosisId,
        issueCount:  issues.length,
        issues,
        healingPlan,
        needsHealing: issues.length > 0,
    };
}

// ── executeHealingAction ──────────────────────────────────────────────

function executeHealingAction(spec = {}) {
    const { workflowId = null, action = null, diagnosisId = null } = spec;
    if (!workflowId) return { executed: false, reason: "workflowId_required" };
    if (!action)     return { executed: false, reason: "action_required" };
    if (!HEALING_ACTIONS.includes(action))
        return { executed: false, reason: `invalid_action: ${action}` };

    const actionId = `heal-${++_counter}`;
    const outcome  = "applied";
    _actions.push({ actionId, workflowId, action, diagnosisId, outcome, executedAt: new Date().toISOString() });

    return { executed: true, actionId, workflowId, action, outcome, diagnosisId };
}

// ── validateHealingOutcome ────────────────────────────────────────────

function validateHealingOutcome(spec = {}) {
    const { beforeScore = null, afterScore = null, actionId = null } = spec;
    if (beforeScore == null) return { valid: false, reason: "beforeScore_required" };
    if (afterScore  == null) return { valid: false, reason: "afterScore_required" };

    const deltaScore = +(beforeScore - afterScore).toFixed(3);
    const improved   = deltaScore > 0;
    const neutral    = Math.abs(deltaScore) < 0.01;

    let outcome = improved ? "improved" : (neutral ? "neutral" : "degraded");

    return { valid: true, actionId, beforeScore, afterScore, deltaScore, improved, outcome };
}

// ── getSelfHealingMetrics ─────────────────────────────────────────────

function getSelfHealingMetrics() {
    const actionCounts = {};
    for (const a of HEALING_ACTIONS) actionCounts[a] = 0;
    for (const a of _actions) actionCounts[a.action] = (actionCounts[a.action] ?? 0) + 1;

    return {
        totalDiagnoses:   _diagnoses.length,
        totalActions:     _actions.length,
        totalIssuesFound: _diagnoses.reduce((s, d) => s + d.issueCount, 0),
        actionCounts,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _diagnoses = [];
    _actions   = [];
    _counter   = 0;
}

module.exports = {
    HEALING_ACTIONS, ISSUE_THRESHOLDS, ISSUE_ACTIONS,
    diagnoseRuntime, executeHealingAction, validateHealingOutcome,
    getSelfHealingMetrics, reset,
};
