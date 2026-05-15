"use strict";
/**
 * completionPolicy — verification-first completion gating.
 *
 * POLICIES: strict | lenient | disabled
 *
 * canComplete(verificationResult, policy?)
 *   → { approved, blocked, reasons[] }
 *
 * enforce(executionResult, verificationResult, opts?)
 *   opts: { policy?, requiredArtifacts? }
 *   → { enforced, passed, finalState, reasons[] }
 *
 * POLICIES:
 *   strict   — verification must pass; no skip on timeout
 *   lenient  — verification must pass; timeout is non-blocking
 *   disabled — no verification required
 */

const hd = require("./hallucinationDetector.cjs");

const POLICIES = {
    strict:   { verificationRequired: true,  allowSkipOnTimeout: false },
    lenient:  { verificationRequired: true,  allowSkipOnTimeout: true  },
    disabled: { verificationRequired: false, allowSkipOnTimeout: true  },
};

function canComplete(verificationResult = {}, policy = "strict") {
    const cfg     = POLICIES[policy] ?? POLICIES.strict;
    const reasons = [];

    if (!cfg.verificationRequired) {
        return { approved: true, blocked: false, reasons: [] };
    }

    // Verification ran and failed
    if (verificationResult.verified === false) {
        const issueList = verificationResult.issues ?? [];
        reasons.push(...issueList.map(i => `verification: ${i}`));
        if (reasons.length === 0) reasons.push("verification failed");
        return { approved: false, blocked: true, reasons };
    }

    // Timeout case (no verified field)
    if (verificationResult.verified === undefined || verificationResult.timedOut) {
        if (!cfg.allowSkipOnTimeout) {
            reasons.push("verification did not complete (timeout)");
            return { approved: false, blocked: true, reasons };
        }
    }

    return { approved: true, blocked: false, reasons };
}

function enforce(executionResult = {}, verificationResult = {}, opts = {}) {
    const policy   = opts.policy ?? "strict";
    const context  = { plan: opts.plan ?? {}, requiredArtifacts: opts.requiredArtifacts ?? [] };

    // Hallucination check
    const analysis = hd.analyze(executionResult, context);
    const reasons  = [];

    if (!analysis.safe) {
        for (const d of analysis.detections) reasons.push(`hallucination[${d.type}]: ${d.reason}`);
    }

    // Verification gate
    const gate = canComplete(verificationResult, policy);
    if (!gate.approved) reasons.push(...gate.reasons);

    const passed     = reasons.length === 0;
    const finalState = passed ? executionResult.state : "blocked";

    return { enforced: true, passed, finalState, reasons };
}

module.exports = { canComplete, enforce, POLICIES };
