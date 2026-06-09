"use strict";
/**
 * Phase 409 — Safe Autonomous Continuation
 *
 * Decides whether to auto-continue a chain after each step.
 * Continuation is allowed ONLY when ALL of:
 *   1. Validation confidence is stable (session confidence >= 40)
 *   2. Environment is healthy (pressure <= "elevated")
 *   3. Retry pressure is low (pressure score < 61)
 *   4. Session is not degraded ("critical" degradationState blocks)
 *   5. No consecutive failures above threshold (>= 3 stops the chain)
 *
 * Auto-stops when:
 *   - Confidence collapses below 40
 *   - Repeated failures (consecutiveFailures >= 3)
 *   - Environment becomes unstable (pressure "high" or "critical")
 *   - Session transitions to "blocked" state
 */

const pressure  = require("./runtimePressureMonitor.cjs");
const session   = require("./engineeringSession.cjs");
const cooldown  = require("./executionCooldown.cjs");
const logger    = require("../../backend/utils/logger");

const MIN_CONFIDENCE      = 40;   // below this → stop
const MAX_CONSECUTIVE_FAIL = 3;   // at or above → stop
const PRESSURE_STOP_LEVEL = "high"; // high or critical → stop normal chains

/**
 * Evaluate whether execution should continue after a step.
 *
 * @param {object} opts
 * @param {string} opts.sessionId       — engineering session ID (may be null)
 * @param {string} opts.chainName       — chain being executed
 * @param {number} opts.stepIndex       — 0-based index of step just completed
 * @param {boolean} opts.stepSuccess    — did the step succeed?
 * @param {number} opts.consecutiveFails — how many consecutive failures in this chain run
 * @param {number} [opts.priority]      — PRIORITY.* from runtimePressureMonitor
 * @returns {{ continue: boolean, reason: string, pressure: object, confidence: number|null }}
 */
function shouldContinue({
    sessionId,
    chainName,
    stepIndex,
    stepSuccess,
    consecutiveFails = 0,
    priority = pressure.PRIORITY.NORMAL,
}) {
    // 1. Pressure gate — always evaluated regardless of session
    const gate = pressure.priorityGate(priority);
    if (!gate.allowed) {
        logger.warn(`[AutoContinue] chain="${chainName}" step=${stepIndex} stopped — pressure gate blocked (${gate.reason})`);
        return { continue: false, reason: gate.reason, pressure: gate.pressure, confidence: null };
    }

    const p = gate.pressure;

    // 2. Environment stability check
    if (p.level === "high" || p.level === "critical") {
        logger.warn(`[AutoContinue] chain="${chainName}" step=${stepIndex} stopped — environment unstable (pressure=${p.score} level=${p.level})`);
        return { continue: false, reason: `environment_${p.level}`, pressure: p, confidence: null };
    }

    // 3. Consecutive failure guard
    if (consecutiveFails >= MAX_CONSECUTIVE_FAIL) {
        logger.warn(`[AutoContinue] chain="${chainName}" step=${stepIndex} stopped — ${consecutiveFails} consecutive failures`);
        return { continue: false, reason: "consecutive_failures", pressure: p, confidence: null };
    }

    // 4. Session-based confidence checks (only if session is active)
    let confidence = null;
    if (sessionId) {
        const s = session.get(sessionId);
        if (s) {
            if (s.state === "blocked") {
                return { continue: false, reason: "session_blocked", pressure: p, confidence: s.executionConfidence };
            }
            confidence = s.executionConfidence ?? 100;
            const degradation = s.degradationState || "healthy";

            if (degradation === "critical" || confidence < MIN_CONFIDENCE) {
                logger.warn(`[AutoContinue] chain="${chainName}" stopped — confidence=${confidence} degradation=${degradation}`);
                return { continue: false, reason: `confidence_${degradation}`, pressure: p, confidence };
            }
        }
    }

    // 5. Cooldown check for the next step dispatch
    const wfThrottle = cooldown.checkWorkflowThrottle();
    if (!wfThrottle.allowed) {
        return { continue: false, reason: `workflow_throttle:${wfThrottle.rate}/min`, pressure: p, confidence };
    }

    return { continue: true, reason: "all_checks_passed", pressure: p, confidence };
}

/**
 * Record a step outcome and update session + pressure state.
 * Call after every step regardless of success/failure.
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.chainName
 * @param {boolean} opts.success
 * @param {string} [opts.cmd]
 */
function recordStepOutcome({ sessionId, chainName, success, cmd = "" }) {
    if (success) {
        pressure.recordWorkflowStart(); // counts as execution activity
    } else {
        pressure.recordFailure();
    }

    if (sessionId) {
        session.updateConfidence(sessionId, success);
    }

    if (!success) {
        logger.info(`[AutoContinue] step failure recorded — chain="${chainName}" cmd="${cmd.slice(0, 60)}"`);
    }
}

/**
 * Determine the stop reason after a chain terminates (for logging/UI).
 * Returns a human-readable summary of why the chain stopped.
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.chainName
 * @param {number} opts.stepsCompleted
 * @param {number} opts.totalSteps
 * @param {boolean} opts.reachedEnd     — true if stopped naturally at last step
 * @param {string} [opts.stopReason]    — reason from shouldContinue, if stopped early
 * @returns {string}
 */
function summarizeChainRun({ sessionId, chainName, stepsCompleted, totalSteps, reachedEnd, stopReason }) {
    if (reachedEnd) {
        return `Chain "${chainName}" completed all ${totalSteps} steps.`;
    }
    const reasonMap = {
        consecutive_failures: "stopped after repeated step failures",
        session_blocked:      "stopped — session is blocked",
        confidence_critical:  "stopped — execution confidence critical",
        confidence_degraded:  "stopped — execution confidence degraded",
        environment_high:     "stopped — runtime pressure high",
        environment_critical: "stopped — runtime pressure critical",
    };
    const description = reasonMap[stopReason] || `stopped (${stopReason || "unknown"})`;
    return `Chain "${chainName}" ${description} after ${stepsCompleted}/${totalSteps} steps.`;
}

module.exports = { shouldContinue, recordStepOutcome, summarizeChainRun };
