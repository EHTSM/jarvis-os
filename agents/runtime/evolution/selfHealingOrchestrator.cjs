"use strict";
/**
 * selfHealingOrchestrator — auto-repairs runtime instability.
 *
 * heal(context)                              → HealingPlan
 * autoReroute(plan, instabilityMap, opts)    → RerouteResult
 * downgradeMode(fingerprint, mode, entries) → DowngradeResult
 * shiftToSaferStrategy(fp, strategy, obs)   → string
 * recoverFromInstability(fp, observations)  → RecoveryAction
 * autoIsolate(fp, breakerState, anomalies)  → IsolationResult
 */

const STRATEGY_DOWNGRADE = {
    fast:           "safe",
    safe:           "staged",
    staged:         "recovery_first",
    recovery_first: "sandbox",
    sandbox:        "sandbox",
    dry_run:        "dry_run",
};

const MODE_DOWNGRADE = {
    direct:    "staged",
    staged:    "sandbox",
    sandbox:   "sandbox",
    dry_run:   "dry_run",
};

// ── autoReroute ───────────────────────────────────────────────────────

function autoReroute(plan, instabilityMap = {}, opts = {}) {
    const threshold = opts.stabilityThreshold ?? 0.5;
    const steps     = plan.steps ?? [];
    const rerouted  = [];
    const skipped   = [];

    for (const step of steps) {
        const stability = instabilityMap[step.id]?.stability ?? 1.0;
        if (stability < threshold) {
            skipped.push({ stepId: step.id, stability, reason: "auto_reroute_instability" });
        } else {
            rerouted.push(step);
        }
    }

    return {
        plan:     { ...plan, steps: rerouted },
        changed:  skipped.length > 0,
        rerouted: rerouted.length,
        skipped:  skipped.length,
        skippedSteps: skipped,
    };
}

// ── downgradeMode ─────────────────────────────────────────────────────

function downgradeMode(fingerprint, currentMode, entries = [], opts = {}) {
    const failThreshold = opts.failThreshold ?? 0.6;
    const fpEntries     = entries.filter(e => e.fingerprint === fingerprint);
    if (fpEntries.length < 2) {
        return { fingerprint, from: currentMode, to: currentMode, downgraded: false, reason: "insufficient_history" };
    }
    const failRate = fpEntries.filter(e => !e.success).length / fpEntries.length;
    if (failRate >= failThreshold) {
        const next = MODE_DOWNGRADE[currentMode] ?? "sandbox";
        return { fingerprint, from: currentMode, to: next, downgraded: next !== currentMode, reason: "high_fail_rate", failRate };
    }
    return { fingerprint, from: currentMode, to: currentMode, downgraded: false, reason: "stable", failRate };
}

// ── shiftToSaferStrategy ──────────────────────────────────────────────

function shiftToSaferStrategy(fingerprint, currentStrategy, observations = {}) {
    const { rollbackRate = 0, successRate = 1, anomalyCount = 0 } = observations;
    let strategy = currentStrategy;
    let shifted  = false;
    let reason   = null;

    if (anomalyCount >= 2) {
        strategy = "sandbox";
        shifted  = true;
        reason   = "multiple_anomalies";
    } else if (rollbackRate > 0.5) {
        strategy = STRATEGY_DOWNGRADE[currentStrategy] ?? "safe";
        shifted  = strategy !== currentStrategy;
        reason   = "high_rollback_rate";
    } else if (successRate < 0.4) {
        strategy = STRATEGY_DOWNGRADE[currentStrategy] ?? "safe";
        shifted  = strategy !== currentStrategy;
        reason   = "low_success_rate";
    }

    return { fingerprint, from: currentStrategy, to: strategy, shifted, reason };
}

// ── recoverFromInstability ────────────────────────────────────────────

function recoverFromInstability(fingerprint, observations = {}) {
    const {
        consecutiveFails = 0,
        rollbackRate     = 0,
        circuitOpen      = false,
        anomalyTypes     = [],
    } = observations;

    const actions = [];

    if (circuitOpen) {
        actions.push({ action: "wait_for_cooldown", reason: "circuit_open", priority: 1 });
    }
    if (consecutiveFails >= 5) {
        actions.push({ action: "quarantine", reason: "severe_failure_streak", priority: 2 });
    }
    if (rollbackRate > 0.7) {
        actions.push({ action: "switch_to_sandbox", reason: "extreme_rollback_rate", priority: 3 });
    }
    if (anomalyTypes.includes("repeated_loop")) {
        actions.push({ action: "add_dedup_guard", reason: "loop_detected", priority: 4 });
    }
    if (actions.length === 0) {
        actions.push({ action: "reduce_retry_limit", reason: "moderate_instability", priority: 5 });
    }

    actions.sort((a, b) => a.priority - b.priority);
    return { fingerprint, actions, primaryAction: actions[0].action };
}

// ── autoIsolate ───────────────────────────────────────────────────────

function autoIsolate(fingerprint, breakerState = "closed", anomalies = []) {
    const hasCriticalAnomaly = anomalies.some(a =>
        a.type === "rollback_cycle" || a.type === "repeated_loop"
    );
    const shouldIsolate = breakerState === "open" || hasCriticalAnomaly;

    return {
        fingerprint,
        isolated:  shouldIsolate,
        reason:    breakerState === "open" ? "circuit_open"
                 : hasCriticalAnomaly      ? "critical_anomaly"
                 : null,
        anomalies: anomalies.map(a => a.type),
    };
}

// ── heal (main entry point) ───────────────────────────────────────────

function heal(context = {}) {
    const {
        fingerprint    = null,
        plan           = null,
        currentStrategy = "safe",
        currentMode    = "direct",
        entries        = [],
        depStability   = {},
        breakerState   = "closed",
        anomalies      = [],
        observations   = {},
    } = context;

    const fp = fingerprint ?? "";

    // Build instability map from depStability
    const instabilityMap = {};
    for (const [id, v] of Object.entries(depStability)) {
        instabilityMap[id] = { stability: v.stability ?? 1.0 };
    }

    const rerouteResult   = plan ? autoReroute(plan, instabilityMap) : null;
    const downgradeResult = downgradeMode(fp, currentMode, entries);
    const strategyShift   = shiftToSaferStrategy(fp, currentStrategy, {
        ...observations,
        anomalyCount: anomalies.length,
    });
    const recoveryAction  = recoverFromInstability(fp, {
        ...observations,
        circuitOpen: breakerState === "open",
        anomalyTypes: anomalies.map(a => a.type ?? a),
    });
    const isolationResult = autoIsolate(fp, breakerState, anomalies);

    const healed = rerouteResult?.changed || downgradeResult.downgraded || strategyShift.shifted || isolationResult.isolated;

    return {
        fingerprint: fp,
        healed,
        reroute:    rerouteResult,
        downgrade:  downgradeResult,
        strategy:   strategyShift,
        recovery:   recoveryAction,
        isolation:  isolationResult,
        ts:         new Date().toISOString(),
    };
}

module.exports = {
    heal, autoReroute, downgradeMode, shiftToSaferStrategy,
    recoverFromInstability, autoIsolate,
};
