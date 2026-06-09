"use strict";
/**
 * Phase 575 — Execution Confidence System
 *
 * Confidence-aware execution layer: explainable scoring for patches,
 * deployments, recovery flows, workflow stability, replay trust.
 *
 * No fake certainty. Scores are bounded and explainable.
 * Confidence never exceeds 95 — uncertainty is always acknowledged.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MAX_CONFIDENCE = 95;

function _cap(n) { return Math.min(MAX_CONFIDENCE, Math.max(0, Math.round(n))); }

// ── Factor-based scorer ───────────────────────────────────────────────────────

/**
 * Score confidence from a list of factors.
 * Each factor: { name, value: 0-1, weight: 0-1, reason }
 * Returns { score, grade, factors, explanation }
 */
function scoreFromFactors(factors = []) {
    if (factors.length === 0) return { score: 0, grade: "F", factors: [], explanation: "No factors provided" };

    let weighted   = 0;
    let totalWeight = 0;
    const explanations = [];

    for (const f of factors) {
        const w = Math.min(1, Math.max(0, f.weight || 0.5));
        const v = Math.min(1, Math.max(0, f.value || 0));
        weighted    += v * w;
        totalWeight += w;
        explanations.push(`${f.name}: ${Math.round(v * 100)}% (${f.reason || ""})`);
    }

    const raw   = totalWeight > 0 ? (weighted / totalWeight) * 100 : 0;
    const score = _cap(raw);
    const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, factors: explanations, explanation: explanations.join("; ") };
}

// ── Patch confidence ──────────────────────────────────────────────────────────

/**
 * Score confidence for applying a patch.
 * @param {{ diff, reason, filePath, sessionId }} patch
 */
function patchConfidence(patch = {}) {
    const { diff = {}, reason = "", filePath = "" } = patch;
    const mem = _tryRequire("./engineeringMemory.cjs");

    const factors = [
        { name: "diff-size",         value: _diffSizeFactor(diff),              weight: 0.3, reason: "Smaller diffs are safer" },
        { name: "reason-provided",   value: reason.length > 10 ? 0.9 : 0.3,    weight: 0.2, reason: "Clear reason increases confidence" },
        { name: "file-type-known",   value: _knownExtension(filePath) ? 0.9 : 0.5, weight: 0.15, reason: "Known file type" },
        { name: "memory-precedent",  value: _memoryPrecedent(mem, reason),      weight: 0.35, reason: "Prior validated patches similar to this" },
    ];

    const result = scoreFromFactors(factors);
    result.type  = "patch";
    return result;
}

function _diffSizeFactor(diff) {
    const changed = (diff.linesChanged || 0) + (diff.linesAdded || 0);
    if (changed === 0) return 0.5;
    if (changed <= 5)  return 0.95;
    if (changed <= 20) return 0.80;
    if (changed <= 50) return 0.65;
    return 0.40;
}

function _knownExtension(fp) {
    return /\.(js|cjs|ts|json|md|yml|yaml|sh|css|jsx|tsx)$/.test(fp);
}

function _memoryPrecedent(mem, hint) {
    if (!mem || !mem.query) return 0.5;
    try {
        const matches = mem.query(hint, "validated-step");
        return matches.length > 0 ? 0.9 : 0.5;
    } catch { return 0.5; }
}

// ── Deployment confidence ─────────────────────────────────────────────────────

/**
 * Score confidence for a deployment run.
 * @param {{ preflightOk, envClear, priorSuccesses, priorFailures, pipelineName }} ctx
 */
function deploymentConfidence(ctx = {}) {
    const { preflightOk = false, envClear = false, priorSuccesses = 0, priorFailures = 0 } = ctx;
    const total = priorSuccesses + priorFailures;
    const successRate = total > 0 ? priorSuccesses / total : 0.5;

    const factors = [
        { name: "preflight",      value: preflightOk ? 0.95 : 0.1,       weight: 0.4, reason: "Preflight check result" },
        { name: "environment",    value: envClear    ? 0.95 : 0.2,       weight: 0.35, reason: "Environment warnings" },
        { name: "history",        value: successRate,                     weight: 0.25, reason: `${priorSuccesses}/${total} prior deploys succeeded` },
    ];

    const result = scoreFromFactors(factors);
    result.type  = "deployment";
    return result;
}

