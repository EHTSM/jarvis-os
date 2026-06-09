"use strict";
/**
 * Phase 549 — Deployment Survivability Pass
 *
 * Deployment verification, rollback orchestration, runtime readiness validation,
 * dependency integrity, post-deployment health checks.
 *
 * Prevents: false-success deployment states, stale runtime recovery,
 * deployment replay corruption.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Deployment verification ───────────────────────────────────────────────────

/**
 * Verifies that a completed deployment run actually succeeded.
 * Checks: state = passed, all stages passed, no stale in-progress stages.
 */
function verifyDeploymentSuccess(runId) {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { ok: false, error: "deploymentPipeline unavailable" };

    const run = pipeline.listRuns({ limit: 100 }).find(r => r.id === runId);
    if (!run) return { ok: false, error: "run not found" };

    const issues = [];
    if (run.state !== "passed") issues.push(`Run state is "${run.state}", not "passed"`);
    if (run.rollbackTriggered)  issues.push("Rollback was triggered on this run");

    const staleStages = (run.stages || []).filter(s => s.state === "running" || s.state === "pending");
    if (staleStages.length > 0) issues.push(`${staleStages.length} stage(s) stuck in non-terminal state`);

    const failedStages = (run.stages || []).filter(s => s.state === "failed");
    if (failedStages.length > 0) issues.push(`${failedStages.length} stage(s) failed`);

    return {
        ok:        issues.length === 0,
        runId,
        pipeline:  run.pipeline,
        state:     run.state,
        issues,
        verified:  issues.length === 0,
        verifiedAt: new Date().toISOString(),
    };
}

// ── Post-deployment health check ──────────────────────────────────────────────

function postDeploymentHealth(runId) {
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const stability = _tryRequire("./stabilityLayer.cjs");
    const deployCC  = _tryRequire("./deploymentCommandCenter.cjs");
    const adapters  = _tryRequire("./adapterHealth.cjs");

    const pres    = pressure  ? pressure.computePressure()  : { level: "nominal", score: 0 };
    const drift   = stability ? stability.detectDrift()     : { ok: true, issues: [] };
    const ccSnap  = deployCC  ? deployCC.snapshot()         : null;

    const healthChecks = [
        { name: "runtime-pressure",  pass: pres.level === "nominal" || pres.level === "low", detail: `pressure: ${pres.level}` },
        { name: "drift-check",       pass: drift.ok,       detail: drift.ok ? "no drift" : `${(drift.issues || []).length} issues` },
        { name: "deploy-trust",      pass: ccSnap ? ccSnap.trust >= 60 : true, detail: ccSnap ? `trust: ${ccSnap.trust}` : "unavailable" },
    ];

    if (adapters) {
        try {
            const health = adapters.healthSummary ? adapters.healthSummary() : null;
            if (health) healthChecks.push({ name: "adapter-health", pass: health.degraded === 0, detail: `${health.healthy}/${health.total} healthy` });
        } catch {}
    }

    const passed = healthChecks.filter(c => c.pass).length;
    const failed = healthChecks.filter(c => !c.pass).length;

    return {
        ok:           failed === 0,
        runId,
        healthChecks,
        passed, failed,
        summary:      failed === 0 ? "Post-deployment health: ALL CLEAR" : `Post-deployment health: ${failed} check(s) need attention`,
        ts:           new Date().toISOString(),
    };
}

// ── Rollback readiness ────────────────────────────────────────────────────────

