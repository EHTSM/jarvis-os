"use strict";
/**
 * autonomousRecoveryCoordinator — orchestrates autonomous recovery actions,
 * escalation ladders, and recovery lifecycle management.
 *
 * triggerRecovery(spec)    → { triggered, recoveryId, workflowId, action }
 * escalateRecovery(spec)   → { escalated, escalationId, recoveryId, level }
 * resolveRecovery(spec)    → { resolved, recoveryId, resolution }
 * getRecoveryState()       → RecoveryState
 * getRecoveryMetrics()     → RecoveryMetrics
 * reset()
 *
 * Triggers:  bottleneck | starvation | crash | timeout | pressure | cascade
 * Actions:   isolate | failover | degrade | quarantine | restart | compensate | monitor
 * Levels:    L1 (auto) → L2 (degrade) → L3 (quarantine) → L4 (manual)
 */

const TRIGGER_ACTION_MAP = {
    bottleneck: { critical: "quarantine", high: "isolate", medium: "degrade",  low: "monitor"    },
    starvation: { critical: "compensate", high: "compensate", medium: "compensate", low: "monitor" },
    crash:      { critical: "restart",   high: "restart",  medium: "restart",  low: "restart"    },
    timeout:    { critical: "failover",  high: "failover", medium: "failover", low: "monitor"    },
    pressure:   { critical: "degrade",   high: "degrade",  medium: "monitor",  low: "monitor"    },
    cascade:    { critical: "quarantine", high: "isolate", medium: "degrade",  low: "monitor"    },
};

const ESCALATION_LEVELS = ["L1", "L2", "L3", "L4"];

let _recoveries  = new Map();   // recoveryId → RecoveryRecord
let _escalations = [];
let _counter     = 0;

// ── triggerRecovery ───────────────────────────────────────────────────

function triggerRecovery(spec = {}) {
    const {
        workflowId = null,
        trigger    = "pressure",
        severity   = "medium",
    } = spec;

    if (!workflowId) return { triggered: false, reason: "workflowId_required" };

    const validTriggers  = Object.keys(TRIGGER_ACTION_MAP);
    const validSeverities = ["low", "medium", "high", "critical"];
    if (!validTriggers.includes(trigger))
        return { triggered: false, reason: `invalid_trigger: ${trigger}` };
    if (!validSeverities.includes(severity))
        return { triggered: false, reason: `invalid_severity: ${severity}` };

    const action     = TRIGGER_ACTION_MAP[trigger][severity];
    const recoveryId = `recovery-${++_counter}`;

    _recoveries.set(recoveryId, {
        recoveryId,
        workflowId,
        trigger,
        severity,
        action,
        level:       "L1",
        status:      "active",
        escalations: 0,
        triggeredAt: new Date().toISOString(),
        resolvedAt:  null,
        resolution:  null,
    });

    return { triggered: true, recoveryId, workflowId, trigger, severity, action };
}

// ── escalateRecovery ──────────────────────────────────────────────────

function escalateRecovery(spec = {}) {
    const { recoveryId = null, reason = "unspecified" } = spec;
    if (!recoveryId) return { escalated: false, reason: "recoveryId_required" };

    const rec = _recoveries.get(recoveryId);
    if (!rec) return { escalated: false, reason: "recovery_not_found" };
    if (rec.status !== "active") return { escalated: false, reason: "recovery_not_active" };

    const currentIdx = ESCALATION_LEVELS.indexOf(rec.level);
    if (currentIdx >= ESCALATION_LEVELS.length - 1)
        return { escalated: false, reason: "already_at_max_escalation", level: rec.level };

    const oldLevel   = rec.level;
    rec.level        = ESCALATION_LEVELS[currentIdx + 1];
    rec.escalations += 1;

    const escalationId = `esc-${++_counter}`;
    _escalations.push({ escalationId, recoveryId, workflowId: rec.workflowId, oldLevel, newLevel: rec.level, reason, escalatedAt: new Date().toISOString() });

    return { escalated: true, escalationId, recoveryId, workflowId: rec.workflowId, oldLevel, level: rec.level };
}

// ── resolveRecovery ───────────────────────────────────────────────────

function resolveRecovery(spec = {}) {
    const { recoveryId = null, resolution = "healed" } = spec;
    if (!recoveryId) return { resolved: false, reason: "recoveryId_required" };

    const rec = _recoveries.get(recoveryId);
    if (!rec) return { resolved: false, reason: "recovery_not_found" };
    if (rec.status !== "active") return { resolved: false, reason: "recovery_already_resolved" };

    const validResolutions = ["healed", "quarantined", "failed", "manual", "timed_out"];
    if (!validResolutions.includes(resolution))
        return { resolved: false, reason: `invalid_resolution: ${resolution}` };

    rec.status     = "resolved";
    rec.resolution = resolution;
    rec.resolvedAt = new Date().toISOString();

    return { resolved: true, recoveryId, workflowId: rec.workflowId, resolution, level: rec.level };
}

// ── getRecoveryState ──────────────────────────────────────────────────

function getRecoveryState() {
    const all      = [..._recoveries.values()];
    const active   = all.filter(r => r.status === "active");
    const resolved = all.filter(r => r.status === "resolved");

    const byAction = {};
    for (const r of all) byAction[r.action] = (byAction[r.action] ?? 0) + 1;

    return {
        totalRecoveries:   all.length,
        activeRecoveries:  active.length,
        resolvedRecoveries: resolved.length,
        totalEscalations:  _escalations.length,
        byAction,
        activeIds:         active.map(r => r.recoveryId),
    };
}

// ── getRecoveryMetrics ────────────────────────────────────────────────

function getRecoveryMetrics() {
    const all      = [..._recoveries.values()];
    const resolved = all.filter(r => r.status === "resolved");
    const healed   = resolved.filter(r => r.resolution === "healed");

    const healRate = resolved.length > 0 ? +(healed.length / resolved.length).toFixed(3) : 0;
    const avgEscalations = all.length > 0
        ? +(all.reduce((s, r) => s + r.escalations, 0) / all.length).toFixed(2) : 0;

    return {
        totalRecoveries:    all.length,
        healedCount:        healed.length,
        healRate,
        avgEscalations,
        l4Count:            all.filter(r => r.level === "L4").length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _recoveries  = new Map();
    _escalations = [];
    _counter     = 0;
}

module.exports = {
    TRIGGER_ACTION_MAP, ESCALATION_LEVELS,
    triggerRecovery, escalateRecovery, resolveRecovery,
    getRecoveryState, getRecoveryMetrics, reset,
};
