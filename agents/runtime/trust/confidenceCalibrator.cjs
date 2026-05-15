"use strict";
/**
 * confidenceCalibrator — compute execution confidence from observed factors.
 *
 * calibrate(factors)  → { confidence: 0–100, grade, components{} }
 *
 * factors:
 *   deterministic       boolean   +20 when true
 *   retries             number    −5 per retry (capped at −30)
 *   successRate         0–1       × 25  (max 25)
 *   depStability        0–1       × 15  (max 15)
 *   verificationPassed  boolean   +20 when true
 *
 * Base: 20  Max: 100  Min: 0
 */

function grade(score) {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 40) return "D";
    return "F";
}

function calibrate(factors = {}) {
    const {
        deterministic      = false,
        retries            = 0,
        successRate        = 0,
        depStability       = 0,
        verificationPassed = false,
    } = factors;

    const base             = 20;
    const deterministicAdd = deterministic      ? 20 : 0;
    const successRateAdd   = Math.round((Math.min(1, Math.max(0, successRate)) * 25));
    const depStabilityAdd  = Math.round((Math.min(1, Math.max(0, depStability)) * 15));
    const verificationAdd  = verificationPassed ? 20 : 0;
    const retryPenalty     = Math.min(30, Math.max(0, retries) * 5);

    const raw = base + deterministicAdd + successRateAdd + depStabilityAdd + verificationAdd - retryPenalty;
    const confidence = Math.max(0, Math.min(100, Math.round(raw)));

    return {
        confidence,
        grade: grade(confidence),
        components: {
            base,
            deterministicAdd,
            successRateAdd,
            depStabilityAdd,
            verificationAdd,
            retryPenalty,
        },
    };
}

module.exports = { calibrate, grade };