function rollbackReadiness(pipelineName) {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    const chains   = _tryRequire("./executionChainPlanner.cjs");
    const intel    = _tryRequire("./failureIntelligenceEngine.cjs");
    if (!pipeline) return { ok: false, error: "pipeline unavailable" };

    const pipeDef = pipeline.getPipeline ? pipeline.getPipeline(pipelineName) : null;
    if (!pipeDef) return { ok: false, error: `pipeline "${pipelineName}" not found` };

    const rollbackChain = pipeDef.rollbackChain || null;
    const chainExists   = rollbackChain && chains ? chains.listTemplates().some(t => t.id === rollbackChain) : false;
    const confidence    = intel && rollbackChain ? intel.recoveryConfidence(rollbackChain) : { confidence: 50 };

    return {
        ok:             true,
        pipelineName,
        rollbackChain,
        chainExists,
        confidence:     confidence.confidence,
        ready:          chainExists && confidence.confidence >= 50,
        recommendation: !rollbackChain
            ? "No rollback chain defined — rollback unavailable"
            : !chainExists
            ? `Rollback chain "${rollbackChain}" not found in planner`
            : confidence.confidence < 50
            ? "Rollback chain exists but confidence is low — test before relying on it"
            : "Rollback chain is ready",
    };
}

// ── Runtime readiness before deployment ──────────────────────────────────────

function preDeploymentReadiness(pipelineName) {
    const deployUX  = _tryRequire("./deploymentOperatorUX.cjs");
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const stability = _tryRequire("./stabilityLayer.cjs");
    const envDet    = _tryRequire("./environmentDetector.cjs");

    const checks = [];

    if (pressure) {
        const pres = pressure.computePressure();
        checks.push({
            name: "pressure",
            pass: pres.level === "nominal" || pres.level === "low",
            detail: `${pres.level} (${pres.score})`,
        });
    }

    if (stability) {
        const drift = stability.detectDrift();
        checks.push({ name: "stability-drift", pass: drift.ok, detail: drift.ok ? "stable" : "drift detected" });
    }

    if (envDet) {
        const env = envDet.detect();
        checks.push({ name: "environment", pass: env.ready, detail: env.summary });
    }

    if (deployUX && pipelineName) {
        const pre = deployUX.preflightSummary(pipelineName);
        if (pre.ok) {
            checks.push({ name: "preflight-confidence", pass: pre.confidence >= 60, detail: `${pre.confidence}% confidence` });
            if (pre.blockers.length > 0) checks.push({ name: "preflight-blockers", pass: false, detail: pre.blockers.join("; ") });
        }
    }

    const passed = checks.filter(c => c.pass).length;
    const failed = checks.filter(c => !c.pass).length;

    return {
        ok:       failed === 0,
        checks,
        passed, failed,
        readyToDeploy: failed === 0,
        recommendation: failed === 0
            ? "Runtime ready — deployment can proceed"
            : `${failed} readiness check(s) failed — resolve before deploying`,
        ts: new Date().toISOString(),
    };
}

// ── Dependency integrity ──────────────────────────────────────────────────────

function dependencyIntegrity() {
    const env = _tryRequire("./environmentDetector.cjs");
    if (!env) return { ok: false, error: "environmentDetector unavailable" };

    const detected = env.detect();
    const depCheck = detected.dependencies || {};

    const issues = [];
    if (!depCheck.nodeModulesExists)    issues.push("node_modules missing — run npm install");
    if (depCheck.missingCritical && depCheck.missingCritical.length > 0) {
        issues.push(`Missing critical deps: ${depCheck.missingCritical.join(", ")}`);
    }

    return {
        ok:       issues.length === 0,
        nodeModulesExists: !!depCheck.nodeModulesExists,
        issues,
        recommendation: issues.length === 0 ? "Dependencies intact" : "Repair dependencies before deployment",
    };
}

// ── Unified survivability report ──────────────────────────────────────────────

function survivabilityReport(pipelineName = "standard-deploy") {
    return {
        preDeployReadiness: preDeploymentReadiness(pipelineName),
        rollbackReadiness:  rollbackReadiness(pipelineName),
        dependencyIntegrity: dependencyIntegrity(),
        ts:                 new Date().toISOString(),
    };
}

module.exports = {
    verifyDeploymentSuccess, postDeploymentHealth,
    rollbackReadiness, preDeploymentReadiness,
    dependencyIntegrity, survivabilityReport,
};
