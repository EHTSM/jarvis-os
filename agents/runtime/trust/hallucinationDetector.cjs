"use strict";
/**
 * hallucinationDetector — detect false-positive execution results.
 *
 * checkFakeSuccess(result)                → Detection
 * checkIncompleteExecution(result, plan)  → Detection
 * checkSilentFailure(result)              → Detection
 * checkMissingArtifacts(result, paths[])  → Detection
 * checkInvalidRecovery(result)            → Detection
 * analyze(result, context?)              → { safe, detections[], severity }
 *
 * Detection: { detected, type, reason }
 * severity:  "none" | "low" | "medium" | "high" | "critical"
 */

const fs = require("fs");

// ── individual checks ─────────────────────────────────────────────────

function checkFakeSuccess(result = {}) {
    if (!result.success) return { detected: false, type: "fake_success" };

    // success:true but every real step has non-zero exit code
    const realSteps = (result.steps ?? []).filter(s => s.state !== "simulated" && s.state !== "skipped");
    if (realSteps.length > 0 && realSteps.every(s => s.exitCode !== 0)) {
        return { detected: true, type: "fake_success", reason: "all steps exited non-zero but marked successful" };
    }

    // success:true but output is explicitly null/undefined when steps ran
    if (result.state === "completed" && result.steps && result.steps.length > 0
        && result.stepsExecuted && result.stepsExecuted.length === 0
        && !result.dryRun && !result.simulatedOnly) {
        return { detected: true, type: "fake_success", reason: "completed with no steps actually executed" };
    }

    return { detected: false, type: "fake_success" };
}

function checkIncompleteExecution(result = {}, plan = {}) {
    const planned  = (plan.executionOrder ?? result.stepsPlanned ?? []).length;
    const executed = (result.stepsExecuted ?? []).length;

    if (result.dryRun || result.simulatedOnly || result.cancelled) {
        return { detected: false, type: "incomplete_execution" };
    }

    if (result.success && planned > 0 && executed < planned) {
        return {
            detected: true,
            type: "incomplete_execution",
            reason: `${executed}/${planned} steps executed but marked successful`,
        };
    }
    return { detected: false, type: "incomplete_execution" };
}

function checkSilentFailure(result = {}) {
    if (result.success) return { detected: false, type: "silent_failure" };

    const failedSteps = (result.steps ?? []).filter(s => s.state === "failed");
    const hasSignal   = result.error
        || failedSteps.some(s => s.stderr || s.stdout)
        || result.rollbackTriggered;

    if (failedSteps.length > 0 && !hasSignal) {
        return { detected: true, type: "silent_failure", reason: "failure with no error message, stderr, or rollback signal" };
    }
    return { detected: false, type: "silent_failure" };
}

function checkMissingArtifacts(result = {}, requiredPaths = []) {
    if (requiredPaths.length === 0) return { detected: false, type: "missing_artifacts" };

    const missing = requiredPaths.filter(p => !fs.existsSync(p));
    if (missing.length > 0) {
        return {
            detected: true,
            type: "missing_artifacts",
            reason: `required artifacts not found: ${missing.join(", ")}`,
            missing,
        };
    }
    return { detected: false, type: "missing_artifacts" };
}

function checkInvalidRecovery(result = {}) {
    // rollbackTriggered claims a rollback happened but final state doesn't reflect it
    if (result.rollbackTriggered && result.state !== "rolled_back" && result.state !== "completed") {
        return {
            detected: true,
            type: "invalid_recovery",
            reason: `rollbackTriggered=true but state is "${result.state}" (expected rolled_back or completed)`,
        };
    }
    // state says rolled_back but nothing triggered it
    if (result.state === "rolled_back" && !result.rollbackTriggered) {
        return {
            detected: true,
            type: "invalid_recovery",
            reason: "state is rolled_back but rollbackTriggered is false",
        };
    }
    return { detected: false, type: "invalid_recovery" };
}

// ── analyze ───────────────────────────────────────────────────────────

const _SEVERITY = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const _TYPE_SEVERITY = {
    fake_success:         "critical",
    incomplete_execution: "high",
    silent_failure:       "medium",
    missing_artifacts:    "high",
    invalid_recovery:     "medium",
};

function analyze(result = {}, context = {}) {
    const checks = [
        checkFakeSuccess(result),
        checkIncompleteExecution(result, context.plan ?? {}),
        checkSilentFailure(result),
        checkMissingArtifacts(result, context.requiredArtifacts ?? []),
        checkInvalidRecovery(result),
    ];

    const detections = checks.filter(c => c.detected);
    if (detections.length === 0) return { safe: true, detections: [], severity: "none" };

    const topSev = detections.reduce((max, d) => {
        const s = _TYPE_SEVERITY[d.type] ?? "low";
        return _SEVERITY[s] > _SEVERITY[max] ? s : max;
    }, "none");

    return { safe: false, detections, severity: topSev };
}

module.exports = {
    checkFakeSuccess,
    checkIncompleteExecution,
    checkSilentFailure,
    checkMissingArtifacts,
    checkInvalidRecovery,
    analyze,
};
