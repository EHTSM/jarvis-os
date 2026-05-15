"use strict";
/**
 * selfEvaluator — explain benchmark outcomes in structured natural-language terms.
 *
 * explainFailure(result)
 *   → { reason, primaryFactor, factors[], confidence, suggestions[] }
 *
 * explainRepairOutcome(repair)
 *   → { outcome, reason, factors[], recommendation }
 *
 * explainInstability(metrics)
 *   → { primaryCause, causes[], confidence, severity }
 *
 * explainConfidenceDrop(before, after)
 *   → { factors[], delta, recommendation, severity }
 *
 * evaluateRun(benchmarkResult)
 *   → { summary, failures, repairs, instability, confidence, overall }
 */

// ── explainFailure ────────────────────────────────────────────────────

function explainFailure(result = {}) {
    const factors      = [];
    const suggestions  = [];

    if ((result.successRate ?? 1) === 0) {
        factors.push({ factor: "zero_success_rate", weight: 1.0, detail: "No runs succeeded" });
        suggestions.push("Examine scenario setup — all runs failed deterministically");
    }
    if ((result.flipRate ?? 0) > 0.5) {
        factors.push({ factor: "high_flip_rate", weight: 0.8, detail: `flipRate=${result.flipRate}` });
        suggestions.push("Introduce deterministic seed or eliminate non-deterministic I/O");
    }
    if ((result.avgMs ?? 0) > 5000) {
        factors.push({ factor: "slow_execution",  weight: 0.5, detail: `avgMs=${result.avgMs}` });
        suggestions.push("Profile execution path — task may be blocked on I/O or network");
    }

    const errorRuns = (result.runs || []).filter(r => r.error);
    if (errorRuns.length > 0) {
        const firstErr = errorRuns[0].error;
        factors.push({ factor: "thrown_errors", weight: 0.9, detail: firstErr });
        suggestions.push(`Fix root error: ${firstErr}`);
    }

    if (result.repairRate === 0 && (result.successRate ?? 1) < 1) {
        factors.push({ factor: "no_repair_attempted", weight: 0.6, detail: "repairRate=0" });
        suggestions.push("Ensure repair strategy is registered for this failure type");
    }

    const primary    = factors.sort((a, b) => b.weight - a.weight)[0];
    const confidence = factors.length > 0
        ? parseFloat(Math.min(0.95, factors[0].weight * 0.85 + (factors.length - 1) * 0.05).toFixed(3))
        : 0;

    return {
        reason:        primary?.factor || "unknown_failure",
        primaryFactor: primary || null,
        factors,
        confidence,
        suggestions,
    };
}

// ── explainRepairOutcome ──────────────────────────────────────────────

function explainRepairOutcome(repair = {}) {
    const success = repair.success ?? repair.repaired ?? false;
    const factors = [];

    if (success) {
        if (repair.retries === 0) factors.push("first_attempt_success");
        else                      factors.push(`succeeded_after_${repair.retries}_retries`);
        if ((repair.durationMs ?? 0) < 200) factors.push("fast_repair");

        return {
            outcome:        "success",
            reason:         factors[0],
            factors,
            recommendation: "Record strategy as high-confidence; prioritise in future repair plans",
        };
    }

    // Failure explanation
    if ((repair.retries ?? 0) >= 5) {
        factors.push("max_retries_exhausted");
    }
    if (repair.error) {
        factors.push(`error: ${repair.error}`);
    }
    if (!repair.strategy && !repair.detail) {
        factors.push("no_strategy_applied");
    }

    return {
        outcome:        "failure",
        reason:         factors[0] || "repair_did_not_pass_verification",
        factors,
        recommendation: "Review repair catalog for this error type; consider adding fallback strategy",
    };
}

// ── explainInstability ────────────────────────────────────────────────

