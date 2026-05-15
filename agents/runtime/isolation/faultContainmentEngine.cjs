"use strict";
/**
 * faultContainmentEngine — prevent cascading failures, escalate fault states,
 * quarantine unstable domains, and block orchestration of poisoned chains.
 *
 * reportFailure(domainId, failure)    → { reported, failureId, faultState }
 * evaluateFaultState(domainId)        → { evaluated, domainId, faultState, failureCount }
 * quarantineDomain(domainId, reason)  → { quarantined, domainId, reason }
 * releaseQuarantine(domainId)         → { released, domainId, faultState }
 * getFaultMap(filter)                 → FaultRecord[]
 * isQuarantined(domainId)             → boolean
 * reset()
 */

const FAULT_STATES = ["healthy", "degraded", "unstable", "quarantined", "terminated"];

// Failure counts that trigger each escalation step
const CONTAINMENT_THRESHOLDS = {
    degraded:    2,
    unstable:    4,
    quarantined: 6,
};

let _faults     = new Map();   // domainId → FaultRecord
let _quarantine = new Set();
let _counter    = 0;

function _getOrCreate(domainId) {
    if (!_faults.has(domainId)) {
        _faults.set(domainId, {
            domainId,
            faultState:    "healthy",
            failureCount:  0,
            failures:      [],
            quarantinedAt: null,
            releasedAt:    null,
            lastFailureAt: null,
        });
    }
    return _faults.get(domainId);
}

function reportFailure(domainId, failure = {}) {
    const record = _getOrCreate(domainId);
    if (record.faultState === "terminated")
        return { reported: false, reason: "domain_terminated" };

    const entry = {
        failureId: `fail-${++_counter}`,
        domainId,
        errorType: failure.errorType ?? "generic",
        message:   failure.message   ?? null,
        ts:        new Date().toISOString(),
    };

    record.failures.push(entry);
    record.failureCount++;
    record.lastFailureAt = entry.ts;

    evaluateFaultState(domainId);

    return { reported: true, failureId: entry.failureId, faultState: record.faultState };
}

function evaluateFaultState(domainId) {
    const record = _faults.get(domainId);
    if (!record) return { evaluated: false, reason: "no_fault_record" };
    if (record.faultState === "terminated")
        return { evaluated: true, faultState: "terminated", domainId };

    const n = record.failureCount;
    let newState = "healthy";
    if      (n >= CONTAINMENT_THRESHOLDS.quarantined) newState = "quarantined";
    else if (n >= CONTAINMENT_THRESHOLDS.unstable)    newState = "unstable";
    else if (n >= CONTAINMENT_THRESHOLDS.degraded)    newState = "degraded";

    // Once quarantined, stays quarantined until manually released
    if (record.faultState === "quarantined") newState = "quarantined";

    record.faultState = newState;
    if (newState === "quarantined") _quarantine.add(domainId);

    return { evaluated: true, domainId, faultState: newState, failureCount: n };
}

function quarantineDomain(domainId, reason = "manual") {
    const record = _getOrCreate(domainId);
    if (record.faultState === "terminated")
        return { quarantined: false, reason: "already_terminated" };

    record.faultState    = "quarantined";
    record.quarantinedAt = new Date().toISOString();
    _quarantine.add(domainId);
    return { quarantined: true, domainId, reason };
}

function releaseQuarantine(domainId) {
    const record = _faults.get(domainId);
    if (!record)
        return { released: false, reason: "no_fault_record" };
    if (record.faultState !== "quarantined")
        return { released: false, reason: "not_quarantined", faultState: record.faultState };

    record.faultState  = "degraded";
    record.releasedAt  = new Date().toISOString();
    _quarantine.delete(domainId);
    return { released: true, domainId, faultState: "degraded" };
}

function getFaultMap(filter = {}) {
    let records = [..._faults.values()];
    if (filter.faultState) records = records.filter(r => r.faultState === filter.faultState);
    if (filter.domainId)   records = records.filter(r => r.domainId   === filter.domainId);
    return records;
}

function isQuarantined(domainId) {
    return _quarantine.has(domainId);
}

function reset() {
    _faults     = new Map();
    _quarantine = new Set();
    _counter    = 0;
}

module.exports = {
    FAULT_STATES, CONTAINMENT_THRESHOLDS,
    reportFailure, evaluateFaultState, quarantineDomain, releaseQuarantine,
    getFaultMap, isQuarantined, reset,
};
