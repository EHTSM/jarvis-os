"use strict";
/**
 * reliabilityScorer — four trust dimensions + composite score.
 *
 * scoreWorkflow(name, history?)      → 0–100  workflow trust score
 * scoreRepair(errorType, repairs?)   → 0–100  repair trust score
 * scorePredictability(name, history?) → 0–100 execution predictability
 * scoreRollback(deployHistory?)      → 0–100  rollback reliability
 * fullScore(context)
 *   → { workflow, repair, predictability, rollback, composite, grade }
 *
 * Stateless — derives scores from passed data or benchmarkHistory.
 */

const bh = require("./benchmarkHistory.cjs");

// ── scoreWorkflow ─────────────────────────────────────────────────────

function scoreWorkflow(name, history = null) {
    const hist = history ?? bh.getHistory(name, 20);
    if (hist.length === 0) return 50;

    const rates = hist.map(h => h.metrics?.successRate ?? 0);
    const avg   = rates.reduce((s, v) => s + v, 0) / rates.length;

    // Penalty for variance
    const variance = rates.reduce((s, v) => s + (v - avg) ** 2, 0) / rates.length;
    const cvPenalty = Math.min(30, Math.sqrt(variance) * 100);

    return Math.max(0, Math.min(100, Math.round(avg * 100 - cvPenalty)));
}

// ── scoreRepair ───────────────────────────────────────────────────────

function scoreRepair(errorType, repairs = []) {
    if (repairs.length === 0) return 50;

    const succeeded  = repairs.filter(r => r.success || r.repaired).length;
    const successRate = succeeded / repairs.length;

    // Bonus: low average retry count
    const avgRetries = repairs.reduce((s, r) => s + (r.retries ?? 0), 0) / repairs.length;
    const retryBonus = Math.max(0, 20 - avgRetries * 5);

    // Bonus: sufficient sample size
    const sampleBonus = repairs.length >= 10 ? 10 : repairs.length * 1;

    return Math.max(0, Math.min(100, Math.round(successRate * 70 + retryBonus + sampleBonus)));
}

// ── scorePredictability ───────────────────────────────────────────────

function scorePredictability(name, history = null) {
    const hist = history ?? bh.getHistory(name, 20);
    if (hist.length < 2) return 50;

    const outcomes = hist.map(h => h.metrics?.successRate ?? 0);
    let   flips    = 0;
    for (let i = 1; i < outcomes.length; i++) {
        if (Math.abs(outcomes[i] - outcomes[i - 1]) > 0.15) flips++;
    }

    const flipRate   = flips / (outcomes.length - 1);
    const avgFlip    = hist.reduce((s, h) => s + (h.metrics?.flipRate ?? 0), 0) / hist.length;
    const combined   = (flipRate + avgFlip) / 2;

    return Math.max(0, Math.min(100, Math.round((1 - combined) * 100)));
}

// ── scoreRollback ─────────────────────────────────────────────────────

function scoreRollback(deployHistory = []) {
    if (deployHistory.length === 0) return 75;  // neutral — no rollbacks needed is fine

    const rollbacks = deployHistory.filter(d => d.rolledBack || d.status === "rolled_back");
    if (rollbacks.length === 0) return 100;     // never needed rollback

    const verified  = rollbacks.filter(d => d.rollbackVerified || d.rollbackSuccess);
    const rate      = verified.length / rollbacks.length;

    // Some rollbacks are expected — penalty only for FAILED rollbacks
    const failedRB  = rollbacks.length - verified.length;
    const penalty   = Math.min(40, failedRB * 15);

    return Math.max(0, Math.min(100, Math.round(rate * 80 - penalty + 20)));
}

// ── fullScore ─────────────────────────────────────────────────────────

function fullScore(context = {}) {
    const workflow       = scoreWorkflow(context.name, context.history);
    const repair         = scoreRepair(context.errorType, context.repairs || []);
    const predictability = scorePredictability(context.name, context.history);
    const rollback       = scoreRollback(context.deployHistory || []);

    const composite = Math.round(
        workflow       * 0.30 +
        repair         * 0.25 +
        predictability * 0.25 +
        rollback       * 0.20
    );

    return {
        workflow,
        repair,
        predictability,
        rollback,
        composite,
        grade: _grade(composite),
    };
}

function _grade(score) {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 45) return "D";
    return "F";
}

module.exports = {
    scoreWorkflow,
    scoreRepair,
    scorePredictability,
    scoreRollback,
    fullScore,
};
