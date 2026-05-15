"use strict";
/**
 * executionBlocker — centralised blocking decision point in the execution pipeline.
 *
 * shouldBlock(plan, feasibilityResult, simResult)
 *   → { blocked, reasons[], riskLevel, recommendation }
 *
 * shouldBlockVerification(verifyResult)
 *   → { blocked, reasons[] }
 *
 * Delegates primary checks to planVerifier; adds a separate verification-failure check.
 */

const pv = require("./planVerifier.cjs");

const BLOCK_CODES = {
    LOW_CONFIDENCE:      "low_confidence",
    HIGH_RISK:           "high_risk",
    CYCLIC_DEPS:         "cyclic_dependency",
    UNSAFE_EXECUTION:    "unsafe_execution",
    PLAN_NOT_FEASIBLE:   "plan_not_feasible",
    VERIFICATION_FAILED: "verification_failed",
};

function shouldBlock(plan, feasibility, simResult) {
    const result = pv.verify(plan, feasibility, simResult);
    return {
        blocked:        result.blocked,
        reasons:        result.reasons,
        riskLevel:      result.riskLevel,
        recommendation: result.recommendation,
    };
}

function shouldBlockVerification(verifyResult) {
    if (!verifyResult || verifyResult.passed) return { blocked: false, reasons: [] };
    return {
        blocked: true,
        reasons: verifyResult.failures.map(f => ({
            code:    BLOCK_CODES.VERIFICATION_FAILED,
            message: `Verification failed: ${f.message}`,
        })),
    };
}

module.exports = { shouldBlock, shouldBlockVerification, BLOCK_CODES };
