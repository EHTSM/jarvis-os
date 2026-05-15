"use strict";
/**
 * workflowScorer — composite operational score across five reliability dimensions.
 *
 * scoreDeployment(deploymentId, record?)  → 0–100
 * scoreDebugging(errorType, repairs[])    → 0–100
 * scoreReproducibility(workflowId)        → 0–100
 * scoreRecovery(workflowId)               → 0–100
 * scoreDeterminism(workflowId)            → 0–100
 * fullScore(workflowId, context?)
 *   → { deployment, debugging, reproducibility, recovery, determinism, composite }
 */

const qs  = require("../qualityScorer.cjs");
const rps = require("../replay/reproducibilityScorer.cjs");
const ec  = require("../determinism/executionConsistency.cjs");

// ── Deployment score ──────────────────────────────────────────────────

function scoreDeployment(deploymentId, record = {}) {
    if (!deploymentId) return 0;

    let score  = 100;
    const events = Array.isArray(record.events) ? record.events : [];

    if (record.status === "failed")       score -= 40;
    if (record.status === "rolled_back")  score -= 20;
    if (record.error)                     score -= 10;

    const hasHealthPassed = events.some(e => e.event === "health_check_passed");
    const hasHCFailed     = events.some(e => e.event === "health_check_failed");
    if (hasHealthPassed)  score += 10;
    if (hasHCFailed)      score -= 15;

    const hasRollback = events.some(e =>
        e.event === "rollback_complete" || e.event === "manual_rollback_triggered"
    );
    if (hasRollback && record.status === "rolled_back") score -= 5;

    return Math.max(0, Math.min(100, score));
}

// ── Debugging score ───────────────────────────────────────────────────

function scoreDebugging(errorType, repairs = []) {
    if (!errorType || repairs.length === 0) return 50;

    const succeeded  = repairs.filter(r => r.success).length;
    const successRate = succeeded / repairs.length;

    // Bonus: faster average resolution
    const durations = repairs.filter(r => r.durationMs > 0).map(r => r.durationMs);
    const avgMs     = durations.length > 0
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : 0;

    let score = Math.round(successRate * 70);     // up to 70 from success rate
    if (avgMs > 0 && avgMs < 500)   score += 20;  // fast resolution bonus
    else if (avgMs < 2000)          score += 10;

    if (repairs.length >= 5) score += 10;          // sufficient sample size

    return Math.max(0, Math.min(100, score));
}

// ── Reproducibility score ─────────────────────────────────────────────

function scoreReproducibility(workflowId) {
    const r = rps.score(workflowId);
    if (r.score === null) return 50;     // no data → neutral
    return r.score;
}

// ── Recovery score ────────────────────────────────────────────────────

function scoreRecovery(workflowId) {
    return qs.recoveryStabilityScore(workflowId);
}

// ── Determinism score ─────────────────────────────────────────────────

function scoreDeterminism(workflowId) {
    const qsDet = qs.determinismScore(workflowId);

    // Augment with executionConsistency flip data if available
    const consistency = ec.validate(workflowId);
    if (consistency.sampleSize < 2) return qsDet;

    // Blend: lower flip rate → higher determinism
    const consistencyScore = Math.round((1 - consistency.flipRate) * 100);
    return Math.round(qsDet * 0.60 + consistencyScore * 0.40);
}

// ── Full composite score ──────────────────────────────────────────────

function fullScore(workflowId, context = {}) {
    const deployment    = context.deploymentRecord
        ? scoreDeployment(workflowId, context.deploymentRecord)
        : 75;    // neutral when no deployment record

    const debugging     = context.repairs
        ? scoreDebugging(context.errorType || "generic", context.repairs)
        : 50;    // neutral

    const reproducibility = scoreReproducibility(workflowId);
    const recovery        = scoreRecovery(workflowId);
    const determinism     = scoreDeterminism(workflowId);

    const composite = Math.round(
        deployment     * 0.25 +
        debugging      * 0.15 +
        reproducibility * 0.20 +
        recovery        * 0.20 +
        determinism     * 0.20
    );

    return {
        deployment,
        debugging,
        reproducibility,
        recovery,
        determinism,
        composite,
    };
}

module.exports = {
    scoreDeployment,
    scoreDebugging,
    scoreReproducibility,
    scoreRecovery,
    scoreDeterminism,
    fullScore,
};
