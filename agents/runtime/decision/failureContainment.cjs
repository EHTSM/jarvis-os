"use strict";
/**
 * failureContainment — cascading failure isolation and safety guardrails.
 *
 * registerGroup(groupId, members)              → void
 * reportFailure(workflowId, groupId)           → ContainmentCheck
 * triggerContainment(groupId, reason)          → ContainmentResult
 * releaseContainment(groupId)                  → void
 * checkSafetyGuardrail(action, context)        → GuardrailResult
 * getContainmentStats()                        → Stats
 * reset()
 */

// Failure rate thresholds that trigger containment
const CONTAINMENT_THRESHOLDS = {
    warn:     0.30,   // 30% failure rate → warn
    contain:  0.50,   // 50% failure rate → trigger containment
    isolate:  0.75,   // 75% failure rate → full isolation
};

// Safety guardrail rules: action → minimum conditions required
const GUARDRAIL_RULES = {
    halt_all:       { maxHealth: 0.20,  minPressure: 0.80, reason: "halt requires critical health and pressure" },
    mass_rollback:  { maxHealth: 0.40,  minPressure: 0.65, reason: "mass_rollback requires degraded conditions" },
    force_restart:  { requiresQuorum: true,                reason: "force_restart requires quorum confirmation" },
    sandbox_all:    { always: true,                        reason: "sandbox_all is always safe" },
    throttle:       { always: true,                        reason: "throttle is always safe" },
    reroute:        { always: true,                        reason: "reroute is always safe" },
};

let _groups     = new Map();   // groupId → { members, failures, total, status, containedAt }
let _guardrailLog = [];
let _counter    = 0;

// ── registerGroup ─────────────────────────────────────────────────────

function registerGroup(groupId, members = []) {
    _groups.set(groupId, {
        groupId,
        members:     [...members],
        failures:    0,
        total:       0,
        status:      "normal",   // normal | warned | contained | isolated
        containedAt: null,
    });
}

// ── reportFailure ─────────────────────────────────────────────────────

function reportFailure(workflowId, groupId) {
    if (!_groups.has(groupId)) {
        // Auto-create group with just this workflow
        registerGroup(groupId, [workflowId]);
    }

    const group = _groups.get(groupId);
    group.total++;
    group.failures++;

    const failureRate = group.failures / group.total;
    const reasons     = [];

    let triggered = false;
    let action    = null;

    if (failureRate >= CONTAINMENT_THRESHOLDS.isolate && group.status !== "isolated") {
        group.status = "isolated";
        triggered    = true;
        action       = "isolate";
        reasons.push(`failure_rate_${(failureRate * 100).toFixed(0)}%_exceeds_isolation_threshold`);
    } else if (failureRate >= CONTAINMENT_THRESHOLDS.contain && group.status === "normal") {
        group.status = "contained";
        triggered    = true;
        action       = "contain";
        reasons.push(`failure_rate_${(failureRate * 100).toFixed(0)}%_exceeds_containment_threshold`);
    } else if (failureRate >= CONTAINMENT_THRESHOLDS.warn && group.status === "normal") {
        group.status = "warned";
        reasons.push(`failure_rate_${(failureRate * 100).toFixed(0)}%_exceeds_warn_threshold`);
    }

    return {
        groupId,
        workflowId,
        failureRate:     +failureRate.toFixed(3),
        groupStatus:     group.status,
        containmentTriggered: triggered,
        action,
        reasoning:       reasons.length > 0 ? reasons.join("; ") : "failure_recorded_below_thresholds",
        telemetryBasis:  { failures: group.failures, total: group.total, memberCount: group.members.length },
        historicalEvidence: null,
        confidenceLevel: failureRate >= CONTAINMENT_THRESHOLDS.isolate ? "high" : "moderate",
    };
}

// ── triggerContainment ────────────────────────────────────────────────

