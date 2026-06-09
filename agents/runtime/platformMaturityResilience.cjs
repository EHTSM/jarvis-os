"use strict";
/**
 * Phase 733 — Platform Maturity Resilience
 *
 * Execution continuity, replay survivability, deployment rollback integrity,
 * runtime coordination, workflow isolation, recovery reliability.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function checkMaturityExecutionContinuity() {
    const signals = [];
    let ok = true;

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const health = lss.survivabilityHealth();
            if (health.storm) { signals.push({ check: "survivability-storm", severity: "critical" }); ok = false; }
            if (health.staleSessions > 3) signals.push({ check: "stale-survivability-sessions", count: health.staleSessions, severity: "warning" });
        } catch {}
    }

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            const h = lhpc.productivityContinuityHealth();
            if (h.storm) { signals.push({ check: "productivity-storm", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Maturity execution continuity intact" : `${signals.length} signal(s)` };
}

function checkMaturityReplaySurvivability() {
    const signals = [];
    let ok = true;

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const d = lss.assessSurvivabilityDurability();
            if (!d.durable) { d.signals?.forEach(s => signals.push(s)); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Replay survivability intact" : `${signals.length} signal(s)` };
}

function checkMaturityDeploymentRollback() {
    const signals = [];
    let ok = true;

    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (dpm) {
        try {
            const r = dpm.rollbackReadinessAssessment("");
            if (r.confidence === "low") { signals.push({ check: "rollback-confidence-low", severity: "warning" }); }
            if (!r.rollbackReady) { signals.push({ check: "rollback-not-ready", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Deployment rollback integrity intact" : `${signals.length} signal(s)` };
}

function checkMaturityRuntimeCoordination() {
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

function checkMaturityWorkflowIsolation() {
    const signals = [];
    let ok = true;

    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    if (mpem) {
        try {
            const projects = mpem.listProjects();
            projects.forEach(p => {
                try {
                    const cont = mpem.checkWorkflowContamination(p.projectId);
                    if (cont.contaminated) { signals.push({ check: `contamination:${p.projectId}`, severity: "critical" }); ok = false; }
                } catch {}
            });
        } catch {}
    }

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) {
        try {
            const running = ocf.listOneClickFlows({ status: "running" });
            if (running.length > 8) signals.push({ check: "too-many-active-flows", count: running.length, severity: "warning" });
        } catch {}
    }

    return { ok, signals, detail: ok ? "Workflow isolation intact" : `${signals.length} signal(s)` };
}

function checkMaturityRecoveryReliability() {
    const signals = [];
    let ok = true;

    const otr = _tryRequire("./operatorTrustRefinement.cjs");
    if (otr) {
        try {
            const recovery = otr.recoveryTrustScore();
            if (recovery.score < 50) { signals.push({ check: "low-recovery-trust", score: recovery.score, severity: "warning" }); }
        } catch {}
    }

    const emr = _tryRequire("./engineeringMemoryRefinement.cjs");
    if (emr) {
        try {
            const stats = emr.memoryRefinementStats();
            if (stats.total === 0) signals.push({ check: "no-memory-entries", severity: "info" });
        } catch {}
    }

    return { ok, signals, detail: ok ? "Recovery reliability intact" : `${signals.length} signal(s)` };
}

function platformMaturityResilienceReport() {
    const continuity   = checkMaturityExecutionContinuity();
    const replay       = checkMaturityReplaySurvivability();
    const rollback     = checkMaturityDeploymentRollback();
    const coordination = checkMaturityRuntimeCoordination();
    const isolation    = checkMaturityWorkflowIsolation();
    const recovery     = checkMaturityRecoveryReliability();

    const dimensions    = { continuity, replay, rollback, coordination, isolation, recovery };
    const allSignals    = Object.values(dimensions).flatMap(d => d.signals || []);
    const criticalCount = allSignals.filter(s => s.severity === "critical").length;
    const warningCount  = allSignals.filter(s => s.severity === "warning").length;
    const healthy       = criticalCount === 0;

    return {
        ok: healthy, healthy, criticalCount, warningCount, dimensions,
        summary: `Platform maturity resilience: ${healthy ? "RESILIENT" : "DEGRADED"} — critical=${criticalCount} warnings=${warningCount}`,
    };
}

module.exports = { checkMaturityExecutionContinuity, checkMaturityReplaySurvivability, checkMaturityDeploymentRollback, checkMaturityRuntimeCoordination, checkMaturityWorkflowIsolation, checkMaturityRecoveryReliability, platformMaturityResilienceReport };
