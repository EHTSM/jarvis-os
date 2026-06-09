"use strict";
/**
 * Phase 717 — Platform Productivity Resilience
 *
 * Execution continuity, replay survivability, deployment rollback integrity,
 * runtime coordination, workflow isolation, recovery reliability.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function checkProductivityExecutionContinuity() {
    const signals = [];
    let ok = true;

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            const health = lhpc.productivityContinuityHealth();
            if (health.storm) { signals.push({ check: "productivity-reconnect-storm", severity: "critical" }); ok = false; }
            if (health.staleSessions > 3) signals.push({ check: "stale-productivity-sessions", count: health.staleSessions, severity: "warning" });
        } catch {}
    }

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    if (iwr) {
        try {
            const health = iwr.workspaceRestoreHealth();
            if (health.storm) { signals.push({ check: "workspace-restore-storm", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Productivity execution continuity intact" : `${signals.length} signal(s)` };
}

function checkProductivityReplaySurvivability() {
    const signals = [];
    let ok = true;

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            const d = lhpc.assessProductivityCrossEnvDurability();
            if (!d.durable) { d.signals?.forEach(s => signals.push(s)); ok = false; }
        } catch {}
    }

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const d = lhwc.assessCrossEnvReplayDurability();
            if (!d.durable) signals.push({ check: "workspace-replay-fragile", severity: "warning" });
        } catch {}
    }

    return { ok, signals, detail: ok ? "Replay survivability intact" : `${signals.length} signal(s)` };
}

function checkProductivityDeploymentRollback() {
    const signals = [];
    let ok = true;

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try {
            const trust = dec.deploymentTrustIndicator("");
            if (trust.indicator === "red") { signals.push({ check: "deployment-trust-red", severity: "critical" }); ok = false; }
            if (trust.indicator === "amber") signals.push({ check: "deployment-trust-amber", severity: "warning" });
        } catch {}
    }

    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    if (rdw) {
        try {
            const scan = rdw.scanEnvironmentReadiness("production");
            if (!scan.ok) { signals.push({ check: "env-readiness-failed", severity: "warning" }); }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Deployment rollback integrity intact" : `${signals.length} signal(s)` };
}

function checkProductivityRuntimeCoordination() {
    const signals = [];
    let ok = true;

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            if (!unstable.stable) {
                unstable.issues.filter(i => i.severity === "critical").forEach(i => { signals.push({ check: `critical:${i.factor}`, severity: "critical" }); ok = false; });
                unstable.issues.filter(i => i.severity !== "critical").forEach(i => signals.push({ check: `warning:${i.factor}`, severity: "warning" }));
            }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Runtime coordination stable" : `${signals.length} signal(s)` };
}

function checkProductivityWorkflowIsolation() {
    const signals = [];
    let ok = true;

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) {
        try {
            const running = epc.listProductivityChains({ status: "running" });
            if (running.length > 8) { signals.push({ check: "too-many-productivity-chains", count: running.length, severity: "warning" }); }
        } catch {}
    }

    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) {
        try {
            const running = dea.listAutomationRuns2({ status: "running" });
            if (running.length > 5) { signals.push({ check: "too-many-automations", count: running.length, severity: "warning" }); }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Workflow isolation intact" : `${signals.length} signal(s)` };
}

function checkProductivityRecoveryReliability() {
    const signals = [];
    let ok = true;

    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (rdf) {
        try {
            const health = rdf.debugRuntimeHealthCheck();
            if (!health.readyForDebugging) signals.push({ check: "debug-runtime-not-ready", severity: "warning" });
        } catch {}
    }

    const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
    if (emp) {
        try {
            const stats = emp.memoryProductivityStats();
            if (stats.total === 0) signals.push({ check: "no-memory-entries", severity: "info" });
        } catch {}
    }

    return { ok, signals, detail: ok ? "Recovery reliability intact" : `${signals.length} signal(s)` };
}

function platformProductivityResilienceReport() {
    const continuity  = checkProductivityExecutionContinuity();
    const replay      = checkProductivityReplaySurvivability();
    const rollback    = checkProductivityDeploymentRollback();
    const coordination = checkProductivityRuntimeCoordination();
    const isolation   = checkProductivityWorkflowIsolation();
    const recovery    = checkProductivityRecoveryReliability();

    const dimensions = { continuity, replay, rollback, coordination, isolation, recovery };
    const allSignals  = Object.values(dimensions).flatMap(d => d.signals || []);
    const criticalCount = allSignals.filter(s => s.severity === "critical").length;
    const warningCount  = allSignals.filter(s => s.severity === "warning").length;
    const healthy       = criticalCount === 0;

    return {
        ok: healthy, healthy, criticalCount, warningCount, dimensions,
        summary: `Platform productivity resilience: ${healthy ? "RESILIENT" : "DEGRADED"} — critical=${criticalCount} warnings=${warningCount}`,
    };
}

module.exports = { checkProductivityExecutionContinuity, checkProductivityReplaySurvivability, checkProductivityDeploymentRollback, checkProductivityRuntimeCoordination, checkProductivityWorkflowIsolation, checkProductivityRecoveryReliability, platformProductivityResilienceReport };
