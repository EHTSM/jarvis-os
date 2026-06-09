"use strict";
/**
 * Phase 732 — Operator Trust Refinement
 *
 * Execution visibility, workflow transparency, rollback clarity,
 * deployment confidence, recovery trust, operational explainability.
 * Reduces: hidden execution behavior, trust ambiguity, unsafe automation perception.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Execution visibility score ────────────────────────────────────────────────

function executionVisibilityScore() {
    let score = 100;
    const factors = [];

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (ecc) {
        try {
            const d = ecc.commandCenterDashboard();
            if (!d.panels?.runtime) { score -= 20; factors.push({ factor: "runtime-panel-missing", impact: -20 }); }
            if (!d.panels?.deployment) { score -= 15; factors.push({ factor: "deployment-panel-missing", impact: -15 }); }
            if (!d.panels?.workflows) { score -= 10; factors.push({ factor: "workflows-panel-missing", impact: -10 }); }
        } catch { score -= 20; factors.push({ factor: "command-center-unavailable", impact: -20 }); }
    }

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) {
        try {
            const active = ocf.listOneClickFlows({ status: "running" });
            if (active.length > 5) { score -= 10; factors.push({ factor: "too-many-hidden-flows", count: active.length, impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "visible" : score >= 60 ? "partial" : "opaque", factors };
}

// ── Workflow transparency ─────────────────────────────────────────────────────

function workflowTransparencyReport() {
    const catalog = [];

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) { try { catalog.push(...ocf.catalogOneClickFlows().map(f => ({ source: "one-click", type: f.type, approvalGates: f.requiresApproval, autonomousSteps: f.autonomousSteps }))); } catch {} }

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) { try { catalog.push(...epc.catalogProductivityChains().map(c => ({ source: "prod-chain", type: c.type, approvalGates: c.requiresApproval }))); } catch {} }

    const allGated = catalog.filter(c => c.approvalGates).length;
    const ungated  = catalog.filter(c => !c.approvalGates).length;
    const transparencyScore = catalog.length > 0 ? Math.round((allGated / catalog.length) * 100) : 100;

    return {
        ok:               ungated === 0 || transparencyScore >= 70,
        catalog,
        gatedFlows:       allGated,
        ungatedFlows:     ungated,
        transparencyScore,
        level:            transparencyScore >= 80 ? "transparent" : transparencyScore >= 60 ? "partial" : "opaque",
        detail:           `Workflow transparency: ${allGated}/${catalog.length} flows approval-gated (${transparencyScore}%)`,
    };
}

// ── Rollback clarity ──────────────────────────────────────────────────────────

function rollbackClarityScore(deploymentId = "") {
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (!dpm) return { ok: true, skipped: true, score: 70, level: "unknown" };

    try {
        const readiness = dpm.rollbackReadinessAssessment(deploymentId);
        const score = readiness.confidence === "high" ? 100 : readiness.confidence === "medium" ? 70 : 40;
        return { ok: readiness.rollbackReady, score, level: readiness.confidence, checks: readiness.checks?.length, detail: `Rollback clarity: confidence=${readiness.confidence}` };
    } catch (e) {
        return { ok: false, error: e.message, score: 0 };
    }
}

// ── Deployment confidence ─────────────────────────────────────────────────────

function deploymentConfidenceScore(deploymentId = "") {
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (!dpm) return { ok: true, skipped: true, score: 60, level: "unknown" };

    try {
        const trust = dpm.operationalTrustReport(deploymentId);
        return {
            ok:    trust.ok,
            score: trust.trustScore,
            level: trust.level,
            deployTrust: trust.deployTrust,
            coordStable: trust.coordStable,
            detail: `Deploy confidence: score=${trust.trustScore} level=${trust.level}`,
        };
    } catch (e) {
        return { ok: false, error: e.message, score: 0 };
    }
}

// ── Recovery trust ────────────────────────────────────────────────────────────

function recoveryTrustScore() {
    let score = 100;
    const factors = [];

    const emr = _tryRequire("./engineeringMemoryRefinement.cjs");
    if (emr) {
        try {
            const stats = emr.memoryRefinementStats();
            if (stats.total === 0) { score -= 15; factors.push({ factor: "no-memory-entries", impact: -15 }); }
            if (stats.suppressed > 10) { score -= 10; factors.push({ factor: "high-suppression", count: stats.suppressed, impact: -10 }); }
        } catch {}
    }

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const health = lss.survivabilityHealth();
            if (health.storm) { score -= 30; factors.push({ factor: "survivability-storm", impact: -30 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "trusted" : score >= 60 ? "moderate" : "low", factors };
}

// ── Operational explainability ────────────────────────────────────────────────

function operationalExplainability(context = {}) {
    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (!odc) return { ok: true, skipped: true };

    try {
        const summary = odc.decisionCoordinationSummary(context);
        const paths   = odc.prioritizeCrossEnvExecutionPaths(context);
        const flows   = odc.recommendSaferOperationalFlows(context);

        return {
            ok:           true,
            primaryPath:  summary.primaryPath,
            explanation:  paths.explainer,
            recommendation: flows.primary?.id,
            confidence:   paths.primary?.adjustedConfidence,
            explainable:  !!(paths.explainer && flows.primary),
            detail:       `Explainability: path='${summary.primaryPath}' rec='${flows.primary?.id}' conf=${paths.primary?.adjustedConfidence}%`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Full trust refinement report ──────────────────────────────────────────────

function operatorTrustRefinementReport() {
    const visibility    = executionVisibilityScore();
    const transparency  = workflowTransparencyReport();
    const rollback      = rollbackClarityScore();
    const deployment    = deploymentConfidenceScore();
    const recovery      = recoveryTrustScore();
    const explainability = operationalExplainability({ activeEnvs: ["vscode", "terminal"], trustScore: 70 });

    const avgScore = Math.round((visibility.score + transparency.transparencyScore + rollback.score + recovery.score) / 4);

    return {
        ok:           avgScore >= 60,
        avgScore,
        visibility:   { score: visibility.score, level: visibility.level },
        transparency: { score: transparency.transparencyScore, level: transparency.level },
        rollback:     { score: rollback.score, level: rollback.level },
        deployment:   { score: deployment.score, level: deployment.level },
        recovery:     { score: recovery.score, level: recovery.level },
        explainable:  explainability.explainable,
        summary:      `Operator trust: score=${avgScore} visible=${visibility.level} transparent=${transparency.level} recovery=${recovery.level}`,
    };
}

module.exports = { executionVisibilityScore, workflowTransparencyReport, rollbackClarityScore, deploymentConfidenceScore, recoveryTrustScore, operationalExplainability, operatorTrustRefinementReport };