function explainInstability(metrics = {}) {
    const causes   = [];
    const flipRate = metrics.flipRate ?? 0;
    const sr       = metrics.successRate ?? 1;

    if (flipRate > 0.5) {
        causes.push({ cause: "extreme_outcome_variance",   confidence: 0.95, detail: `flipRate=${flipRate}` });
    } else if (flipRate > 0.30) {
        causes.push({ cause: "high_outcome_variance",      confidence: 0.80, detail: `flipRate=${flipRate}` });
    }

    if (sr < 0.30) {
        causes.push({ cause: "critically_low_success_rate", confidence: 0.90, detail: `successRate=${sr}` });
    } else if (sr < 0.60) {
        causes.push({ cause: "low_success_rate",            confidence: 0.70, detail: `successRate=${sr}` });
    }

    if ((metrics.p95Ms ?? 0) > (metrics.avgMs ?? 0) * 5 && metrics.avgMs > 0) {
        causes.push({ cause: "execution_time_outliers",    confidence: 0.65, detail: `p95=${metrics.p95Ms}ms` });
    }

    if ((metrics.totalRuns ?? 0) < 5) {
        causes.push({ cause: "insufficient_sample_size",   confidence: 0.50, detail: `runs=${metrics.totalRuns}` });
    }

    causes.sort((a, b) => b.confidence - a.confidence);
    const primary    = causes[0];
    const confidence = primary?.confidence ?? 0;
    const severity   = flipRate > 0.5 || sr < 0.2 ? "critical"
        : flipRate > 0.3 || sr < 0.5              ? "high"
        : causes.length > 0                        ? "medium"
        : "none";

    return { primaryCause: primary?.cause || "none", causes, confidence, severity };
}

// ── explainConfidenceDrop ─────────────────────────────────────────────

function explainConfidenceDrop(before = {}, after = {}) {
    const factors  = [];

    const srDelta  = (after.successRate ?? 0) - (before.successRate ?? 0);
    const frDelta  = (after.flipRate    ?? 0) - (before.flipRate    ?? 0);
    const cDelta   = (after.composite   ?? after.score?.composite   ?? 0)
                   - (before.composite  ?? before.score?.composite  ?? 0);

    if (srDelta < -0.05) factors.push({ factor: "success_rate_declined",   delta: parseFloat(srDelta.toFixed(3)) });
    if (frDelta >  0.10) factors.push({ factor: "flip_rate_increased",     delta: parseFloat(frDelta.toFixed(3)) });
    if (cDelta  < -10)   factors.push({ factor: "composite_score_dropped", delta: Math.round(cDelta) });

    const severity = Math.abs(cDelta) > 20 ? "high"
        : Math.abs(cDelta) > 10             ? "medium"
        : "low";

    const recommendation = factors.length === 0
        ? "Confidence stable — no action needed"
        : factors[0].factor === "success_rate_declined"
            ? "Investigate recent changes that may have broken deterministic behaviour"
            : "Monitor for continued instability; consider applying stricter execution limits";

    return {
        factors,
        delta:          parseFloat(cDelta.toFixed(2)),
        recommendation,
        severity,
    };
}

// ── evaluateRun ───────────────────────────────────────────────────────

function evaluateRun(result = {}) {
    const failure     = result.successRate < 1 ? explainFailure(result)       : null;
    const repairEval  = explainRepairOutcome({ success: (result.repairRate ?? 0) > 0.5, retries: 0, ...result });
    const instability = explainInstability(result);

    const overall = result.score?.composite >= 80 ? "healthy"
        : result.score?.composite >= 60           ? "acceptable"
        : result.score?.composite >= 40           ? "degraded"
        : "critical";

    return {
        name:        result.name || "unnamed",
        overall,
        summary:     `${result.name}: ${overall} (composite=${result.score?.composite ?? "?"})`
                   + `, success=${pct(result.successRate)}, repair=${pct(result.repairRate)}`,
        failure,
        repair:      repairEval,
        instability,
        confidence:  1 - (result.flipRate ?? 0),
    };
}

function pct(v) { return v != null ? Math.round(v * 100) + "%" : "?"; }

module.exports = {
    explainFailure,
    explainRepairOutcome,
    explainInstability,
    explainConfidenceDrop,
    evaluateRun,
};
