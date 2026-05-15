"use strict";
/**
 * costModel — recovery cost modeling and strategy ranking.
 *
 * Every recovery strategy has a cost profile:
 *   repair   — complexity of the fix action (file writes, installs)
 *   rollback — damage if the fix makes things worse and must be undone
 *   retry    — time/CPU cost of the retry attempt
 *   risk     — probability [0–1] the action makes things worse instead of better
 *
 * Strategy ranking:
 *   expectedValue = confidence * (1 − risk) / (normalizedCost + ε)
 *   Highest expected value is tried first — not just highest confidence.
 *
 * Adaptive retry budgeting:
 *   workflowRiskScore(steps) → 0–1
 *   adaptiveRetryBudget(riskScore, base) → actual retry count
 *
 * Rollback vs repair decision:
 *   shouldRollback(opts) → { rollback: boolean, reason: string }
 *   Called when recovery fails, before the next attempt.
 */

// ── Per-strategy cost table ───────────────────────────────────────────
// repair   = 0 (free) → 10 (very expensive: network calls, installs)
// rollback = 0 (no side-effects) → 5 (destructive)
// retry    = 1 (fast) → 4 (slow: waiting, multiple round-trips)
// risk     = 0.0 (safe) → 1.0 (high chance of making things worse)

const STRATEGY_COSTS = {
    // Syntax
    "syntax-add-brace":              { repair: 1, rollback: 0, retry: 1, risk: 0.12 },
    "syntax-fix-semicolons":         { repair: 1, rollback: 0, retry: 1, risk: 0.22 },
    "syntax-remove-trailing-comma":  { repair: 1, rollback: 0, retry: 1, risk: 0.18 },
    // Dependency
    "dep-npm-install":               { repair: 8, rollback: 2, retry: 3, risk: 0.32 },
    "dep-extract-and-install":       { repair: 7, rollback: 2, retry: 3, risk: 0.38 },
    // Timeout
    "timeout-exponential-wait":      { repair: 0, rollback: 0, retry: 2, risk: 0.08 },
    "timeout-increase-limit":        { repair: 1, rollback: 0, retry: 1, risk: 0.14 },
    // Permission
    "perm-chmod-file":               { repair: 2, rollback: 1, retry: 1, risk: 0.22 },
    "perm-use-tmpdir":               { repair: 1, rollback: 0, retry: 1, risk: 0.28 },
    // Missing file
    "missing-create-stub":           { repair: 1, rollback: 0, retry: 1, risk: 0.18 },
    "missing-scan-alternatives":     { repair: 0, rollback: 0, retry: 2, risk: 0.10 },
    // Process failure
    "proc-flag-restart":             { repair: 1, rollback: 0, retry: 1, risk: 0.18 },
    "proc-check-exit-code":          { repair: 0, rollback: 0, retry: 1, risk: 0.08 },
    // Network
    "network-wait-retry":            { repair: 0, rollback: 0, retry: 2, risk: 0.12 },
    "network-offline-mode":          { repair: 1, rollback: 0, retry: 1, risk: 0.28 },
    // Port conflict
    "port-find-free":                { repair: 2, rollback: 0, retry: 1, risk: 0.08 },
    "port-kill-occupant":            { repair: 3, rollback: 2, retry: 1, risk: 0.58 },
    // Unknown
    "unknown-log-and-wait":          { repair: 0, rollback: 0, retry: 2, risk: 0.48 },
};

const HUMAN_ESCALATION_COST = 100; // last-resort ceiling

const DEFAULT_COST = { repair: 5, rollback: 2, retry: 2, risk: 0.50 };

// ── Cost accessors ────────────────────────────────────────────────────

function getStrategyCost(strategyId) {
    const c = STRATEGY_COSTS[strategyId] || DEFAULT_COST;
    return { ...c, total: c.repair + c.rollback + c.retry };
}

function escalationCost() { return HUMAN_ESCALATION_COST; }

// ── Expected-value ranking ────────────────────────────────────────────

/**
 * Re-rank strategies by expected value:
 *   EV = confidence × (1 − risk) / (normalizedCost + 0.1)
 *
 * Accepts strategies already enriched with `effectiveConfidence` (from recoveryEngine).
 * Returns new array sorted best-first.
 */
