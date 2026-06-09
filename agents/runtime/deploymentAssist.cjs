"use strict";
/**
 * Phase 577 — AI-Assisted Deployment Flows
 *
 * Preflight summaries, rollback recommendations, dependency integrity
 * warnings, runtime-readiness suggestions, deployment replay assistance.
 *
 * Prevents: false-success states, unsafe continuation, stale recovery.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Preflight validation summary ──────────────────────────────────────────────

/**
 * Run a full preflight check and return a human-readable summary.
 * @param {string} pipelineName
 */
function preflightSummary(pipelineName = "standard-deploy") {
    const deployUX  = _tryRequire("./deploymentOperatorUX.cjs");
    const pipeline  = _tryRequire("./deploymentPipeline.cjs");
    const confidence = _tryRequire("./executionConfidence.cjs");

    const warnings  = [];
    const blockers  = [];
    const checks    = [];
    let envClear    = true;
    let preflightOk = true;

    // Environment check
    if (deployUX && deployUX.environmentWarnings) {
        try {
            const env = deployUX.environmentWarnings();
            envClear  = env.clear;
            if (!env.clear) {
                (env.warnings || []).forEach(w => {
                    if (w.severity === "critical") blockers.push(w.message);
                    else warnings.push(w.message);
                });
            }
            checks.push({ name: "environment", ok: env.clear });
        } catch {}
    }

    // Pipeline preflight
    if (deployUX && deployUX.preflightSummary) {
        try {
            const pf = deployUX.preflightSummary(pipelineName);
            preflightOk = pf.ok;
            if (!pf.ok) (pf.blockers || []).forEach(b => blockers.push(b));
            (pf.warnings || []).forEach(w => warnings.push(w));
            checks.push({ name: "preflight", ok: pf.ok });
        } catch {}
    }

    // Confidence score
    let confidenceScore = null;
    if (confidence) {
        try {
            const priorRuns = pipeline ? pipeline.listRuns({ limit: 10 }) : [];
            const successes = priorRuns.filter(r => r.state === "completed").length;
            const failures  = priorRuns.filter(r => r.state === "failed").length;
            confidenceScore = confidence.deploymentConfidence({ preflightOk, envClear, priorSuccesses: successes, priorFailures: failures });
        } catch {}
    }

    const ready = blockers.length === 0 && preflightOk && envClear;

    return {
        pipeline:   pipelineName,
        ready,
        blockers,
        warnings,
        checks,
        confidence: confidenceScore,
        recommendation: ready
            ? `${pipelineName} is ready — proceed with operator approval`
            : `${pipelineName} has ${blockers.length} blocker(s) — resolve before deploying`,
    };
}

// ── Rollback recommendations ──────────────────────────────────────────────────

/**
 * Should the operator consider rolling back? Returns reasoning.
 */
function rollbackRecommendation() {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { recommend: false, reason: "Pipeline module unavailable" };

    let runs = [];
    try { runs = pipeline.listRuns({ limit: 10 }); } catch {}

    const failed  = runs.filter(r => r.state === "failed");
    const running = runs.filter(r => r.state === "running");
    const recent  = runs.filter(r => r.state === "failed" && !r.rollbackTriggered);

    if (recent.length === 0 && running.length === 0) {
        return { recommend: false, reason: "No failed runs requiring rollback" };
    }

    const reasons = [];
    if (recent.length > 0) reasons.push(`${recent.length} failed deployment(s) without rollback`);
    if (running.length > 1) reasons.push(`${running.length} deployments currently running — possible overlap`);

    return {
        recommend:   reasons.length > 0,
        reasons,
        failedRuns:  recent.map(r => ({ id: r.id, pipeline: r.pipeline, failedAt: r.updatedAt })),
        action:      "GET /api/runtime/deployments/rollback-preview/:runId",
    };
}

// ── Dependency integrity warnings ─────────────────────────────────────────────

/**
 * Check for dependency integrity issues before deploying.
 */
function dependencyIntegrityCheck() {
    const fs   = require("fs");
    const path = require("path");

    const warnings = [];
    const root     = path.join(__dirname, "../../");

    // Check package-lock.json exists
    if (!fs.existsSync(path.join(root, "package-lock.json"))) {
        warnings.push({ severity: "high",   message: "package-lock.json missing — run npm install to generate" });
    }

    // Check node_modules exists
    if (!fs.existsSync(path.join(root, "node_modules"))) {
        warnings.push({ severity: "critical", message: "node_modules missing — run npm ci before deploying" });
    }

    // Check .env exists
    if (!fs.existsSync(path.join(root, ".env"))) {
        warnings.push({ severity: "high",   message: ".env missing — deployment will fail without environment variables" });
    }

    return {
        ok:       warnings.filter(w => w.severity === "critical").length === 0,
        warnings,
        safe:     warnings.length === 0,
    };
}

// ── Runtime-readiness suggestions ────────────────────────────────────────────

/**
 * Pre-deployment runtime readiness check.
 */
function runtimeReadiness() {
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const stability = _tryRequire("./stabilityLayer.cjs");
    const issues    = [];

    if (pressure && pressure.getScore) {
        try {
            const score = pressure.getScore();
            if (score.level === "critical") issues.push({ type: "pressure", severity: "critical", note: "Runtime pressure is critical — delay deployment" });
            else if (score.level === "high") issues.push({ type: "pressure", severity: "high",   note: "Runtime pressure is high — monitor closely during deploy" });
        } catch {}
    }

    if (stability && stability.getStatus) {
        try {
            const s = stability.getStatus();
            if (!s.stable) issues.push({ type: "stability", severity: "high", note: "Stability layer reports instability — investigate before deploying" });
        } catch {}
    }

    return {
        ready:   issues.filter(i => i.severity === "critical").length === 0,
        issues,
        summary: issues.length === 0
            ? "Runtime appears ready for deployment"
            : `${issues.length} readiness issue(s) detected`,
    };
}

// ── Stale deployment guard ────────────────────────────────────────────────────

/**
 * Detect and warn about stale deployment recovery states.
 * A stale state is: a 'recovering' run that hasn't updated in >30min.
 */
function staleDeploymentCheck() {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { stale: false };

    let runs = [];
    try { runs = pipeline.listRuns({ limit: 20 }); } catch {}

    const STALE_MS = 30 * 60 * 1000;
    const now      = Date.now();
    const stale    = runs.filter(r => r.state === "recovering" && (now - (r.updatedAt || r.startedAt || 0)) > STALE_MS);

    return {
        stale:     stale.length > 0,
        staleRuns: stale.map(r => ({ id: r.id, pipeline: r.pipeline, staleForMs: now - (r.updatedAt || r.startedAt || 0) })),
        action:    stale.length > 0 ? "Manually review or cancel stale recovery runs before next deployment" : null,
    };
}

module.exports = { preflightSummary, rollbackRecommendation, dependencyIntegrityCheck, runtimeReadiness, staleDeploymentCheck };
