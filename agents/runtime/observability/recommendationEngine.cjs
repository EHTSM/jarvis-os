"use strict";
/**
 * recommendationEngine — generates actionable optimization recommendations.
 *
 * generate(context) → Recommendations[]
 *   context: { entries, depStability, bottlenecks, anomalies, healthScore, optimizationMemory }
 */

// ── individual generators ────────────────────────────────────────────

function generateRetryReductions(bottlenecks = {}, entries = []) {
    const recs = [];
    for (const item of (bottlenecks.retryHeavySteps ?? [])) {
        recs.push({
            type:        "retry_reduction",
            fingerprint: item.fingerprint,
            message:     `Workflow ${item.fingerprint} averages ${item.avgRetries.toFixed(1)} retries — reduce maxRetries to ${Math.max(1, Math.ceil(item.avgRetries) - 1)}`,
            currentAvg:  item.avgRetries,
            suggested:   Math.max(1, Math.ceil(item.avgRetries) - 1),
            priority:    "medium",
        });
    }
    return recs;
}

function generateSandboxRecommendations(healthScore = {}, entries = []) {
    const recs = [];
    const overall = healthScore?.overall?.score ?? 100;
    if (overall < 60) {
        recs.push({
            type:     "sandbox_recommendation",
            message:  `Runtime health is ${overall}/100 — recommend switching to sandbox strategy for all elevated+ workflows`,
            score:    overall,
            priority: "high",
        });
    }
    // Also recommend sandbox for high-rollback fingerprints
    const byFp = {};
    for (const e of entries) {
        if (!e.fingerprint) continue;
        if (!byFp[e.fingerprint]) byFp[e.fingerprint] = { total: 0, rollbacks: 0 };
        byFp[e.fingerprint].total++;
        if (e.rollbackTriggered) byFp[e.fingerprint].rollbacks++;
    }
    for (const [fp, stats] of Object.entries(byFp)) {
        const rollbackRate = stats.rollbacks / stats.total;
        if (rollbackRate > 0.4 && stats.total >= 2) {
            recs.push({
                type:        "sandbox_recommendation",
                fingerprint: fp,
                message:     `Workflow ${fp} has ${(rollbackRate * 100).toFixed(0)}% rollback rate — isolate in sandbox`,
                rollbackRate,
                priority:    "high",
            });
        }
    }
    return recs;
}

function generateDepWarnings(depDegradation = {}) {
    const recs = [];
    for (const [depId, trend] of Object.entries(depDegradation)) {
        if (trend.trend === "degrading") {
            recs.push({
                type:     "dep_stabilization_warning",
                depId,
                message:  `Dependency "${depId}" is degrading (${(trend.first * 100).toFixed(0)}% → ${(trend.last * 100).toFixed(0)}%) — investigate or pin version`,
                trend:    trend.trend,
                delta:    trend.delta,
                priority: trend.last < 0.5 ? "high" : "medium",
            });
        }
    }
    return recs;
}

function generateWorkflowRedesigns(anomalies = [], entries = []) {
    const recs = [];
    for (const anomaly of anomalies) {
        if (anomaly.type === "repeated_loop") {
            recs.push({
                type:        "workflow_redesign",
                fingerprint: anomaly.fingerprint,
                message:     `Workflow ${anomaly.fingerprint} is looping (${anomaly.executions}x in ${anomaly.timeSpanMs}ms) — add deduplication or circuit breaker`,
                anomalyType: anomaly.type,
                priority:    "high",
            });
        }
        if (anomaly.type === "rollback_cycle") {
            recs.push({
                type:        "workflow_redesign",
                fingerprint: anomaly.fingerprint,
                message:     `Workflow ${anomaly.fingerprint} is in a rollback cycle — redesign with staged execution and pre-flight checks`,
                anomalyType: anomaly.type,
                priority:    "high",
            });
        }
        if (anomaly.type === "execution_drift") {
            recs.push({
                type:        "workflow_redesign",
                fingerprint: anomaly.fingerprint,
                message:     `Workflow ${anomaly.fingerprint} uses ${anomaly.uniqueCount} different strategies — pin to a single reliable strategy`,
                anomalyType: anomaly.type,
                priority:    "medium",
            });
        }
    }
    return recs;
}

// ── generate ─────────────────────────────────────────────────────────

function generate(context = {}) {
    const {
        entries            = [],
        depDegradation     = {},
        bottlenecks        = {},
        anomalies          = [],
        healthScore        = {},
    } = context;

    const all = [
        ...generateRetryReductions(bottlenecks, entries),
        ...generateSandboxRecommendations(healthScore, entries),
        ...generateDepWarnings(depDegradation),
        ...generateWorkflowRedesigns(anomalies, entries),
    ];

    // Sort by priority: high → medium → low
    const ORDER = { high: 0, medium: 1, low: 2 };
    all.sort((a, b) => (ORDER[a.priority] ?? 2) - (ORDER[b.priority] ?? 2));

    return {
        recommendations: all,
        count:           all.length,
        highPriority:    all.filter(r => r.priority === "high").length,
        ts:              new Date().toISOString(),
    };
}

module.exports = {
    generateRetryReductions, generateSandboxRecommendations,
    generateDepWarnings, generateWorkflowRedesigns, generate,
};
