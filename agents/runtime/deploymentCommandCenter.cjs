"use strict";
/**
 * Phase 530 — Real Deployment Command Center
 *
 * Deployment-focused operator mode: readiness, rollback safety,
 * runtime health, validation status, deployment timeline, recovery chains.
 * Calm, low-noise, trust-visible.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Deployment command center snapshot ───────────────────────────────────────

function snapshot() {
    const pipeline  = _tryRequire("./deploymentPipeline.cjs");
    const deployUX  = _tryRequire("./deploymentOperatorUX.cjs");
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const modes     = _tryRequire("./runtimeModes.cjs");
    const depFlows  = _tryRequire("./deploymentRecoveryFlows.cjs");

    // Deployment runs
    const runs          = pipeline ? pipeline.listRuns({ limit: 10 }) : [];
    const active        = runs.filter(r => r.state === "running");
    const pending       = runs.filter(r => r.state === "pending");
    const awaitApproval = runs.filter(r => r.state === "awaiting-approval");
    const failed        = runs.filter(r => r.state === "failed" && !r.rollbackTriggered);
    const recentPassed  = runs.filter(r => r.state === "passed").slice(0, 3);

    // Readiness
    const env = deployUX ? deployUX.environmentWarnings() : { clear: true, warnings: [] };

    // Pressure
    const pres = pressure ? pressure.computePressure() : { level: "nominal", score: 0 };

    // Recovery chains
    const recoveryFlows = depFlows ? (depFlows.listFlows ? depFlows.listFlows().length : 0) : 0;

    // Trust level: how confident is the deployment environment
    let trust = 100;
    if (!env.clear)                trust -= env.warnings.length * 10;
    if (pres.level === "high")     trust -= 20;
    if (pres.level === "critical") trust -= 40;
    if (failed.length > 0)         trust -= failed.length * 15;
    if (awaitApproval.length > 0)  trust -= 5;
    trust = Math.max(0, Math.min(100, trust));

    const trustLabel =
        trust >= 80 ? "HIGH"    :
        trust >= 60 ? "MODERATE":
        trust >= 40 ? "LOW"     : "CRITICAL";

    // Alerts
    const alerts = [];
    if (awaitApproval.length > 0) alerts.push(`${awaitApproval.length} deployment(s) awaiting approval`);
    if (failed.length > 0)        alerts.push(`${failed.length} failed deployment(s) without rollback`);
    if (!env.clear)               alerts.push(...env.warnings.map(w => w.message || w));
    if (pres.level !== "nominal" && pres.level !== "low") alerts.push(`Runtime pressure: ${pres.level}`);

    return {
        trust,
        trustLabel,
        alerts,
        runs: {
            active:          active.length,
            pending:         pending.length,
            awaitingApproval: awaitApproval.length,
            failed:          failed.length,
            recentPassed:    recentPassed.length,
        },
        environmentClear:  env.clear,
        pressureLevel:     pres.level,
        pressureScore:     pres.score,
        recoveryFlows,
        mode:              modes ? modes.getActiveMode().name : "unknown",
        activeDetails:     active.slice(0, 3).map(r => ({ id: r.id, pipeline: r.pipeline, state: r.state })),
        failedDetails:     failed.slice(0, 3).map(r => ({ id: r.id, pipeline: r.pipeline })),
        awaitDetails:      awaitApproval.slice(0, 3).map(r => ({ id: r.id, pipeline: r.pipeline })),
        ts:                new Date().toISOString(),
    };
}

/**
 * Deployment timeline: recent runs with stage-level visibility.
 */
function deploymentTimeline({ limit = 10 } = {}) {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    if (!pipeline) return { available: false };

    const runs = pipeline.listRuns({ limit });
    return {
        available: true,
        count:     runs.length,
        timeline:  runs.map(r => ({
            id:               r.id,
            pipeline:         r.pipeline,
            state:            r.state,
            dryRun:           r.dryRun,
            rollbackTriggered: r.rollbackTriggered,
            stages:           (r.stages || []).map(s => ({ name: s.name, state: s.state })),
            createdAt:        r.createdAt,
            completedAt:      r.completedAt || null,
            durationMs:       r.completedAt ? r.completedAt - r.createdAt : null,
        })),
    };
}

/**
 * Recovery chain availability for deployment failures.
 */
function recoveryChainStatus() {
    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    const chains   = _tryRequire("./executionChainPlanner.cjs");
    if (!pipeline) return { available: false };

    const pipelines = pipeline.listPipelines();
    return {
        available: true,
        pipelines: pipelines.map(p => ({
            name:          p.name,
            rollbackChain: p.rollbackChain,
            chainExists:   chains ? chains.listTemplates().some(t => t.id === p.rollbackChain) : null,
        })),
    };
}

module.exports = { snapshot, deploymentTimeline, recoveryChainStatus };