function rankByCost(strategies) {
    if (!strategies || strategies.length === 0) return strategies;
    const totals = strategies.map(s => getStrategyCost(s.id).total);
    const maxCost = Math.max(...totals, 1);

    return strategies
        .map(s => {
            const c    = getStrategyCost(s.id);
            const norm = c.total / maxCost;
            const ev   = (s.effectiveConfidence * (1 - c.risk)) / (norm + 0.1);
            return { ...s, costMetrics: c, expectedValue: parseFloat(ev.toFixed(4)) };
        })
        .sort((a, b) => b.expectedValue - a.expectedValue);
}

// ── Execution risk score ──────────────────────────────────────────────

/**
 * Compute an aggregate risk score [0–1] for a set of workflow steps
 * by inspecting their execute() source code for risky patterns.
 */
function workflowRiskScore(steps) {
    if (!steps || steps.length === 0) return 0;
    const RISK_WEIGHTS = [
        [/rmSync|rm\s+-rf|unlinkSync|fs\.rm\b/,        0.45],
        [/kill\s+-9|process\.exit/,                     0.40],
        [/npm\s+install|yarn\s+add|pip\s+install/,      0.22],
        [/spawnSync|execSync|child_process/,             0.18],
        [/fetch\b|http\.request|https\.request|axios\b/, 0.12],
        [/writeFileSync|fs\.write\b/,                    0.08],
        [/mkdirSync|fs\.mkdir/,                          0.04],
    ];
    const scores = steps.map(step => {
        const src = typeof step.execute === "function" ? step.execute.toString() : "";
        let risk  = 0.05; // base cost: every step has some risk
        for (const [re, weight] of RISK_WEIGHTS) {
            if (re.test(src)) risk += weight;
        }
        return Math.min(risk, 1.0);
    });
    const avg = scores.reduce((s, r) => s + r, 0) / steps.length;
    return parseFloat(avg.toFixed(3));
}

// ── Adaptive retry budgeting ──────────────────────────────────────────

/**
 * Compute the retry count for a workflow based on its risk score.
 *
 * High-risk workflows get fewer retries to avoid amplifying damage.
 * Safe deterministic workflows get more retries for resilience.
 *
 * @param {number} riskScore  0–1 aggregate risk
 * @param {number} base       caller's preferred default
 * @returns {number}
 */
function adaptiveRetryBudget(riskScore, base = 3) {
    if (riskScore >= 0.70) return 1;
    if (riskScore >= 0.45) return Math.min(base, 2);
    if (riskScore >= 0.20) return base;
    return Math.min(base * 2, 8);  // deterministic workflows: generous budget
}

// ── Rollback-vs-repair decision ───────────────────────────────────────

/**
 * Decide whether to rollback immediately rather than attempt repair.
 *
 * @param {{
 *   strategyId?:       string   — best available strategy
 *   confidence?:       number   — effective confidence of that strategy
 *   previousAttempts?: number   — how many attempts already made
 *   alreadyRolledBack?:boolean  — step was rolled back in a prior attempt
 *   stepHasRollback?:  boolean  — step exports a rollback() function
 * }} opts
 * @returns {{ rollback: boolean, reason: string }}
 */
function shouldRollback(opts = {}) {
    const {
        strategyId,
        confidence       = 0,
        previousAttempts = 0,
        alreadyRolledBack = false,
        stepHasRollback  = false,
    } = opts;

    if (!stepHasRollback) return { rollback: false, reason: "no_rollback_available" };

    if (alreadyRolledBack)
        return { rollback: true, reason: "already_rolled_back_once" };

    if (!strategyId)
        return { rollback: true, reason: "no_repair_strategy_available" };

    const c = getStrategyCost(strategyId);

    // High-risk repair when a rollback option exists → prefer rollback
    if (c.risk >= 0.55)
        return { rollback: true, reason: "repair_risk_too_high" };

    // Very low confidence with multiple failed attempts → stop digging
    if (confidence < 0.20 && previousAttempts >= 2)
        return { rollback: true, reason: "low_confidence_after_retries" };

    // Excessive attempts → prevent thrashing
    if (previousAttempts >= 4)
        return { rollback: true, reason: "max_repair_attempts_exceeded" };

    return { rollback: false, reason: "repair_preferred" };
}

module.exports = {
    getStrategyCost,
    escalationCost,
    rankByCost,
    workflowRiskScore,
    adaptiveRetryBudget,
    shouldRollback,
    STRATEGY_COSTS,
    HUMAN_ESCALATION_COST,
};
