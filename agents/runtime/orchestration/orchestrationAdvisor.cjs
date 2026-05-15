"use strict";
/**
 * orchestrationAdvisor — generates orchestration recommendations.
 *
 * generate(context) → AdvisorResult
 */

// ── individual generators ────────────────────────────────────────────

function suggestQueueOptimization(queue = [], history = []) {
    const recs = [];

    if (queue.length > 20) {
        recs.push({
            type:     "queue_optimization",
            message:  `Queue depth ${queue.length} — consider batching low-priority tasks or increasing concurrency`,
            depth:    queue.length,
            priority: "medium",
        });
    }

    // Detect stale high-priority tasks that keep getting pre-empted
    const stale = queue.filter(e => e.priority >= 80 && (Date.now() - e.enqueuedAt) > 15000);
    for (const entry of stale) {
        recs.push({
            type:       "queue_optimization",
            message:    `High-priority task "${entry.taskId}" has been waiting ${Math.round((Date.now() - entry.enqueuedAt) / 1000)}s — check for dep blockage`,
            taskId:     entry.taskId,
            waitMs:     Date.now() - entry.enqueuedAt,
            priority:   "high",
        });
    }

    return recs;
}

function suggestConcurrencyTuning(resourceStatus = {}) {
    const recs = [];
    const { pressure, avgQueueDepth, totalProcesses } = resourceStatus;

    if (pressure === "high" || pressure === "critical") {
        recs.push({
            type:     "concurrency_tuning",
            message:  `Resource pressure is "${pressure}" — reduce max concurrency to relieve ${pressure === "critical" ? "critical" : "high"} load`,
            pressure,
            action:   "reduce_concurrency",
            priority: "high",
        });
    } else if (pressure === "none" && (avgQueueDepth ?? 0) > 5) {
        recs.push({
            type:     "concurrency_tuning",
            message:  `Queue backing up (depth ${avgQueueDepth?.toFixed(1)}) with no resource pressure — safe to increase concurrency`,
            action:   "increase_concurrency",
            priority: "medium",
        });
    }

    return recs;
}

function suggestIsolation(openBreakers = [], quarantined = [], anomalies = []) {
    const recs = [];

    for (const b of openBreakers) {
        recs.push({
            type:        "isolation_recommendation",
            fingerprint: b.fingerprint,
            message:     `Circuit breaker open for "${b.fingerprint}" (${b.consecutiveFails} consecutive failures) — isolate or quarantine`,
            failures:    b.failures,
            priority:    "high",
        });
    }

    const loopAnomalies = anomalies.filter(a => a.type === "repeated_loop" || a.type === "rollback_cycle");
    for (const a of loopAnomalies) {
        recs.push({
            type:        "isolation_recommendation",
            fingerprint: a.fingerprint,
            message:     `Anomaly "${a.type}" detected for "${a.fingerprint}" — isolate to prevent cascade`,
            anomalyType: a.type,
            priority:    "high",
        });
    }

    return recs;
}

function suggestDepRerouting(unstableChains = [], depStability = {}) {
    const recs = [];

    for (const chain of unstableChains) {
        recs.push({
            type:        "dep_rerouting",
            planId:      chain.planId,
            message:     `Plan "${chain.planId}" depends on ${chain.unstableDeps.length} unstable dep(s) — reroute or stub degraded dependencies`,
            unstableDeps: chain.unstableDeps,
            avgStability: chain.avgStability,
            priority:    chain.avgStability < 0.4 ? "high" : "medium",
        });
    }

    // Also flag globally degraded deps
    for (const [depId, v] of Object.entries(depStability)) {
        if ((v.stability ?? 1.0) < 0.3) {
            recs.push({
                type:      "dep_rerouting",
                depId,
                message:   `Dependency "${depId}" has ${(v.stability * 100).toFixed(0)}% stability — consider removing from critical paths`,
                stability: v.stability,
                priority:  "high",
            });
        }
    }

    return recs;
}

function suggestOverloadPrevention(balancerStatus = {}, rebalanceActions = []) {
    const recs = [];

    for (const action of rebalanceActions) {
        const messages = {
            reduce_concurrency: "Reduce max concurrency to relieve heap pressure",
            delay_non_critical: "Delay non-critical tasks to lower CPU pressure",
            throttle_spawning:  "Throttle process spawning — active process count too high",
            drain_queue:        "Drain low-priority queue entries to relieve queue congestion",
            reduce_retries:     "Reduce retry budgets globally — retry storm detected",
        };
        recs.push({
            type:     "overload_prevention",
            action:   action.action,
            message:  messages[action.action] ?? `Take action: ${action.action}`,
            reason:   action.reason,
            severity: action.severity,
            priority: action.severity === "high" ? "high" : "medium",
        });
    }

    return recs;
}

// ── generate ─────────────────────────────────────────────────────────

function generate(context = {}) {
    const {
        queue             = [],
        history           = [],
        resourceStatus    = {},
        openBreakers      = [],
        quarantined       = [],
        anomalies         = [],
        unstableChains    = [],
        depStability      = {},
        rebalanceActions  = [],
    } = context;

    const all = [
        ...suggestQueueOptimization(queue, history),
        ...suggestConcurrencyTuning(resourceStatus),
        ...suggestIsolation(openBreakers, quarantined, anomalies),
        ...suggestDepRerouting(unstableChains, depStability),
        ...suggestOverloadPrevention(resourceStatus, rebalanceActions),
    ];

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
    suggestQueueOptimization, suggestConcurrencyTuning, suggestIsolation,
    suggestDepRerouting, suggestOverloadPrevention, generate,
};
