"use strict";
/**
 * executionAnalytics — aggregate statistics from execution memory.
 *
 * compute(entries)   → AnalyticsReport
 * summary(report)    → one-line string
 * byFingerprint(entries) → Map<fingerprint, AnalyticsReport>
 *
 * AnalyticsReport:
 *   totalExecutions, successRate, avgRetries, rollbackFrequency,
 *   recoveryEffectiveness, workflowStability, avgDurationMs, topStrategies[]
 */

function compute(entries = []) {
    const total = entries.length;
    if (total === 0) {
        return {
            totalExecutions:       0,
            successRate:           0,
            avgRetries:            0,
            rollbackFrequency:     0,
            recoveryEffectiveness: 1.0,
            workflowStability:     0,
            avgDurationMs:         0,
            topStrategies:         [],
        };
    }

    const successes     = entries.filter(e => e.success);
    const withRetries   = entries.filter(e => (e.retryCount ?? 0) > 0);
    const withRollback  = entries.filter(e => e.rollbackTriggered);
    const cleanRuns     = entries.filter(e => e.success && (e.retryCount ?? 0) === 0 && !e.rollbackTriggered);
    const durEntries    = entries.filter(e => e.durationMs != null);

    const successRate   = successes.length / total;
    const avgRetries    = withRetries.length === 0 ? 0
        : withRetries.reduce((s, e) => s + (e.retryCount ?? 0), 0) / withRetries.length;
    const rollbackFrequency = withRollback.length / total;

    // Recovery effectiveness: fraction of rollback events that ended successfully or rolled_back cleanly
    const recoveryEffectiveness = withRollback.length === 0 ? 1.0
        : withRollback.filter(e => e.success || e.state === "rolled_back" || e.state === "completed").length
          / withRollback.length;

    const workflowStability = cleanRuns.length / total;
    const avgDurationMs     = durEntries.length === 0 ? 0
        : Math.round(durEntries.reduce((s, e) => s + e.durationMs, 0) / durEntries.length);

    // Top strategies
    const strats = {};
    for (const e of entries) { const s = e.strategy ?? "unknown"; strats[s] = (strats[s] ?? 0) + 1; }
    const topStrategies = Object.entries(strats)
        .sort((a, b) => b[1] - a[1])
        .map(([strategy, count]) => ({ strategy, count }));

    return {
        totalExecutions:       total,
        successRate:           Math.round(successRate           * 1000) / 1000,
        avgRetries:            Math.round(avgRetries            * 100)  / 100,
        rollbackFrequency:     Math.round(rollbackFrequency     * 1000) / 1000,
        recoveryEffectiveness: Math.round(recoveryEffectiveness * 1000) / 1000,
        workflowStability:     Math.round(workflowStability     * 1000) / 1000,
        avgDurationMs,
        topStrategies,
    };
}

function summary(report) {
    const pct = n => (n * 100).toFixed(0) + "%";
    return [
        `total=${report.totalExecutions}`,
        `success=${pct(report.successRate)}`,
        `retries=${report.avgRetries}`,
        `rollbacks=${pct(report.rollbackFrequency)}`,
        `stability=${pct(report.workflowStability)}`,
    ].join(" ");
}

function byFingerprint(entries = []) {
    const groups = new Map();
    for (const e of entries) {
        const fp = e.fingerprint ?? "__unknown__";
        if (!groups.has(fp)) groups.set(fp, []);
        groups.get(fp).push(e);
    }
    const result = new Map();
    for (const [fp, group] of groups) result.set(fp, compute(group));
    return result;
}

module.exports = { compute, summary, byFingerprint };
