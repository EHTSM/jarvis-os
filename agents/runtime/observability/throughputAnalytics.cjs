"use strict";
/**
 * throughputAnalytics — workflow operational analytics.
 *
 * compute(entries, opts) → ThroughputReport
 */

// ── individual calculators ────────────────────────────────────────────

function calcSuccessRatio(entries = []) {
    if (entries.length === 0) return { success: 0, failure: 0, ratio: 0, total: 0 };
    const success = entries.filter(e => e.success).length;
    const failure = entries.length - success;
    return { success, failure, ratio: success / entries.length, total: entries.length };
}

function calcAverageRecoveryCost(entries = []) {
    // Recovery cost = retryCount * backoff proxy (100ms) + rollback overhead (200ms each)
    const RETRY_COST_MS    = 100;
    const ROLLBACK_COST_MS = 200;
    if (entries.length === 0) return { avgCostMs: 0, totalCostMs: 0 };
    const costs = entries.map(e =>
        (e.retryCount ?? 0) * RETRY_COST_MS
        + (e.rollbackTriggered ? ROLLBACK_COST_MS : 0)
    );
    const total = costs.reduce((s, c) => s + c, 0);
    return { avgCostMs: total / entries.length, totalCostMs: total };
}

function calcVerificationPassRate(entries = []) {
    // Proxy: success without rollback = verification passed
    if (entries.length === 0) return { passRate: 0, passed: 0, total: 0 };
    const passed = entries.filter(e => e.success && !e.rollbackTriggered).length;
    return { passRate: passed / entries.length, passed, total: entries.length };
}

function calcSandboxUsage(entries = []) {
    if (entries.length === 0) return { usageRate: 0, sandboxed: 0, total: 0 };
    const sandboxed = entries.filter(e =>
        e.strategy === "sandbox" || e.sandboxed
    ).length;
    return { usageRate: sandboxed / entries.length, sandboxed, total: entries.length };
}

function calcGovernanceBlockRate(entries = []) {
    if (entries.length === 0) return { blockRate: 0, blocked: 0, total: 0 };
    const blocked = entries.filter(e => e.governed || e.state === "governance_blocked").length;
    return { blockRate: blocked / entries.length, blocked, total: entries.length };
}

// ── compute ───────────────────────────────────────────────────────────

function compute(entries = [], opts = {}) {
    return {
        successRatio:         calcSuccessRatio(entries),
        averageRecoveryCost:  calcAverageRecoveryCost(entries),
        verificationPassRate: calcVerificationPassRate(entries),
        sandboxUsage:         calcSandboxUsage(entries),
        governanceBlockRate:  calcGovernanceBlockRate(entries),
        totalEntries:         entries.length,
        ts:                   new Date().toISOString(),
    };
}

module.exports = {
    calcSuccessRatio, calcAverageRecoveryCost, calcVerificationPassRate,
    calcSandboxUsage, calcGovernanceBlockRate, compute,
};
