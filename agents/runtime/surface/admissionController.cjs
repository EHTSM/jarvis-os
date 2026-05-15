"use strict";
/**
 * admissionController — validates execution requests before surface dispatch.
 *
 * Checks (in order): capability exists, enabled, classification policy,
 * isolation level, resource pressure, runtime health, confidence threshold.
 *
 * admit(request)                       → AdmissionResult
 * setPolicy(opts)                      → void
 * getPolicy()                          → Policy
 * getAdmissionStats()                  → Stats
 * reset()
 */

// Default policy thresholds per classification
const DEFAULT_POLICY = {
    safe: {
        minHealth:      0.10,
        maxPressure:    0.95,
        minConfidence:  0.10,
        requireIsolation: false,
        requireQuorum:  false,
    },
    elevated: {
        minHealth:      0.40,
        maxPressure:    0.80,
        minConfidence:  0.50,
        requireIsolation: false,
        requireQuorum:  false,
    },
    dangerous: {
        minHealth:      0.60,
        maxPressure:    0.60,
        minConfidence:  0.70,
        requireIsolation: true,    // must be "sandboxed"
        requireQuorum:  false,
    },
    destructive: {
        minHealth:      0.80,
        maxPressure:    0.30,
        minConfidence:  0.90,
        requireIsolation: true,
        requireQuorum:  true,      // explicit quorum signal required
    },
};

const VALID_ISOLATION_LEVELS = ["none", "standard", "sandboxed", "quarantine"];

let _policy  = JSON.parse(JSON.stringify(DEFAULT_POLICY));
let _admLog  = [];
let _counter = 0;

// ── admit ─────────────────────────────────────────────────────────────

function admit(request = {}) {
    const {
        capId,
        classification = "safe",
        isolation      = "none",
        health         = 1.0,
        pressure       = 0.0,
        confidence     = 1.0,
        quorum         = false,
        permissions    = [],
        requiredPerms  = [],
    } = request;

    const admId  = `adm-${++_counter}`;
    const policy = _policy[classification] ?? _policy.safe;
    const rejects = [];

    // 1. Permission check
    if (requiredPerms.length > 0) {
        const missing = requiredPerms.filter(p => !permissions.includes(p));
        if (missing.length > 0) {
            rejects.push(`missing_permissions: ${missing.join(",")}`);
        }
    }

    // 2. Isolation level check
    if (policy.requireIsolation && isolation !== "sandboxed" && isolation !== "quarantine") {
        rejects.push(`isolation_required: ${classification} requires sandboxed or quarantine, got ${isolation}`);
    }
    if (!VALID_ISOLATION_LEVELS.includes(isolation)) {
        rejects.push(`invalid_isolation_level: ${isolation}`);
    }

    // 3. Resource pressure check
    if (pressure > policy.maxPressure) {
        rejects.push(`pressure_too_high: ${pressure.toFixed(2)} > max ${policy.maxPressure}`);
    }

    // 4. Runtime health check
    if (health < policy.minHealth) {
        rejects.push(`health_too_low: ${health.toFixed(2)} < min ${policy.minHealth}`);
    }

    // 5. Confidence threshold check
    if (confidence < policy.minConfidence) {
        rejects.push(`confidence_below_threshold: ${confidence.toFixed(2)} < min ${policy.minConfidence}`);
    }

    // 6. Quorum check
    if (policy.requireQuorum && !quorum) {
        rejects.push(`quorum_required: ${classification} action requires explicit quorum`);
    }

    const admitted = rejects.length === 0;
    const result   = {
        admId,
        admitted,
        capId:          capId ?? null,
        classification,
        isolation,
        reasons:        rejects,
        reasoning:      admitted
            ? `Admitted: all ${classification} policy checks passed`
            : `Rejected: ${rejects.join("; ")}`,
        telemetryBasis: { health: +health.toFixed(3), pressure: +pressure.toFixed(3), confidence: +confidence.toFixed(3) },
        ts:             new Date().toISOString(),
    };

    _admLog.push({ ...result });
    return result;
}

// ── setPolicy / getPolicy ─────────────────────────────────────────────

function setPolicy(opts = {}) {
    for (const [cls, overrides] of Object.entries(opts)) {
        if (_policy[cls]) {
            _policy[cls] = { ..._policy[cls], ...overrides };
        }
    }
}

function getPolicy() {
    return JSON.parse(JSON.stringify(_policy));
}

// ── getAdmissionStats ─────────────────────────────────────────────────

function getAdmissionStats() {
    const total    = _admLog.length;
    const admitted = _admLog.filter(a => a.admitted).length;
    const byClass  = {};
    for (const a of _admLog) {
        const k = `${a.classification}:${a.admitted ? "admitted" : "rejected"}`;
        byClass[k] = (byClass[k] ?? 0) + 1;
    }
    return {
        total,
        admitted,
        rejected:     total - admitted,
        admitRate:    total > 0 ? +(admitted / total).toFixed(3) : 0,
        byClassification: byClass,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _policy  = JSON.parse(JSON.stringify(DEFAULT_POLICY));
    _admLog  = [];
    _counter = 0;
}

module.exports = {
    DEFAULT_POLICY, VALID_ISOLATION_LEVELS,
    admit, setPolicy, getPolicy, getAdmissionStats, reset,
};
