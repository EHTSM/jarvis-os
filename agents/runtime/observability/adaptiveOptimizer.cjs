"use strict";
/**
 * adaptiveOptimizer — tunes the runtime based on observed bottlenecks.
 *
 * optimize(context) → OptimizationResult
 *   context: { entries, depStability, bottlenecks, currentPolicies? }
 */

const STRATEGY_DOWNGRADE = {
    fast:           "safe",
    safe:           "staged",
    staged:         "recovery_first",
    recovery_first: "sandbox",
    sandbox:        "sandbox",   // floor
    dry_run:        "dry_run",
};

// ── optimizeRetryPolicy ───────────────────────────────────────────────

function optimizeRetryPolicy(fingerprint, entries = [], currentPolicy = {}) {
    const fpEntries = entries.filter(e => e.fingerprint === fingerprint);
    if (fpEntries.length === 0) return { ...currentPolicy, adjusted: false };

    const avgRetries = fpEntries.reduce((s, e) => s + (e.retryCount ?? 0), 0) / fpEntries.length;
    const successRate = fpEntries.filter(e => e.success).length / fpEntries.length;

    let maxRetries = currentPolicy.maxRetries ?? 3;
    let adjusted   = false;

    // Reduce retries on unstable paths
    if (avgRetries > 3 && successRate < 0.5) {
        maxRetries = Math.max(1, maxRetries - 2);
        adjusted   = true;
    } else if (avgRetries > 2) {
        maxRetries = Math.max(1, maxRetries - 1);
        adjusted   = true;
    }

    return { ...currentPolicy, maxRetries, adjusted, reason: adjusted ? "retry_reduction" : null };
}

// ── prioritizeWorkflows ───────────────────────────────────────────────

function prioritizeWorkflows(fingerprints = [], entries = []) {
    return fingerprints
        .map(fp => {
            const group       = entries.filter(e => e.fingerprint === fp);
            const successRate = group.length > 0
                ? group.filter(e => e.success).length / group.length
                : 0.5;
            const avgDuration = group.length > 0
                ? group.reduce((s, e) => s + (e.durationMs ?? 0), 0) / group.length
                : 0;
            return { fingerprint: fp, successRate, avgDurationMs: avgDuration, priority: successRate };
        })
        .sort((a, b) => b.priority - a.priority);
}

// ── downgradeStrategy ─────────────────────────────────────────────────

function downgradeStrategy(currentStrategy, bottlenecks = {}) {
    const hasRollbackZones   = (bottlenecks.rollbackZones   ?? []).length > 0;
    const hasUnstableTools   = (bottlenecks.unstableTools   ?? []).length > 0;
    const hasRetryHeavy      = (bottlenecks.retryHeavySteps ?? []).length > 0;
    const hasMemoryPressure  = (bottlenecks.memoryPressure  ?? []).length > 0;

    const shouldDowngrade = hasRollbackZones || hasUnstableTools || hasRetryHeavy || hasMemoryPressure;
    if (!shouldDowngrade) return { strategy: currentStrategy, downgraded: false };

    const next = STRATEGY_DOWNGRADE[currentStrategy] ?? "safe";
    return {
        strategy:   next,
        downgraded: next !== currentStrategy,
        from:       currentStrategy,
        reasons:    [
            hasRollbackZones  && "rollback_zones",
            hasUnstableTools  && "unstable_tools",
            hasRetryHeavy     && "retry_heavy",
            hasMemoryPressure && "memory_pressure",
        ].filter(Boolean),
    };
}

// ── tuneRetryBudget ───────────────────────────────────────────────────

function tuneRetryBudget(classification, bottlenecks = {}) {
    const BASE = { safe: 3, elevated: 2, dangerous: 1, destructive: 0 };
    let budget = BASE[classification] ?? 2;
    const adjustments = [];

    if ((bottlenecks.retryHeavySteps ?? []).length > 0) {
        budget = Math.max(0, budget - 1);
        adjustments.push("reduced_for_retry_heavy");
    }
    if ((bottlenecks.rollbackZones ?? []).length > 0) {
        budget = Math.max(0, budget - 1);
        adjustments.push("reduced_for_rollback_zones");
    }

    return { retryBudget: budget, adjustments };
}

// ── optimize ─────────────────────────────────────────────────────────

function optimize(context = {}) {
    const { entries = [], depStability = {}, bottlenecks = {}, currentPolicies = {} } = context;

    const uniqueFps  = [...new Set(entries.map(e => e.fingerprint).filter(Boolean))];
    const retryPolices = uniqueFps.map(fp =>
        ({ fingerprint: fp, ...optimizeRetryPolicy(fp, entries, currentPolicies[fp] ?? {}) })
    );

    const prioritized = prioritizeWorkflows(uniqueFps, entries);

    const currentStrategy = context.currentStrategy ?? "safe";
    const strategyResult  = downgradeStrategy(currentStrategy, bottlenecks);

    const classification  = context.classification ?? "safe";
    const budgetResult    = tuneRetryBudget(classification, bottlenecks);

    // Recommend safer modes for fingerprints with high rollback or low success
    const saferModeRecs = uniqueFps
        .map(fp => {
            const group = entries.filter(e => e.fingerprint === fp);
            if (group.length < 2) return null;
            const successRate = group.filter(e => e.success).length / group.length;
            const rollbackRate = group.filter(e => e.rollbackTriggered).length / group.length;
            if (successRate < 0.5 || rollbackRate > 0.3) {
                return { fingerprint: fp, recommendedMode: "sandbox", successRate, rollbackRate };
            }
            return null;
        })
        .filter(Boolean);

    return {
        retryPolicies:     retryPolices,
        prioritizedWorkflows: prioritized,
        strategyDowngrade: strategyResult,
        retryBudget:       budgetResult,
        saferModeRecs,
    };
}

module.exports = {
    optimizeRetryPolicy, prioritizeWorkflows, downgradeStrategy,
    tuneRetryBudget, optimize,
};
