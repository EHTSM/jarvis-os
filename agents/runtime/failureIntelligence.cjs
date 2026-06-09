"use strict";
/**
 * Phase 446 — Failure Intelligence Engine
 *
 * Improved root-cause analysis, failure classification, recovery confidence,
 * operational certainty, degraded-runtime awareness.
 *
 * Prevents: false-positive recoveries, misleading success states.
 *
 * Combines: terminal classifier output + probe results + session confidence
 * + pressure level → single authoritative failure assessment.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const CONFIDENCE_THRESHOLDS = {
    certain:  90,  // outcome is reliable — trust it
    probable: 70,  // likely correct — proceed with caution
    uncertain: 50, // mixed signals — require operator review
    unreliable: 0, // do not trust — investigate before acting
};

/**
 * Assess a command's outcome for reliability.
 *
 * Inputs:
 *   terminalOutput — raw stdout/stderr
 *   exitCode       — process exit code
 *   probeResult    — { verified, falsePositive, checks }
 *   sessionId      — for confidence + trust lookup
 *   pressure       — current pressure object { level, score }
 *
 * Returns:
 *   { reliable, confidence, rootCause, classification, falsePositiveRisk,
 *     recommendation, signals }
 */
function assess({ terminalOutput, exitCode, probeResult, sessionId, pressure } = {}) {
    const signals = [];
    let confidence = 100;

    // ── Terminal output classification ────────────────────────────────────────
    const termClass = _tryRequire("./terminalOutputClassifier.cjs");
    let termResult  = null;
    if (termClass && terminalOutput) {
        termResult = termClass.classify(terminalOutput);
        signals.push({ src: "terminal", category: termResult.category, severity: termResult.severity });
        if (termResult.category === "fatal")        confidence -= 40;
        else if (termResult.category === "build-error") confidence -= 25;
        else if (termResult.category === "transient")   confidence -= 10;
        else if (termResult.category === "success")     confidence += 5;
    }

    // ── Exit code ─────────────────────────────────────────────────────────────
    if (exitCode !== null && exitCode !== undefined) {
        signals.push({ src: "exitCode", value: exitCode });
        if (exitCode !== 0) confidence -= 30;
    }

    // ── Probe result ──────────────────────────────────────────────────────────
    let falsePositiveRisk = false;
    if (probeResult) {
        signals.push({ src: "probe", verified: probeResult.verified, falsePositive: probeResult.falsePositive });
        if (probeResult.falsePositive) {
            confidence     -= 50;
            falsePositiveRisk = true;
        } else if (probeResult.verified === false) {
            confidence -= 20;
        } else if (probeResult.verified === true) {
            confidence += 15;
        }
    }

    // ── Session trust ─────────────────────────────────────────────────────────
    const trustModel = _tryRequire("./operatorTrustModel.cjs");
    if (trustModel && sessionId) {
        const trust = trustModel.getTrust(sessionId);
        signals.push({ src: "trust", score: trust.score, level: trust.level });
        if (trust.score < 40)      confidence -= 20;
        else if (trust.score < 60) confidence -= 10;
    }

    // ── Pressure ──────────────────────────────────────────────────────────────
    if (pressure) {
        signals.push({ src: "pressure", level: pressure.level, score: pressure.score });
        if (pressure.level === "critical")  confidence -= 15;
        else if (pressure.level === "high") confidence -= 8;
    }

    // Clamp
    confidence = Math.max(0, Math.min(100, confidence));

    const reliable       = confidence >= CONFIDENCE_THRESHOLDS.probable;
    const classification =
        confidence >= CONFIDENCE_THRESHOLDS.certain    ? "certain"    :
        confidence >= CONFIDENCE_THRESHOLDS.probable   ? "probable"   :
        confidence >= CONFIDENCE_THRESHOLDS.uncertain  ? "uncertain"  : "unreliable";

    const rootCause = termResult?.rootCause || (exitCode !== 0 ? "non-zero exit code" : null);

    let recommendation;
    if (falsePositiveRisk) {
        recommendation = "verify manually — false positive detected";
    } else if (classification === "unreliable") {
        recommendation = "do not proceed — outcome unreliable, investigate before continuing";
    } else if (classification === "uncertain") {
        recommendation = "proceed with caution — request operator confirmation";
    } else {
        recommendation = termResult?.suggestions?.[0] || "proceed";
    }

    return { reliable, confidence, classification, rootCause, falsePositiveRisk, recommendation, signals };
}

/**
 * Classify a sequence of step outcomes and detect degraded patterns.
 * @param {Array<{ success, probeResult, terminalOutput, exitCode }>} steps
 * @returns {{ degraded, pattern, consecutiveFails, failureRate, assessment }}
 */
function assessChain(steps = []) {
    if (!steps.length) return { degraded: false, pattern: "no-steps", consecutiveFails: 0, failureRate: 0 };

    const failures = steps.filter(s => !s.success).length;
    const failureRate = failures / steps.length;

    // Count consecutive failures from the end
    let consecutiveFails = 0;
    for (let i = steps.length - 1; i >= 0; i--) {
        if (!steps[i].success) consecutiveFails++;
        else break;
    }

    const pattern =
        failureRate === 0                  ? "all-success" :
        failureRate === 1                  ? "all-failure" :
        consecutiveFails >= 3              ? "trailing-failures" :
        failureRate > 0.5                  ? "mostly-failing" : "mixed";

    const degraded = pattern === "all-failure" || pattern === "trailing-failures" || failureRate > 0.5;

    // Assess last step
    const last       = steps[steps.length - 1];
    const assessment = assess(last || {});

    return { degraded, pattern, consecutiveFails, failureRate: Math.round(failureRate * 100), assessment };
}

module.exports = { assess, assessChain, CONFIDENCE_THRESHOLDS };
