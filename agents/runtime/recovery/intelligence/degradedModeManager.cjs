"use strict";
/**
 * degradedModeManager — degraded mode lifecycle management, capability
 * reduction scheduling, and degradation threshold evaluation.
 *
 * activateDegradedMode(spec)          → { activated, modeId, level, capabilities }
 * deactivateDegradedMode(spec)        → { deactivated, modeId }
 * evaluateDegradationThreshold(spec)  → { shouldDegrade, reason, recommendedLevel }
 * getDegradedModeState()              → DegradedModeState
 * getDegradationMetrics()             → DegradationMetrics
 * reset()
 *
 * Levels (most → least capable): minimal, reduced, partial, full
 * full = all non-essential capabilities disabled
 */

const DEGRADATION_LEVELS = ["minimal", "reduced", "partial", "full"];

const CAPABILITY_SETS = {
    minimal: ["core_execution", "critical_recovery", "safety_checks"],
    reduced: ["core_execution", "critical_recovery", "safety_checks", "basic_scheduling", "admission_control"],
    partial: ["core_execution", "critical_recovery", "safety_checks", "basic_scheduling",
              "admission_control", "qos_enforcement", "telemetry"],
    full:    ["core_execution", "critical_recovery", "safety_checks", "basic_scheduling",
              "admission_control", "qos_enforcement", "telemetry",
              "advanced_routing", "lineage_tracking", "pressure_analysis"],
};

const DISABLED_SETS = {
    minimal: ["basic_scheduling", "admission_control", "qos_enforcement", "telemetry", "advanced_routing", "lineage_tracking", "pressure_analysis"],
    reduced: ["qos_enforcement", "advanced_routing", "lineage_tracking", "pressure_analysis"],
    partial: ["advanced_routing", "lineage_tracking"],
    full:    [],
};

let _activeModes = new Map();   // modeId → ModeRecord
let _history     = [];
let _counter     = 0;

// ── activateDegradedMode ──────────────────────────────────────────────

function activateDegradedMode(spec = {}) {
    const { level = "partial", reason = "unspecified", domain = "global" } = spec;

    if (!DEGRADATION_LEVELS.includes(level))
        return { activated: false, reason: `invalid_level: ${level}` };

    const modeId = `mode-${++_counter}`;
    _activeModes.set(modeId, {
        modeId,
        level,
        domain,
        reason,
        capabilities: CAPABILITY_SETS[level],
        disabled:     DISABLED_SETS[level],
        activatedAt:  new Date().toISOString(),
        active:       true,
    });

    _history.push({ modeId, level, domain, event: "activated", ts: new Date().toISOString() });

    return {
        activated:    true,
        modeId,
        level,
        domain,
        capabilities: CAPABILITY_SETS[level],
        disabled:     DISABLED_SETS[level],
    };
}

// ── deactivateDegradedMode ────────────────────────────────────────────

function deactivateDegradedMode(spec = {}) {
    const { modeId = null } = spec;
    if (!modeId) return { deactivated: false, reason: "modeId_required" };

    const rec = _activeModes.get(modeId);
    if (!rec)       return { deactivated: false, reason: "mode_not_found" };
    if (!rec.active) return { deactivated: false, reason: "mode_already_inactive" };

    rec.active        = false;
    rec.deactivatedAt = new Date().toISOString();

    _history.push({ modeId, level: rec.level, domain: rec.domain, event: "deactivated", ts: new Date().toISOString() });

    return { deactivated: true, modeId, level: rec.level, domain: rec.domain };
}

// ── evaluateDegradationThreshold ──────────────────────────────────────

function evaluateDegradationThreshold(spec = {}) {
    const {
        pressureScore   = 0,
        bottleneckCount = 0,
        starvationCount = 0,
        errorRate       = 0,
    } = spec;

    const reasons = [];

    if (pressureScore   >= 0.9) reasons.push("critical_pressure");
    if (pressureScore   >= 0.7) reasons.push("high_pressure");
    if (bottleneckCount >= 5)   reasons.push("bottleneck_saturation");
    if (bottleneckCount >= 3)   reasons.push("multiple_bottlenecks");
    if (starvationCount >= 3)   reasons.push("starvation_chain");
    if (errorRate       >= 0.5) reasons.push("high_error_rate");
    if (errorRate       >= 0.3) reasons.push("elevated_error_rate");

    const shouldDegrade = reasons.length > 0;

    let recommendedLevel = "full";
    if (pressureScore >= 0.9 || bottleneckCount >= 5 || errorRate >= 0.5)
        recommendedLevel = "minimal";
    else if (pressureScore >= 0.7 || bottleneckCount >= 3 || starvationCount >= 3)
        recommendedLevel = "reduced";
    else if (errorRate >= 0.3)
        recommendedLevel = "partial";

    return {
        shouldDegrade,
        reasons,
        recommendedLevel: shouldDegrade ? recommendedLevel : null,
    };
}

// ── getDegradedModeState ──────────────────────────────────────────────

function getDegradedModeState() {
    const active = [..._activeModes.values()].filter(m => m.active);
    return {
        activeModeCount: active.length,
        activeModes:     active.map(m => ({ modeId: m.modeId, level: m.level, domain: m.domain })),
        totalActivations: _history.filter(h => h.event === "activated").length,
        isInDegradedMode: active.length > 0,
    };
}

// ── getDegradationMetrics ─────────────────────────────────────────────

function getDegradationMetrics() {
    const all = [..._activeModes.values()];
    const byLevel = {};
    for (const l of DEGRADATION_LEVELS) byLevel[l] = 0;
    for (const m of all) byLevel[m.level]++;

    return {
        totalModes:       all.length,
        currentlyActive:  all.filter(m => m.active).length,
        byLevel,
        activationCount:  _history.filter(h => h.event === "activated").length,
        deactivationCount: _history.filter(h => h.event === "deactivated").length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _activeModes = new Map();
    _history     = [];
    _counter     = 0;
}

module.exports = {
    DEGRADATION_LEVELS, CAPABILITY_SETS, DISABLED_SETS,
    activateDegradedMode, deactivateDegradedMode, evaluateDegradationThreshold,
    getDegradedModeState, getDegradationMetrics, reset,
};
