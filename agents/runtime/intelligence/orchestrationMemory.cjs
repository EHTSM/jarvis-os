"use strict";
/**
 * orchestrationMemory — execution history indexing and lineage reconstruction.
 *
 * recordExecution(entry)                        → RecordResult
 * getStrategyOutcomes(strategy)                 → StrategyOutcomes
 * getFingerprintHistory(fingerprint)            → FingerprintHistory
 * getRetryPatterns()                            → RetryPatterns
 * recordDegradation(event)                      → void
 * correlateIncident(incidentId, executionIds)   → CorrelationResult
 * reconstructLineage(executionId)               → Lineage
 * getMemoryStats()                              → MemoryStats
 * reset()
 */

let _executions      = new Map();   // executionId → entry
let _byStrategy      = new Map();   // strategy → entry[]
let _byFingerprint   = new Map();   // fingerprint → entry[]
let _degradations    = [];
let _incidents       = new Map();   // incidentId → { incidentId, executionIds[] }
let _counter         = 0;

// ── recordExecution ───────────────────────────────────────────────────

function recordExecution(entry = {}) {
    const id          = entry.executionId ?? `exec-${++_counter}`;
    const strategy    = entry.strategy    ?? "safe";
    const fingerprint = entry.fingerprint ?? "unknown";

    const record = {
        executionId:      id,
        strategy,
        fingerprint,
        success:          entry.success !== false,
        retryCount:       entry.retryCount   ?? 0,
        durationMs:       entry.durationMs   ?? 0,
        rollbackTriggered: entry.rollbackTriggered === true,
        parentId:         entry.parentId     ?? null,
        tenantId:         entry.tenantId     ?? null,
        ts:               entry.ts           ?? new Date().toISOString(),
    };

    _executions.set(id, record);

    if (!_byStrategy.has(strategy))    _byStrategy.set(strategy, []);
    if (!_byFingerprint.has(fingerprint)) _byFingerprint.set(fingerprint, []);
    _byStrategy.get(strategy).push(record);
    _byFingerprint.get(fingerprint).push(record);

    return { recorded: true, executionId: id };
}

// ── getStrategyOutcomes ───────────────────────────────────────────────

function getStrategyOutcomes(strategy) {
    const entries = _byStrategy.get(strategy) ?? [];
    if (entries.length === 0) return { strategy, count: 0, successRate: 0, avgRetries: 0, avgDurationMs: 0 };

    const successRate  = entries.filter(e => e.success).length / entries.length;
    const avgRetries   = entries.reduce((s, e) => s + e.retryCount,  0) / entries.length;
    const avgDurationMs = entries.reduce((s, e) => s + e.durationMs, 0) / entries.length;
    const rollbackRate = entries.filter(e => e.rollbackTriggered).length / entries.length;

    return {
        strategy,
        count:        entries.length,
        successRate:  +successRate.toFixed(3),
        avgRetries:   +avgRetries.toFixed(2),
        avgDurationMs: +avgDurationMs.toFixed(1),
        rollbackRate: +rollbackRate.toFixed(3),
    };
}

// ── getFingerprintHistory ─────────────────────────────────────────────

function getFingerprintHistory(fingerprint) {
    const entries = _byFingerprint.get(fingerprint) ?? [];
    if (entries.length === 0) return { fingerprint, count: 0, successRate: 0, strategies: [] };

    const successRate = entries.filter(e => e.success).length / entries.length;
    const strategies  = [...new Set(entries.map(e => e.strategy))];
    const lastEntry   = entries[entries.length - 1];

    return {
        fingerprint,
        count:       entries.length,
        successRate: +successRate.toFixed(3),
        strategies,
        lastStrategy: lastEntry.strategy,
        lastSuccess:  lastEntry.success,
        lastTs:       lastEntry.ts,
    };
}

// ── getRetryPatterns ──────────────────────────────────────────────────

function getRetryPatterns() {
    const all = [..._executions.values()];
    if (all.length === 0) return { avgRetries: 0, maxRetries: 0, highRetryRate: 0, patterns: [] };

    const withRetries = all.filter(e => e.retryCount > 0);
    const avgRetries  = all.reduce((s, e) => s + e.retryCount, 0) / all.length;
    const maxRetries  = Math.max(...all.map(e => e.retryCount));
    const highRetryRate = withRetries.length / all.length;

    // Group by fingerprint; flag fingerprints with high avg retries
    const fpRetries = new Map();
    for (const e of all) {
        if (!fpRetries.has(e.fingerprint)) fpRetries.set(e.fingerprint, []);
        fpRetries.get(e.fingerprint).push(e.retryCount);
    }

    const patterns = [];
    for (const [fp, retries] of fpRetries) {
        const avg = retries.reduce((s, r) => s + r, 0) / retries.length;
        if (avg > 1) patterns.push({ fingerprint: fp, avgRetries: +avg.toFixed(2), count: retries.length });
    }

    return {
        avgRetries:   +avgRetries.toFixed(2),
        maxRetries,
        highRetryRate: +highRetryRate.toFixed(3),
        patterns,
    };
}

// ── recordDegradation ─────────────────────────────────────────────────

function recordDegradation(event = {}) {
    _degradations.push({
        type:     event.type     ?? "unknown",
        severity: event.severity ?? "low",
        metric:   event.metric   ?? null,
        value:    event.value    ?? null,
        ts:       event.ts       ?? new Date().toISOString(),
    });
}

// ── correlateIncident ─────────────────────────────────────────────────

function correlateIncident(incidentId, executionIds = []) {
    const existing = _incidents.get(incidentId) ?? { incidentId, executionIds: [] };
    const merged   = [...new Set([...existing.executionIds, ...executionIds])];
    _incidents.set(incidentId, { incidentId, executionIds: merged });

    const correlated = merged.map(id => _executions.get(id)).filter(Boolean);
    return {
        incidentId,
        executionCount: merged.length,
        correlated:     correlated.length,
        failureRate:    correlated.length > 0
            ? +(correlated.filter(e => !e.success).length / correlated.length).toFixed(3)
            : 0,
    };
}

// ── reconstructLineage ────────────────────────────────────────────────

function reconstructLineage(executionId) {
    const root = _executions.get(executionId);
    if (!root) return { found: false, executionId };

    const chain = [root];
    let current = root;

    // Walk up to parents
    while (current.parentId) {
        const parent = _executions.get(current.parentId);
        if (!parent) break;
        chain.unshift(parent);
        current = parent;
    }

    // Find children
    const children = [..._executions.values()].filter(e => e.parentId === executionId);

    return {
        found:        true,
        executionId,
        depth:        chain.length,
        lineage:      chain.map(e => ({ executionId: e.executionId, strategy: e.strategy, success: e.success })),
        childCount:   children.length,
        rootId:       chain[0].executionId,
    };
}

// ── getMemoryStats ────────────────────────────────────────────────────

function getMemoryStats() {
    return {
        totalExecutions:   _executions.size,
        uniqueStrategies:  _byStrategy.size,
        uniqueFingerprints: _byFingerprint.size,
        degradationEvents: _degradations.length,
        incidents:         _incidents.size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions    = new Map();
    _byStrategy    = new Map();
    _byFingerprint = new Map();
    _degradations  = [];
    _incidents     = new Map();
    _counter       = 0;
}

module.exports = {
    recordExecution, getStrategyOutcomes, getFingerprintHistory,
    getRetryPatterns, recordDegradation, correlateIncident,
    reconstructLineage, getMemoryStats, reset,
};
