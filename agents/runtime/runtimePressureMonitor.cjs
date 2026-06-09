"use strict";
/**
 * Phase 408 + 410 — Operational Priority Engine + Runtime Pressure Monitor
 *
 * Phase 408: Priority levels for execution requests.
 * Phase 410: Tracks retry pressure, queue congestion, adapter instability,
 *            execution frequency. Computes a single pressure score (0–100).
 *
 * Pressure score drives adaptive throttling:
 *   0–30:  nominal    — full throughput
 *   31–60: elevated   — reduce chain concurrency
 *   61–80: high       — block new low-priority work
 *   81–100: critical  — block all except emergency recovery
 *
 * Priority levels (Phase 408):
 *   0: EMERGENCY    — override all throttling
 *   1: CRITICAL     — recovery operations
 *   2: HIGH         — operator-requested dispatch
 *   3: NORMAL       — standard execution
 *   4: LOW          — background maintenance
 */

const logger = require("../../backend/utils/logger");

const PRIORITY = { EMERGENCY: 0, CRITICAL: 1, HIGH: 2, NORMAL: 3, LOW: 4 };

// ── Pressure tracking ─────────────────────────────────────────────────────────
const WINDOW_MS   = 60_000;
const MAX_SAMPLES = 500;

const _samples = {
    retries:      [],   // { ts } — retry events
    failures:     [],   // { ts } — dispatch failures
    workflows:    [],   // { ts } — workflow starts
    recoveries:   [],   // { ts, success: bool } — recovery attempts
    adapterFaults:[],   // { ts, adapter } — adapter errors
};

let _adapterInstabilityCount = 0;  // incremented by adapter fault reports

function _clean() {
    const cutoff = Date.now() - WINDOW_MS;
    for (const key of Object.keys(_samples)) {
        _samples[key] = _samples[key].filter(e => e.ts > cutoff).slice(-MAX_SAMPLES);
    }
}

// ── Pressure computation ──────────────────────────────────────────────────────
function computePressure() {
    _clean();
    const retryRate    = _samples.retries.length;         // retries in last 60s
    const failureRate  = _samples.failures.length;        // failures in last 60s
    const workflowRate = _samples.workflows.length;       // workflow starts in last 60s
    const adapterFaults= _samples.adapterFaults.length;   // adapter errors in last 60s
    const recoveryStorms = _samples.recoveries.filter(r => !r.success).length; // failed recoveries

    // Score components (each 0–20)
    const retryScore    = Math.min(20, retryRate    * 4);
    const failScore     = Math.min(20, failureRate  * 3);
    const wfScore       = Math.min(10, workflowRate * 1);
    const adapterScore  = Math.min(20, adapterFaults * 5);
    const recovScore    = Math.min(20, recoveryStorms * 5);
    // Memory pressure from orchestrator
    let memScore = 0;
    try {
        const heapMb = process.memoryUsage().heapUsed / 1_048_576;
        if (heapMb > 400) memScore = 10;
        else if (heapMb > 300) memScore = 5;
    } catch {}

    const score = Math.min(100, retryScore + failScore + wfScore + adapterScore + recovScore + memScore);
    const level =
        score <= 30 ? "nominal" :
        score <= 60 ? "elevated" :
        score <= 80 ? "high"     : "critical";

    return { score, level, components: { retryScore, failScore, wfScore, adapterScore, recovScore, memScore },
             rates: { retryRate, failureRate, workflowRate, adapterFaults, recoveryStorms } };
}

// ── Priority gate ─────────────────────────────────────────────────────────────
/**
 * Determine if a request at a given priority level is allowed to execute
 * under current pressure.
 * @param {number} priority — PRIORITY.*
 * @returns {{ allowed: bool, reason: string, pressure: object }}
 */
function priorityGate(priority = PRIORITY.NORMAL) {
    const pressure = computePressure();
    const level    = pressure.level;

    // EMERGENCY and CRITICAL always pass
    if (priority <= PRIORITY.CRITICAL) {
        return { allowed: true, reason: "priority_override", pressure };
    }
    // HIGH passes unless critical pressure
    if (priority === PRIORITY.HIGH && level !== "critical") {
        return { allowed: true, reason: "high_priority_pass", pressure };
    }
    // NORMAL blocked at high+ pressure
    if (priority === PRIORITY.NORMAL && (level === "high" || level === "critical")) {
        logger.warn(`[Pressure] NORMAL priority blocked — pressure=${pressure.score} level=${level}`);
        return { allowed: false, reason: `pressure_${level}`, pressure };
    }
    // LOW blocked at elevated+ pressure
    if (priority === PRIORITY.LOW && level !== "nominal") {
        return { allowed: false, reason: `pressure_${level}_blocks_low`, pressure };
    }
    return { allowed: true, reason: "within_pressure_limit", pressure };
}

// ── Record events ─────────────────────────────────────────────────────────────
function recordRetry()                     { _samples.retries.push({ ts: Date.now() }); }
function recordFailure()                   { _samples.failures.push({ ts: Date.now() }); }
function recordWorkflowStart()             { _samples.workflows.push({ ts: Date.now() }); }
function recordRecovery(success)           { _samples.recoveries.push({ ts: Date.now(), success }); }
function recordAdapterFault(adapter = "") {
    _samples.adapterFaults.push({ ts: Date.now(), adapter });
    _adapterInstabilityCount++;
}

/** Full diagnostic snapshot */
function snapshot() {
    const p = computePressure();
    return { ...p, adapterInstabilityTotal: _adapterInstabilityCount };
}

module.exports = {
    PRIORITY,
    computePressure, priorityGate, snapshot,
    recordRetry, recordFailure, recordWorkflowStart, recordRecovery, recordAdapterFault,
};
