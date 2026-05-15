"use strict";
/**
 * optimizationAdvisor — automatically classify workflows and generate recommendations.
 *
 * analyze(results[])
 *   → { unstable[], expensive[], highRetry[], deterministic[], summary }
 *
 * getRecommendations(name, metrics)
 *   → [{ priority, action, reason }]   sorted by priority desc
 *
 * rankByPriority(results[])
 *   → [{name, priority, topAction, category}]
 *
 * identifyQuickWins(results[])
 *   → [{name, action, expectedGain}]
 */

const UNSTABLE_FLIP     = 0.30;
const EXPENSIVE_MS      = 1000;    // avg > 1s = expensive
const HIGH_RETRY_RATE   = 0.40;    // > 40% of runs have retries
const DETERMINISTIC_SR  = 0.90;    // success rate ≥ 90%

// ── analyze ───────────────────────────────────────────────────────────

function analyze(results = []) {
    const unstable      = results.filter(r => (r.flipRate ?? 0) > UNSTABLE_FLIP);
    const expensive     = results.filter(r => (r.avgMs   ?? 0) > EXPENSIVE_MS);
    const highRetry     = results.filter(r => _retryRate(r) > HIGH_RETRY_RATE);
    const deterministic = results.filter(r => (r.successRate ?? 0) >= DETERMINISTIC_SR
                                           && (r.flipRate    ?? 0) <= 0.05);

    return {
        unstable:      unstable.map(_summary),
        expensive:     expensive.map(_summary),
        highRetry:     highRetry.map(_summary),
        deterministic: deterministic.map(_summary),
        summary: {
            total:          results.length,
            unstableCount:  unstable.length,
            expensiveCount: expensive.length,
            highRetryCount: highRetry.length,
            deterministicCount: deterministic.length,
            healthRate: results.length > 0
                ? parseFloat((deterministic.length / results.length).toFixed(3))
                : 0,
        },
    };
}

// ── getRecommendations ────────────────────────────────────────────────

function getRecommendations(name, metrics = {}) {
    const recs = [];

    if ((metrics.flipRate ?? 0) > UNSTABLE_FLIP) {
        recs.push({
            priority: 90,
            action:   "apply_strict_execution_limits",
            reason:   `flipRate=${metrics.flipRate} exceeds instability threshold`,
        });
    }

    if ((metrics.successRate ?? 1) < 0.50) {
        recs.push({
            priority: 85,
            action:   "investigate_root_cause",
            reason:   `successRate=${metrics.successRate} below 50% — systematic failure`,
        });
    }

    if ((metrics.avgMs ?? 0) > EXPENSIVE_MS) {
        recs.push({
            priority: 70,
            action:   "profile_and_optimise",
            reason:   `avgMs=${metrics.avgMs}ms — flag for optimization priority`,
        });
    }

    if (_retryRate(metrics) > HIGH_RETRY_RATE) {
        recs.push({
            priority: 65,
            action:   "reduce_repair_attempts",
            reason:   `high retry rate — add better pre-validation to avoid redundant retries`,
        });
    }

    if ((metrics.repairRate ?? 0) === 0 && (metrics.successRate ?? 1) < 1) {
        recs.push({
            priority: 75,
            action:   "add_repair_strategy",
            reason:   "failures occurring with no repair strategy in place",
        });
    }

    if ((metrics.successRate ?? 0) >= DETERMINISTIC_SR && (metrics.flipRate ?? 0) <= 0.05) {
        recs.push({
            priority: 20,
            action:   "relax_retry_budget",
            reason:   "highly deterministic — current strict limits are unnecessary overhead",
        });
    }

    return recs.sort((a, b) => b.priority - a.priority);
}

// ── rankByPriority ────────────────────────────────────────────────────

function rankByPriority(results = []) {
    return results
        .map(r => {
            const recs   = getRecommendations(r.name, r);
            const top    = recs[0];
            return {
                name:      r.name     || "unnamed",
                priority:  top?.priority ?? 0,
                topAction: top?.action   ?? "none",
                category:  r.category    || "unknown",
                score:     r.score?.composite ?? 0,
            };
        })
        .sort((a, b) => b.priority - a.priority);
}

// ── identifyQuickWins ─────────────────────────────────────────────────

function identifyQuickWins(results = []) {
    const wins = [];

    for (const r of results) {
        // Quick win: flipRate is high but successRate is decent — stabilising may fix it
        if ((r.flipRate ?? 0) > 0.30 && (r.successRate ?? 0) > 0.60) {
            wins.push({
                name:         r.name,
                action:       "stabilise_execution_order",
                expectedGain: `+${Math.round((r.flipRate - 0.10) * 100)}% consistency`,
            });
        }
        // Quick win: repair rate is low but success is high — adding repair brings it to 100
        if ((r.repairRate ?? 0) < 0.30 && (r.successRate ?? 0) > 0.80) {
            wins.push({
                name:         r.name,
                action:       "add_repair_fallback",
                expectedGain: "potential 100% success rate with minimal repair logic",
            });
        }
        // Quick win: slow but successful — profiling likely easy win
        if ((r.avgMs ?? 0) > 500 && (r.successRate ?? 0) >= 0.90) {
            wins.push({
                name:         r.name,
                action:       "profile_execution_path",
                expectedGain: `potential ${Math.round(r.avgMs * 0.4)}ms reduction`,
            });
        }
    }

    return wins;
}

// ── helpers ───────────────────────────────────────────────────────────

function _retryRate(r) {
    const runs = r.runs || [];
    if (runs.length === 0) return 0;
    return runs.filter(run => (run.retries ?? 0) > 0).length / runs.length;
}

function _summary(r) {
    return {
        name:        r.name        || "unnamed",
        category:    r.category    || "unknown",
        successRate: r.successRate ?? 0,
        flipRate:    r.flipRate    ?? 0,
        avgMs:       r.avgMs       ?? 0,
        composite:   r.score?.composite ?? 0,
    };
}

module.exports = {
    analyze,
    getRecommendations,
    rankByPriority,
    identifyQuickWins,
    UNSTABLE_FLIP,
    EXPENSIVE_MS,
    HIGH_RETRY_RATE,
    DETERMINISTIC_SR,
};
