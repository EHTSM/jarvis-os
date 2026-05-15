"use strict";
/**
 * adapterHealthMonitor — sliding-window health tracking for all adapters.
 *
 * recordExecutionOutcome(spec)   → { recorded, healthId, adapterType, health }
 * getAdapterHealth(adapterType)  → AdapterHealth
 * getAllAdapterHealth()           → AdapterHealth[]
 * setAdapterQuarantine(spec)     → { quarantined, adapterType }
 * getHealthMetrics()             → HealthMetrics
 * reset()
 *
 * Health is computed from a sliding window of the last HEALTH_WINDOW outcomes.
 * errorRate ≥ 0.5 → critical; ≥ 0.2 → degraded; else → healthy.
 * Quarantine is terminal: quarantined adapters cannot return to healthy.
 */

const HEALTH_WINDOW = 20;
const HEALTH_THRESHOLDS = { critical: 0.5, degraded: 0.2 };

let _records = new Map();   // adapterType → { outcomes: string[], quarantined: bool }
let _counter = 0;

function _ensure(adapterType) {
    if (!_records.has(adapterType)) {
        _records.set(adapterType, { outcomes: [], quarantined: false, quarantinedAt: null });
    }
    return _records.get(adapterType);
}

function _computeHealth(rec) {
    if (rec.quarantined) return "quarantined";
    const win       = rec.outcomes.slice(-HEALTH_WINDOW);
    if (win.length === 0) return "healthy";
    const errorRate = win.filter(o => o === "error").length / win.length;
    if (errorRate >= HEALTH_THRESHOLDS.critical) return "critical";
    if (errorRate >= HEALTH_THRESHOLDS.degraded) return "degraded";
    return "healthy";
}

// ── recordExecutionOutcome ────────────────────────────────────────────

function recordExecutionOutcome(spec = {}) {
    const {
        adapterType = null,
        outcome     = null,    // "ok" | "error" | "timeout" | "rejected"
        executionId = null,
        workflowId  = null,
    } = spec;

    if (!adapterType) return { recorded: false, reason: "adapterType_required" };
    if (!outcome)     return { recorded: false, reason: "outcome_required" };

    const rec    = _ensure(adapterType);
    const normalized = (outcome === "ok") ? "ok" : "error";
    rec.outcomes.push(normalized);

    const healthId = `health-${++_counter}`;
    return {
        recorded: true, healthId, adapterType,
        outcome, health: _computeHealth(rec),
        executionId, workflowId,
    };
}

// ── getAdapterHealth ──────────────────────────────────────────────────

function getAdapterHealth(adapterType) {
    if (!adapterType) return { found: false, reason: "adapterType_required" };
    const rec = _records.get(adapterType);
    if (!rec) return { found: false, adapterType, health: "unknown" };

    const win       = rec.outcomes.slice(-HEALTH_WINDOW);
    const errorRate = win.length > 0
        ? win.filter(o => o === "error").length / win.length
        : 0;

    return {
        found: true, adapterType,
        health:        _computeHealth(rec),
        errorRate:     Math.round(errorRate * 1000) / 1000,
        totalRecorded: rec.outcomes.length,
        quarantined:   rec.quarantined,
    };
}

// ── getAllAdapterHealth ────────────────────────────────────────────────

function getAllAdapterHealth() {
    return [..._records.entries()].map(([adapterType, rec]) => {
        const win       = rec.outcomes.slice(-HEALTH_WINDOW);
        const errorRate = win.length > 0
            ? win.filter(o => o === "error").length / win.length
            : 0;
        return {
            adapterType,
            health:        _computeHealth(rec),
            errorRate:     Math.round(errorRate * 1000) / 1000,
            totalRecorded: rec.outcomes.length,
            quarantined:   rec.quarantined,
        };
    });
}

// ── setAdapterQuarantine ──────────────────────────────────────────────

function setAdapterQuarantine(spec = {}) {
    const { adapterType = null, quarantined = true } = spec;
    if (!adapterType) return { quarantined: false, reason: "adapterType_required" };

    const rec = _ensure(adapterType);
    rec.quarantined   = quarantined;
    rec.quarantinedAt = quarantined ? new Date().toISOString() : null;

    return { quarantined, adapterType };
}

// ── getHealthMetrics ──────────────────────────────────────────────────

function getHealthMetrics() {
    const all     = getAllAdapterHealth();
    const byHealth = { healthy: 0, degraded: 0, critical: 0, quarantined: 0 };
    for (const a of all) byHealth[a.health] = (byHealth[a.health] ?? 0) + 1;

    return {
        totalAdapters:       all.length,
        byHealth,
        healthyAdapters:     byHealth.healthy,
        degradedAdapters:    byHealth.degraded,
        criticalAdapters:    byHealth.critical,
        quarantinedAdapters: byHealth.quarantined,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _records = new Map();
    _counter = 0;
}

module.exports = {
    HEALTH_WINDOW, HEALTH_THRESHOLDS,
    recordExecutionOutcome, getAdapterHealth, getAllAdapterHealth,
    setAdapterQuarantine, getHealthMetrics, reset,
};
