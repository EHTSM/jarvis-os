"use strict";
/**
 * feasibilityScorer — produce feasibility score, cost estimate, and probability estimates.
 *
 * score(plan, simResult, opts?)
 *   → { feasibility, estimatedCostUsd, repairProbability, rollbackProbability, confidence }
 */

const pr = require("./planningRules.cjs");

const COST_PER_STEP      = 0.000050;   // $0.05 per 1000 steps
const COST_PER_RISK      = 0.000020;
const REPAIR_BASE        = 0.10;
const ROLLBACK_BASE      = 0.05;

// ── estimateCost ──────────────────────────────────────────────────────

function estimateCost(plan = {}) {
    const steps     = plan.steps ?? [];
    const riskCount = (plan.riskFactors ?? []).length;
    const extra     = pr.estimateComplexity(steps) * 0.000001;
    return parseFloat((steps.length * COST_PER_STEP + riskCount * COST_PER_RISK + extra).toFixed(8));
}

// ── estimateRepair ────────────────────────────────────────────────────

function estimateRepair(plan = {}, simResult = {}) {
    let p = REPAIR_BASE;
    p += (simResult.blockers?.length   ?? 0) * 0.15;
    p += (simResult.highIssues?.length ?? 0) * 0.08;
    p += (simResult.warnings?.length   ?? 0) * 0.03;
    p += (plan.riskFactors?.length     ?? 0) * 0.04;
    p += (plan.riskFactors ?? []).filter(f => f.severity === "critical").length * 0.15;
    return Math.min(0.99, parseFloat(p.toFixed(3)));
}

// ── estimateRollback ──────────────────────────────────────────────────

function estimateRollback(plan = {}, simResult = {}) {
    let p = ROLLBACK_BASE;
    const deploySteps = (plan.steps ?? []).filter(s =>
        (s.tags ?? []).includes("deploy") ||
        s.id?.includes("deploy") ||
        s.name?.toLowerCase().includes("deploy")
    ).length;
    p += deploySteps * 0.08;
    p += (simResult.blockers?.length ?? 0) * 0.10;
    p += (plan.riskFactors ?? []).filter(f => f.severity === "critical").length * 0.12;
    return Math.min(0.95, parseFloat(p.toFixed(3)));
}

// ── score ─────────────────────────────────────────────────────────────

function score(plan = {}, simResult = {}) {
    const blockerCount = simResult.blockers?.length   ?? 0;
    const highCount    = simResult.highIssues?.length ?? 0;
    const warnCount    = simResult.warnings?.length   ?? 0;
    const totalRisk    = plan.totalRisk ?? 0;

    let feasibility = 100;
    feasibility -= blockerCount * 25;
    feasibility -= highCount    * 10;
    feasibility -= warnCount    *  5;
    feasibility -= Math.min(30, totalRisk * 0.3);
    feasibility = Math.max(0, Math.min(100, Math.round(feasibility)));

    const estimatedCostUsd    = estimateCost(plan);
    const repairProbability   = estimateRepair(plan, simResult);
    const rollbackProbability = estimateRollback(plan, simResult);

    let confidence = feasibility * 0.7;
    if (simResult.passed)   confidence += 15;
    if (plan.feasible)      confidence += 10;
    if (blockerCount === 0) confidence +=  5;
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));

    return { feasibility, estimatedCostUsd, repairProbability, rollbackProbability, confidence };
}

module.exports = { score, estimateCost, estimateRepair, estimateRollback };
