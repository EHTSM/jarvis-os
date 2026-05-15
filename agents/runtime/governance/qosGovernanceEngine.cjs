"use strict";
/**
 * qosGovernanceEngine — quality-of-service enforcement, workflow execution
 * classes, latency-sensitive routing, recovery QoS prioritization.
 *
 * assignQoSClass(spec)             → { assigned, assignId, workflowId, qosClass }
 * enforceQoSPolicy(spec)           → { enforced, workflowId, compliant, violations }
 * calculateQoSPressure(qosClass)   → { found, qosClass, pressure }
 * getQoSMetrics()                  → QoSMetrics
 * reset()
 *
 * QoS classes: critical, high, standard, background, recovery
 */

const QOS_CLASSES = ["critical", "high", "standard", "background", "recovery"];

const QOS_PRIORITIES = {
    critical:   10,
    high:        8,
    standard:    5,
    background:  2,
    recovery:    9,
};

let _assignments = new Map();   // workflowId → AssignmentRecord
let _violations  = [];
let _counter     = 0;

// ── assignQoSClass ────────────────────────────────────────────────────

function assignQoSClass(spec = {}) {
    const {
        workflowId       = null,
        qosClass         = "standard",
        latencySensitive = false,
        recoveryMode     = false,
        systemPriority   = null,
    } = spec;

    if (!workflowId) return { assigned: false, reason: "workflowId_required" };

    let effectiveClass = qosClass;
    if (recoveryMode && qosClass === "standard") effectiveClass = "recovery";

    if (!QOS_CLASSES.includes(effectiveClass))
        return { assigned: false, reason: `invalid_qos_class: ${effectiveClass}` };

    const assignId = `qos-${++_counter}`;
    _assignments.set(workflowId, {
        assignId,
        workflowId,
        qosClass:          effectiveClass,
        originalClass:     qosClass,
        latencySensitive,
        recoveryMode,
        effectivePriority: systemPriority ?? QOS_PRIORITIES[effectiveClass],
        escalated:         false,
        assignedAt:        new Date().toISOString(),
    });

    return { assigned: true, assignId, workflowId, qosClass: effectiveClass };
}

// ── enforceQoSPolicy ──────────────────────────────────────────────────

function enforceQoSPolicy(spec = {}) {
    const { workflowId = null, actualLatencyMs = null, maxLatencyMs = null } = spec;
    if (!workflowId) return { enforced: false, reason: "workflowId_required" };

    const rec = _assignments.get(workflowId);
    if (!rec) return { enforced: false, reason: "assignment_not_found" };

    const violations = [];
    if (actualLatencyMs != null && maxLatencyMs != null && actualLatencyMs > maxLatencyMs) {
        violations.push({ type: "latency_exceeded", actual: actualLatencyMs, max: maxLatencyMs });
        _violations.push({ workflowId, type: "latency_exceeded",
                           actual: actualLatencyMs, max: maxLatencyMs,
                           qosClass: rec.qosClass, ts: new Date().toISOString() });
    }

    return {
        enforced:   true,
        workflowId,
        qosClass:   rec.qosClass,
        compliant:  violations.length === 0,
        violations,
    };
}

// ── calculateQoSPressure ──────────────────────────────────────────────

function calculateQoSPressure(qosClass) {
    if (!QOS_CLASSES.includes(qosClass)) return { found: false, qosClass };

    const classWorkflows = [..._assignments.values()].filter(a => a.qosClass === qosClass);
    const count          = classWorkflows.length;
    const violated       = _violations.filter(v => {
        const r = _assignments.get(v.workflowId);
        return r && r.qosClass === qosClass;
    }).length;

    const pressure = count === 0       ? "none"
                   : violated >= count * 0.5 ? "critical"
                   : violated >= count * 0.2 ? "high"
                   :                           "low";

    return { found: true, qosClass, workflowCount: count, violations: violated, pressure };
}

// ── getQoSMetrics ─────────────────────────────────────────────────────

function getQoSMetrics() {
    const byClass = {};
    for (const c of QOS_CLASSES) byClass[c] = 0;
    for (const rec of _assignments.values()) byClass[rec.qosClass]++;

    return {
        totalAssignments: _assignments.size,
        byClass,
        totalViolations:  _violations.length,
        escalatedCount:   [..._assignments.values()].filter(r => r.escalated).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _assignments = new Map();
    _violations  = [];
    _counter     = 0;
}

module.exports = {
    QOS_CLASSES, QOS_PRIORITIES,
    assignQoSClass, enforceQoSPolicy, calculateQoSPressure,
    getQoSMetrics, reset,
};
