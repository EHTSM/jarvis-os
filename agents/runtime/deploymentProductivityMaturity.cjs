"use strict";
/**
 * Phase 726 — Deployment Productivity Maturity
 *
 * Staged deployment flows, rollback readiness, deployment replay continuity,
 * runtime-health validation, deployment visibility.
 * Outputs: deployment summaries, rollback confidence, operational trust reports.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Staged deployment flow ────────────────────────────────────────────────────

function buildStagedDeploymentFlow(deploymentId, { target = "production", canaryPct = 5, replayId = null, operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    if (!deploymentId) return { ok: false, error: "deploymentId required" };

    // Runtime health check first
    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    let runtimeHealthy = true;
    if (rdf) { try { const h = rdf.debugRuntimeHealthCheck(); runtimeHealthy = h.readyForDebugging !== false; } catch {} }

    const stages = [
        { stage: "pre-flight",    required: true,  autonomous: true,  actions: ["env-scan", "trust-check", "runtime-health"] },
        { stage: "canary",        required: true,  autonomous: false, requiresApproval: true, pct: canaryPct, blocked: !runtimeHealthy },
        { stage: "health-gate",   required: true,  autonomous: true,  actions: ["monitor-errors", "check-latency"] },
        { stage: "ramp-50",       required: true,  autonomous: false, requiresApproval: true, pct: 50 },
        { stage: "full-rollout",  required: true,  autonomous: false, requiresApproval: true, pct: 100 },
        { stage: "post-verify",   required: false, autonomous: true,  actions: ["smoke-test", "replay-continuity"] },
    ];

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) { try { dec.trackDeploymentStage(deploymentId, "staged-flow-initialized", { target, replayId }); } catch {} }

    return {
        ok:              true,
        deploymentId, target, replayId,
        stages,
        totalStages:     stages.length,
        approvalGates:   stages.filter(s => s.requiresApproval).length,
        runtimeHealthy,
        detail:          `Staged deploy: ${stages.length} stages, ${stages.filter(s => s.requiresApproval).length} approval gates, runtime=${runtimeHealthy ? "healthy" : "degraded"}`,
    };
}

// ── Rollback readiness ────────────────────────────────────────────────────────

function rollbackReadinessAssessment(deploymentId = "") {
    const checks = [];

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try {
            const report = dec.rollbackReadinessReport();
            checks.push({ check: "rollback-report", ok: report.ok !== false, detail: report.summary });
            const trust = dec.deploymentTrustIndicator(deploymentId);
            checks.push({ check: "trust-indicator", ok: trust.indicator !== "red", trustIndicator: trust.indicator });
        } catch {}
    }

    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    if (rdw) {
        try {
            const scan = rdw.scanEnvironmentReadiness("production");
            checks.push({ check: "env-readiness", ok: scan.ok, ready: scan.ready });
        } catch {}
    }

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (dse) {
        try {
            const strategy = dse.recommendRollbackStrategy({ operatorApproved: true });
            checks.push({ check: "rollback-strategy", ok: strategy.ok !== false, strategyId: strategy.strategy?.id });
        } catch {}
    }

    const allOk    = checks.every(c => c.ok !== false);
    const confidence = allOk ? "high" : checks.filter(c => c.ok !== false).length >= checks.length / 2 ? "medium" : "low";
    return { ok: allOk, deploymentId, checks, confidence, rollbackReady: allOk, detail: `Rollback readiness: confidence=${confidence}` };
}

// ── Deployment replay continuity ──────────────────────────────────────────────

function ensureDeploymentReplayContinuity(deploymentId, replayId) {
    if (!deploymentId || !replayId) return { ok: false, error: "deploymentId and replayId required" };

    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    let linked = false;
    if (rdw) { try { const r = rdw.linkDeploymentToReplay(deploymentId, replayId); linked = r.ok; } catch {} }

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) { try { lhpc.persistDeploymentProductivitySession(deploymentId, { replayId, linkedAt: Date.now() }); } catch {} }

    return { ok: linked, deploymentId, replayId, linked, detail: `Replay continuity: deploy=${deploymentId} linked to replay=${replayId}` };
}

// ── Deployment summary ────────────────────────────────────────────────────────

function deploymentProductivitySummary(deploymentId = "") {
    const visibility = (() => {
        const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
        if (rdw) { try { return rdw.deploymentOperatorVisibility(deploymentId); } catch {} }
        return null;
    })();

    const rollback = rollbackReadinessAssessment(deploymentId);

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    let trustIndicator = "unknown";
    if (dec) { try { trustIndicator = dec.deploymentTrustIndicator(deploymentId).indicator; } catch {} }

    return {
        ok:            visibility?.ok !== false,
        deploymentId,
        stage:         visibility?.stage || "unknown",
        trust:         trustIndicator,
        rollbackReady: rollback.rollbackReady,
        rollbackConf:  rollback.confidence,
        envReady:      visibility?.ready || false,
        detail:        `Deploy summary: stage=${visibility?.stage || "?"} trust=${trustIndicator} rollback=${rollback.confidence}`,
    };
}

// ── Operational trust report ──────────────────────────────────────────────────

function operationalTrustReport(deploymentId = "") {
    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    let trust = null;
    if (dec) { try { trust = dec.deploymentTrustIndicator(deploymentId); } catch {} }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    let unstable = null;
    if (odc) { try { unstable = odc.detectUnstableCoordinationStates(); } catch {} }

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    let dashboard = null;
    if (ecc) { try { dashboard = ecc.commandCenterDashboard(); } catch {} }

    const trustScore =
        (trust?.indicator === "green" ? 30 : trust?.indicator === "amber" ? 15 : 0) +
        (unstable?.stable ? 30 : 0) +
        (dashboard?.calm ? 20 : 0) +
        20; // base

    const level = trustScore >= 80 ? "high" : trustScore >= 60 ? "medium" : "low";

    return {
        ok:           trustScore >= 60,
        trustScore,
        level,
        deployTrust:  trust?.indicator || "unknown",
        coordStable:  unstable?.stable || false,
        calm:         dashboard?.calm || false,
        detail:       `Operational trust: score=${trustScore}/100 level=${level}`,
    };
}

module.exports = { buildStagedDeploymentFlow, rollbackReadinessAssessment, ensureDeploymentReplayContinuity, deploymentProductivitySummary, operationalTrustReport };