function triggerContainment(groupId, reason = "manual") {
    const group = _groups.get(groupId);
    if (!group) return { contained: false, reason: "group_not_found" };

    const prevStatus = group.status;
    group.status     = "contained";
    group.containedAt = new Date().toISOString();
    const containId  = `cont-${++_counter}`;

    const failureRate = group.total > 0 ? group.failures / group.total : 0;

    return {
        contained:       true,
        containId,
        groupId,
        previousStatus:  prevStatus,
        memberCount:     group.members.length,
        triggerReason:   reason,
        actions:         ["halt_new_admissions", "drain_active_executions", "alert_supervisor"],
        reasoning:       `Group ${groupId} contained (${group.members.length} members); trigger=${reason}; failureRate=${(failureRate * 100).toFixed(0)}%`,
        telemetryBasis:  { failureRate: +failureRate.toFixed(3), memberCount: group.members.length },
        historicalEvidence: { priorContainments: [..._groups.values()].filter(g => g.containedAt).length },
        confidenceLevel: "high",
    };
}

// ── releaseContainment ────────────────────────────────────────────────

function releaseContainment(groupId) {
    const group = _groups.get(groupId);
    if (!group) return { released: false, reason: "group_not_found" };
    group.status      = "normal";
    group.failures    = 0;
    group.total       = 0;
    group.containedAt = null;
    return { released: true, groupId };
}

// ── checkSafetyGuardrail ──────────────────────────────────────────────

function checkSafetyGuardrail(action, context = {}) {
    const rule = GUARDRAIL_RULES[action];
    const logEntry = { action, context: { ...context }, ts: new Date().toISOString() };

    if (!rule) {
        // Unknown action → default block for safety
        const result = {
            allowed:         false,
            action,
            reason:          "unknown_action_blocked_by_default",
            reasoning:       `Action "${action}" is not in the safety rulebook; blocked by default`,
            telemetryBasis:  context,
            historicalEvidence: { priorBlocks: _guardrailLog.filter(l => !l.allowed).length },
            confidenceLevel: "high",
        };
        _guardrailLog.push({ ...logEntry, allowed: false });
        return result;
    }

    if (rule.always) {
        const result = {
            allowed:         true,
            action,
            reason:          "always_permitted",
            reasoning:       rule.reason,
            telemetryBasis:  context,
            historicalEvidence: null,
            confidenceLevel: "high",
        };
        _guardrailLog.push({ ...logEntry, allowed: true });
        return result;
    }

    const health   = context.health   ?? 1;
    const pressure = context.pressure ?? 0;
    const quorum   = context.quorum   ?? false;

    let allowed  = true;
    const blocks = [];

    if (rule.maxHealth != null && health > rule.maxHealth) {
        allowed = false;
        blocks.push(`health=${health.toFixed(2)}_above_max_${rule.maxHealth}`);
    }
    if (rule.minPressure != null && pressure < rule.minPressure) {
        allowed = false;
        blocks.push(`pressure=${pressure.toFixed(2)}_below_min_${rule.minPressure}`);
    }
    if (rule.requiresQuorum && !quorum) {
        allowed = false;
        blocks.push("quorum_not_established");
    }

    const result = {
        allowed,
        action,
        reason:          allowed ? "conditions_met" : blocks.join("; "),
        reasoning:       allowed
            ? `Action "${action}" permitted: ${rule.reason}`
            : `Action "${action}" blocked: ${blocks.join("; ")} — ${rule.reason}`,
        telemetryBasis:  { health: +health.toFixed(3), pressure: +pressure.toFixed(3) },
        historicalEvidence: { priorChecks: _guardrailLog.length },
        confidenceLevel: "high",
    };

    _guardrailLog.push({ ...logEntry, allowed });
    return result;
}

// ── getContainmentStats ───────────────────────────────────────────────

function getContainmentStats() {
    const groups = [..._groups.values()];
    const byStatus = {};
    for (const g of groups) byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
    return {
        totalGroups:     groups.length,
        byStatus,
        guardrailChecks: _guardrailLog.length,
        blockedActions:  _guardrailLog.filter(l => !l.allowed).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _groups       = new Map();
    _guardrailLog = [];
    _counter      = 0;
}

module.exports = {
    CONTAINMENT_THRESHOLDS, GUARDRAIL_RULES,
    registerGroup, reportFailure, triggerContainment, releaseContainment,
    checkSafetyGuardrail, getContainmentStats, reset,
};
