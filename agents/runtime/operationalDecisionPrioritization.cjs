"use strict";
/**
 * Phase 667 — Operational Decision Prioritization
 *
 * Ranks stabilization paths, prioritizes debugging actions, compares workflow outcomes,
 * identifies risky execution branches, recommends safer alternatives.
 * Explainable output. Confidence-aware. Bounded autonomy only.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Stabilization path ranking ────────────────────────────────────────────────

function rankStabilizationPaths(context = {}) {
    const { pressureLevel = "nominal", hasFailures = false, trustScore = 65, deploymentActive = false } = context;

    const paths = [
        { id: "validate-health",        confidence: 95, safe: true,  autonomous: true,  requires: [] },
        { id: "reduce-workflow-load",   confidence: 85, safe: true,  autonomous: true,  requires: ["pressureLevel=high"] },
        { id: "restart-failed-chain",   confidence: 75, safe: false, autonomous: false, requires: ["hasFailures=true"] },
        { id: "pause-deployments",      confidence: 80, safe: false, autonomous: false, requires: ["deploymentActive=true"] },
        { id: "rollback-last-deploy",   confidence: 70, safe: false, autonomous: false, requires: ["deploymentActive=true", "hasFailures=true"] },
        { id: "trust-rebuilding-pause", confidence: 60, safe: true,  autonomous: false, requires: ["trustScore<50"] },
        { id: "full-recovery-sequence", confidence: 50, safe: false, autonomous: false, requires: ["hasFailures=true"] },
    ];

    const eligible = paths.filter(p => {
        return p.requires.every(req => {
            if (req === "pressureLevel=high")    return pressureLevel === "high";
            if (req === "hasFailures=true")      return hasFailures;
            if (req === "deploymentActive=true") return deploymentActive;
            if (req === "trustScore<50")         return trustScore < 50;
            return true;
        });
    });

    const ranked = eligible
        .map(p => ({
            ...p,
            adjustedConfidence: Math.min(100, p.confidence + (p.safe ? 5 : 0) - (trustScore < 50 ? 10 : 0)),
            requiresApproval: !p.autonomous,
            explainer: `${p.id}: confidence=${p.confidence}% safe=${p.safe} autonomous=${p.autonomous}`,
        }))
        .sort((a, b) => b.adjustedConfidence - a.adjustedConfidence);

    return {
        ok:       true,
        context,
        ranked,
        primary:  ranked[0] || null,
        alternatives: ranked.slice(1, 3),
        approvalRequired: ranked[0]?.requiresApproval || false,
        explainer: ranked[0] ? `Best path: '${ranked[0].id}' (${ranked[0].adjustedConfidence}% confidence)` : "No eligible stabilization paths",
    };
}

// ── Debug action prioritization ───────────────────────────────────────────────

function prioritizeDebuggingActions(errorContext = "", { trustScore = 65 } = {}) {
    const actions = [
        { action: "check-dashboard",       priority: 100, autonomous: true,  safetyLevel: "safe"   },
        { action: "validate-env",          priority: 95,  autonomous: true,  safetyLevel: "safe"   },
        { action: "inspect-logs",          priority: 90,  autonomous: true,  safetyLevel: "safe"   },
        { action: "correlate-errors",      priority: 85,  autonomous: true,  safetyLevel: "safe"   },
        { action: "run-health-checks",     priority: 80,  autonomous: true,  safetyLevel: "safe"   },
        { action: "replay-last-session",   priority: 70,  autonomous: false, safetyLevel: "caution" },
        { action: "restart-failed-step",   priority: 65,  autonomous: false, safetyLevel: "caution" },
        { action: "redeploy-service",      priority: 55,  autonomous: false, safetyLevel: "risky"  },
    ];

    // Boost relevance based on error context keywords
    const q = errorContext.toLowerCase();
    const boosted = actions.map(a => {
        let boost = 0;
        if (q.includes("log") && a.action === "inspect-logs")           boost += 10;
        if (q.includes("env") && a.action === "validate-env")           boost += 10;
        if (q.includes("deploy") && a.action === "redeploy-service")    boost += 8;
        if (q.includes("session") && a.action === "replay-last-session") boost += 8;
        if (trustScore < 50 && a.safetyLevel === "risky")               boost -= 20;
        return { ...a, adjustedPriority: a.priority + boost, requiresApproval: !a.autonomous };
    }).sort((a, b) => b.adjustedPriority - a.adjustedPriority);

    return {
        ok:      true,
        errorContext: errorContext.slice(0, 100),
        actions: boosted,
        primary: boosted[0],
        safeActions: boosted.filter(a => a.safetyLevel === "safe").slice(0, 3),
        approvalRequired: boosted[0]?.requiresApproval || false,
    };
}

// ── Workflow outcome comparison ────────────────────────────────────────────────

function compareWorkflowOutcomes(outcomes = []) {
    if (!outcomes.length) return { ok: false, error: "No outcomes provided" };

    const scored = outcomes.map(o => {
        let score = 50;
        if (o.succeeded)           score += 25;
        if (o.completedInTime)     score += 15;
        if (o.noSideEffects)       score += 10;
        if (o.replayable)          score += 10;
        if (o.requiredRollback)    score -= 20;
        if (o.causedFailures)      score -= 25;
        if (o.interruptedMidway)   score -= 10;
        return { ...o, score: Math.max(0, Math.min(100, score)) };
    }).sort((a, b) => b.score - a.score);

    return {
        ok:          true,
        ranked:      scored,
        best:        scored[0],
        worst:       scored[scored.length - 1],
        avgScore:    Math.round(scored.reduce((s, o) => s + o.score, 0) / scored.length),
        explainer:   `Best: '${scored[0]?.id || "unknown"}' (${scored[0]?.score}), Worst: '${scored[scored.length - 1]?.id || "unknown"}' (${scored[scored.length - 1]?.score})`,
    };
}

// ── Risky branch identification ───────────────────────────────────────────────

function identifyRiskyBranches(chains = []) {
    const risky = [];

    chains.forEach(chain => {
        const depth = chain.depth || 0;
        const reasons = [];

        if (depth >= 6)                              reasons.push({ factor: "deep-chain",       depth, severity: "high"   });
        if (chain.retryCount >= 3)                   reasons.push({ factor: "high-retry",       count: chain.retryCount, severity: "high" });
        if (chain.hasUnvalidatedBranch)              reasons.push({ factor: "unvalidated-branch",                        severity: "medium" });
        if (chain.modifiesSharedState)               reasons.push({ factor: "shared-state-mutation",                     severity: "high" });
        if (chain.autonomousRollback)                reasons.push({ factor: "autonomous-rollback",                       severity: "critical" });
        if (!chain.approvalRequired && chain.risky)  reasons.push({ factor: "unapproved-risky-op",                      severity: "critical" });

        if (reasons.length > 0) {
            const severity = reasons.some(r => r.severity === "critical") ? "critical"
                           : reasons.some(r => r.severity === "high")     ? "high"
                           : "medium";
            risky.push({ chainId: chain.chainId || chain.id, reasons, severity, saferAlternative: _saferAlternative(reasons) });
        }
    });

    risky.sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2 };
        return (order[a.severity] || 2) - (order[b.severity] || 2);
    });

    return {
        ok:          true,
        riskyCount:  risky.length,
        risky,
        critical:    risky.filter(r => r.severity === "critical"),
        approvalRequired: risky.some(r => r.severity === "critical"),
        recommendation: risky.length > 0 ? `${risky.length} risky branch(es) detected — review before execution` : "No risky branches detected",
    };
}

function _saferAlternative(reasons) {
    if (reasons.some(r => r.factor === "deep-chain"))             return "Break into smaller sequential chains";
    if (reasons.some(r => r.factor === "autonomous-rollback"))    return "Require operator approval for rollback";
    if (reasons.some(r => r.factor === "unapproved-risky-op"))   return "Add approval gate before risky operation";
    if (reasons.some(r => r.factor === "shared-state-mutation"))  return "Isolate state changes, use transactional pattern";
    if (reasons.some(r => r.factor === "high-retry"))             return "Add exponential backoff and circuit breaker";
    return "Add validation and approval gates";
}

// ── Safer alternative recommendation ─────────────────────────────────────────

function recommendSaferAlternatives(plan = {}) {
    const alternatives = [];
    const { action = "", riskLevel = "unknown", autonomous = false, approvalRequired = false, depth = 0 } = plan;

    if (riskLevel === "high" || riskLevel === "critical") {
        alternatives.push({
            id:          "staged-execution",
            description: "Break into smaller approved steps with validation between each",
            confidence:  85,
        });
        alternatives.push({
            id:          "canary-approach",
            description: "Execute against small subset first, validate, then proceed",
            confidence:  80,
        });
    }

    if (autonomous && riskLevel !== "low") {
        alternatives.push({
            id:          "operator-gated",
            description: "Add explicit operator approval before execution",
            confidence:  90,
        });
    }

    if (depth >= 5) {
        alternatives.push({
            id:          "depth-reduction",
            description: "Flatten execution chain — split into independent sequential tasks",
            confidence:  75,
        });
    }

    if (!approvalRequired && (riskLevel === "high" || riskLevel === "critical")) {
        alternatives.push({
            id:          "add-approval-gate",
            description: "Require operator approval before this action proceeds",
            confidence:  95,
        });
    }

    alternatives.sort((a, b) => b.confidence - a.confidence);

    return {
        ok:           true,
        action,
        riskLevel,
        alternatives,
        primary:      alternatives[0] || null,
        explainer:    alternatives.length > 0
            ? `Recommended: '${alternatives[0]?.id}' (${alternatives[0]?.confidence}% confidence)`
            : "No safer alternatives needed — plan is already safe",
    };
}

// ── Decision summary ──────────────────────────────────────────────────────────

function decisionPrioritizationSummary(context = {}) {
    const stabilization = rankStabilizationPaths(context);
    const debugging     = prioritizeDebuggingActions(context.errorContext || "", { trustScore: context.trustScore });

    // Check live risk intelligence
    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    let riskSummary = null;
    if (eri) { try { riskSummary = eri.riskSummary({ windowMs: 4 * 60 * 60 * 1000 }); } catch {} }

    return {
        ok:              true,
        stabilization:   { primary: stabilization.primary?.id, confidence: stabilization.primary?.adjustedConfidence },
        debugging:       { primary: debugging.primary?.action,  priority: debugging.primary?.adjustedPriority },
        riskLevel:       riskSummary?.overall || "unknown",
        approvalRequired: stabilization.approvalRequired || debugging.approvalRequired,
        summary:         `Decision priority: stabilize=${stabilization.primary?.id || "n/a"}, debug=${debugging.primary?.action || "n/a"}, risk=${riskSummary?.overall || "unknown"}`,
    };
}

module.exports = { rankStabilizationPaths, prioritizeDebuggingActions, compareWorkflowOutcomes, identifyRiskyBranches, recommendSaferAlternatives, decisionPrioritizationSummary };
