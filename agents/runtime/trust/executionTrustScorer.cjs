"use strict";
/**
 * executionTrustScorer — multi-dimensional trust scoring for runtime execution.
 *
 * scoreCapability(history)     → TrustResult
 *   history: { total, successes, failures, avgDurationMs? }
 * scoreWorkflow(steps)         → TrustResult
 *   steps: [{ state, attempts }]
 * scoreRecovery(rollbacks)     → TrustResult
 *   rollbacks: [{ success }]
 * applySandboxWeighting(score, sandboxed)  → number  (+10 when sandboxed)
 * scoreReliability(stats)      → TrustResult
 *   stats: { successRate, avgRetries?, p99Ms? }
 * grade(score)                 → "A"|"B"|"C"|"D"|"F"
 *
 * TrustResult: { score: 0–100, grade, factors: {[name]: number} }
 */

function grade(score) {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 40) return "D";
    return "F";
}

function _clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
function _result(raw, factors) { const s = _clamp(raw); return { score: s, grade: grade(s), factors }; }

// ── scoreCapability ───────────────────────────────────────────────────

function scoreCapability(history = {}) {
    const { total = 0, successes = 0, failures = 0 } = history;
    const base        = 60;
    const successBonus = total > 0 ? (successes / total) * 30 : 0;
    const failPenalty  = Math.min(50, failures * 8);
    const raw = base + successBonus - failPenalty;
    return _result(raw, { base, successBonus: Math.round(successBonus), failPenalty });
}

// ── scoreWorkflow ─────────────────────────────────────────────────────

function scoreWorkflow(steps = []) {
    if (steps.length === 0) return _result(70, { base: 70, completionBonus: 0, retryPenalty: 0 });

    const completed   = steps.filter(s => s.state === "completed" || s.state === "skipped").length;
    const completionR = completed / steps.length;
    const totalRetries = steps.reduce((s, step) => s + Math.max(0, (step.attempts ?? 1) - 1), 0);
    const base          = 50;
    const completionBonus = completionR * 40;
    const retryPenalty  = Math.min(30, totalRetries * 5);
    const raw = base + completionBonus - retryPenalty;
    return _result(raw, { base, completionBonus: Math.round(completionBonus), retryPenalty });
}

// ── scoreRecovery ─────────────────────────────────────────────────────

function scoreRecovery(rollbacks = []) {
    if (rollbacks.length === 0) return _result(70, { base: 70, noHistoryDefault: true });

    const successes = rollbacks.filter(r => r.success).length;
    const rate      = successes / rollbacks.length;
    const base      = 40;
    const bonus     = rate * 55;
    const raw = base + bonus;
    return _result(raw, { base, successRate: Math.round(rate * 100) / 100, recoveryBonus: Math.round(bonus) });
}

// ── applySandboxWeighting ─────────────────────────────────────────────

function applySandboxWeighting(score, sandboxed = false) {
    return _clamp(score + (sandboxed ? 10 : 0));
}

// ── scoreReliability ──────────────────────────────────────────────────

function scoreReliability(stats = {}) {
    const { successRate = 0, avgRetries = 0, p99Ms = 0 } = stats;
    const base         = 20;
    const rateBonus    = successRate * 55;
    const retryPenalty = Math.min(20, avgRetries * 5);
    const latencyPenalty = p99Ms > 60_000 ? 10 : p99Ms > 30_000 ? 5 : 0;
    const raw = base + rateBonus - retryPenalty - latencyPenalty;
    return _result(raw, { base, rateBonus: Math.round(rateBonus), retryPenalty, latencyPenalty });
}

module.exports = { scoreCapability, scoreWorkflow, scoreRecovery, applySandboxWeighting, scoreReliability, grade };
