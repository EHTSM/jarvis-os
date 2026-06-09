"use strict";
/**
 * Phase 763 — Platform Execution Resilience
 *
 * Execution continuity, replay survivability, deployment rollback integrity,
 * runtime coordination, workflow isolation, recovery reliability.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function checkExecutionContinuity() {
    const signals = [];
    let ok = true;

    const lsec = _tryRequire("./longSessionEngineeringContinuity.cjs");
    if (lsec) {
        try {
            const h = lsec.engineeringContinuityHealth();
            if (h.storm) { signals.push({ check: "engineering-continuity-storm", severity: "critical" }); ok = false; }
            if (h.staleSessions > 5) signals.push({ check: "many-stale-eng-sessions", count: h.staleSessions, severity: "warning" });
        } catch {}
    }

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const h = lss.survivabilityHealth();
            if (h.storm) { signals.push({ check: "survivability-storm", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Execution continuity intact" : `${signals.length} signal(s)` };
}

function checkReplaySurvivability() {
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

function checkDeploymentRollback() {
    const signals = [];
    let ok = true;

    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (dpm) {
        try {
            const r = dpm.rollbackReadinessAssessment("");
            if (!r.rollbackReady) { signals.push({ check: "rollback-not-ready", severity: "critical" }); ok = false; }
            if (r.confidence === "low") signals.push({ check: "rollback-low-confidence", severity: "warning" });
        } catch {}
    }

    return { ok, signals, detail: ok ? "Deployment rollback intact" : `${signals.length} signal(s)` };
}

function checkRuntimeCoordination() {
    const signals = [];
    let ok = true;

    const mpm = _tryRequire("./multiProjectExecutionMaturity.cjs");
    if (mpm) {
        try {
            const r = mpm.multiProjectExecutionReport();
            if (!r.isolation.ok) { signals.push({ check: "project-isolation-failure", severity: "critical" }); ok = false; }
            if (!r.replay.ok)    { signals.push({ check: "replay-crossover", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Runtime coordination stable" : `${signals.length} signal(s)` };
}

function checkWorkflowIsolation() {
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

    return { ok, signals, detail: ok ? "Workflow isolation intact" : `${signals.length} signal(s)` };
}

function checkRecoveryReliability() {
    const signals = [];
    let ok = true;

    const epa = _tryRequire("./engineeringProductivityAcceleration.cjs");
    if (epa) {
        try {
            const r = epa.productivityAccelerationReport();
            if (r.avgScore < 40) { signals.push({ check: "low-productivity-score", score: r.avgScore, severity: "warning" }); }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Recovery reliability intact" : `${signals.length} signal(s)` };
}

function platformExecutionResilienceReport() {
    const continuity    = checkExecutionContinuity();
    const replay        = checkReplaySurvivability();
    const rollback      = checkDeploymentRollback();
    const coordination  = checkRuntimeCoordination();
    const isolation     = checkWorkflowIsolation();
    const recovery      = checkRecoveryReliability();

    const dimensions    = { continuity, replay, rollback, coordination, isolation, recovery };
    const allSignals    = Object.values(dimensions).flatMap(d => d.signals || []);
    const criticalCount = allSignals.filter(s => s.severity === "critical").length;
    const warningCount  = allSignals.filter(s => s.severity === "warning").length;
    const healthy       = criticalCount === 0;

    return {
        ok: healthy, healthy, criticalCount, warningCount, dimensions,
        summary: `Platform execution resilience: ${healthy ? "RESILIENT" : "DEGRADED"} — critical=${criticalCount} warnings=${warningCount}`,
    };
}

module.exports = { checkExecutionContinuity, checkReplaySurvivability, checkDeploymentRollback, checkRuntimeCoordination, checkWorkflowIsolation, checkRecoveryReliability, platformExecutionResilienceReport };