// ── Recovery reliability ──────────────────────────────────────────────────────

/**
 * Score confidence in a recovery chain.
 * @param {{ chainName, priorSuccesses, priorFailures, failureType }} ctx
 */
function recoveryConfidence(ctx = {}) {
    const { chainName = "", priorSuccesses = 0, priorFailures = 0, failureType = "" } = ctx;
    const total       = priorSuccesses + priorFailures;
    const successRate = total > 0 ? priorSuccesses / total : 0.5;

    const knownChains = ["recover-backend", "recover-frontend-runtime", "dependency-resolution", "git-safe-update"];
    const chainKnown  = knownChains.includes(chainName);

    const factors = [
        { name: "chain-known",     value: chainKnown ? 0.9 : 0.4,         weight: 0.3, reason: "Chain is in known-good catalog" },
        { name: "prior-success",   value: successRate,                     weight: 0.4, reason: `${priorSuccesses}/${total} prior runs succeeded` },
        { name: "failure-matched", value: failureType ? 0.8 : 0.5,        weight: 0.3, reason: failureType ? `Chain matches ${failureType}` : "Failure type unclear" },
    ];

    const result = scoreFromFactors(factors);
    result.type  = "recovery";
    return result;
}

// ── Workflow stability ────────────────────────────────────────────────────────

function workflowStability(ctx = {}) {
    const { errorRate = 0, avgDuration = 0, timeouts = 0, completions = 0 } = ctx;
    const total       = completions + (ctx.failures || 0);
    const completionRate = total > 0 ? completions / total : 0.5;

    const factors = [
        { name: "error-rate",    value: Math.max(0, 1 - errorRate),       weight: 0.4, reason: `Error rate: ${Math.round(errorRate * 100)}%` },
        { name: "completion",    value: completionRate,                    weight: 0.35, reason: `Completion rate: ${Math.round(completionRate * 100)}%` },
        { name: "timeouts",      value: timeouts === 0 ? 0.95 : timeouts <= 2 ? 0.6 : 0.2, weight: 0.25, reason: `${timeouts} timeouts observed` },
    ];

    const result = scoreFromFactors(factors);
    result.type  = "workflow";
    return result;
}

// ── Replay trust ──────────────────────────────────────────────────────────────

function replayTrust(ctx = {}) {
    const { replayId = "", idempotent = true, replayAge = 0, priorReplays = 0 } = ctx;
    const ageDays = replayAge / (24 * 60 * 60 * 1000);

    const factors = [
        { name: "idempotent",   value: idempotent ? 0.95 : 0.3,           weight: 0.4, reason: idempotent ? "Actions are idempotent" : "Non-idempotent — side-effects risk" },
        { name: "age",          value: ageDays < 1 ? 0.95 : ageDays < 7 ? 0.75 : 0.4, weight: 0.3, reason: `Replay is ${Math.round(ageDays)}d old` },
        { name: "prior-runs",   value: priorReplays > 0 ? 0.85 : 0.5,     weight: 0.3, reason: `Replayed ${priorReplays} time(s) before` },
    ];

    const result = scoreFromFactors(factors);
    result.type  = "replay";
    return result;
}

// ── Unified confidence summary ────────────────────────────────────────────────

/**
 * Get a full confidence summary for the current execution context.
 */
function confidenceSummary(ctx = {}) {
    return {
        patch:      ctx.patch      ? patchConfidence(ctx.patch)          : null,
        deployment: ctx.deployment ? deploymentConfidence(ctx.deployment) : null,
        recovery:   ctx.recovery   ? recoveryConfidence(ctx.recovery)    : null,
        workflow:   ctx.workflow   ? workflowStability(ctx.workflow)     : null,
        replay:     ctx.replay     ? replayTrust(ctx.replay)             : null,
        maxConfidence: MAX_CONFIDENCE,
        disclaimer: "Confidence scores are bounded at 95% — no execution is guaranteed safe without operator review",
    };
}

module.exports = { scoreFromFactors, patchConfidence, deploymentConfidence, recoveryConfidence, workflowStability, replayTrust, confidenceSummary, MAX_CONFIDENCE };
