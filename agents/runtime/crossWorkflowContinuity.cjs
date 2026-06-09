"use strict";
/**
 * Phase 397 — Cross-Workflow Continuity
 *
 * Chains multiple operational workflows safely within a session.
 * Example: frontend-recovery → dependency-verify → backend-validate → deployment-readiness
 *
 * Rules:
 *   - Max chain depth: 4 workflows (prevents runaway sequences)
 *   - Each workflow runs to completion before the next is evaluated
 *   - Continuation is conditional on previous workflow's success rate
 *   - Operator can approve/skip any continuation decision
 *   - All continuations are logged in the session timeline
 *   - Emergency stop cancels all pending continuations
 */

const logger  = require("../../backend/utils/logger");
const session = require("./engineeringSession.cjs");
const planner = require("./executionChainPlanner.cjs");

const MAX_CHAIN_DEPTH       = 4;
const MIN_CONFIDENCE_PCT    = 70;  // minimum success rate to continue automatically

// Predefined multi-workflow sequences
// Each sequence: ordered list of chain names + conditions to advance
const SEQUENCES = {
    "frontend-full-recovery": [
        { chain: "recover-frontend-runtime",  minConfidence: 80 },
        { chain: "health-check",              minConfidence: 60 },
        { chain: "deployment-readiness",      minConfidence: 70, requireApproval: true },
    ],
    "backend-full-recovery": [
        { chain: "recover-backend",           minConfidence: 80 },
        { chain: "health-check",              minConfidence: 60 },
    ],
    "safe-deploy": [
        { chain: "git-safe-update",           minConfidence: 100 },
        { chain: "deployment-readiness",      minConfidence: 90 },
        { chain: "deploy-update",             minConfidence: 100, requireApproval: true },
    ],
    "dependency-repair": [
        { chain: "clean-install",             minConfidence: 80 },
        { chain: "stabilize-frontend",        minConfidence: 70 },
        { chain: "health-check",              minConfidence: 60 },
    ],
};

/**
 * Build a multi-workflow continuation plan for a session.
 *
 * @param {string} sessionId
 * @param {string} sequenceName — key in SEQUENCES, or null to auto-select from session goal
 * @returns {{ plan: Array<{step, chainName, chain, condition}>, sequenceName }} | null
 */
function buildContinuationPlan(sessionId, sequenceName) {
    const sess = session.get(sessionId);
    if (!sess) return null;

    // Auto-select sequence from session goal if none provided
    if (!sequenceName) {
        const goal = sess.goal.toLowerCase();
        if (/frontend/.test(goal))                  sequenceName = "frontend-full-recovery";
        else if (/backend|api|server/.test(goal))   sequenceName = "backend-full-recovery";
        else if (/deploy|release/.test(goal))       sequenceName = "safe-deploy";
        else if (/depend|install|repair/.test(goal)) sequenceName = "dependency-repair";
        else return null;
    }

    const sequence = SEQUENCES[sequenceName];
    if (!sequence) return null;

    const plan = sequence.slice(0, MAX_CHAIN_DEPTH).map((item, i) => {
        const chain = planner.planChain(item.chain.replace(/-/g, " "));
        return {
            step:            i,
            chainName:       item.chain,
            chain,           // null if chain name didn't match a template
            minConfidence:   item.minConfidence ?? MIN_CONFIDENCE_PCT,
            requireApproval: item.requireApproval || false,
        };
    }).filter(p => p.chain !== null);

    return { plan, sequenceName };
}

/**
 * Evaluate whether to continue to the next workflow in a sequence.
 * Called after each workflow step completes.
 *
 * @param {object} lastResult  — { successRate, falsePositives, recoveryFailed }
 * @param {object} nextStep    — from plan (has minConfidence, requireApproval)
 * @returns {{ continue: bool, reason: string, requireApproval: bool }}
 */
function evaluateContinuation(lastResult, nextStep) {
    if (!nextStep) return { continue: false, reason: "no_next_step" };

    const rate = lastResult.successRate ?? 100;

    if (lastResult.recoveryFailed) {
        return { continue: false, reason: "recovery_failed_in_previous_workflow", requireApproval: false };
    }
    if (lastResult.falsePositives > 0) {
        return { continue: false, reason: "false_positives_detected", requireApproval: false };
    }
    if (rate < nextStep.minConfidence) {
        return {
            continue: false,
            reason: `success_rate_${rate}pct_below_threshold_${nextStep.minConfidence}pct`,
            requireApproval: false,
        };
    }
    if (nextStep.requireApproval) {
        return { continue: true, reason: "approval_required_before_next_step", requireApproval: true };
    }
    return { continue: true, reason: "auto_continue", requireApproval: false };
}

/** List available sequence names + their chain steps */
function listSequences() {
    return Object.entries(SEQUENCES).map(([name, steps]) => ({
        name,
        steps:   steps.length,
        chains:  steps.map(s => s.chain),
        hasCriticalApproval: steps.some(s => s.requireApproval),
    }));
}

module.exports = { buildContinuationPlan, evaluateContinuation, listSequences, SEQUENCES };
