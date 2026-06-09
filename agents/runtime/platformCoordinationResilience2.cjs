"use strict";
/**
 * Phase 703 — Platform Coordination Resilience (Multi-Environment)
 *
 * Execution continuity, replay survivability, deployment rollback integrity,
 * runtime-state coordination, workflow isolation, recovery reliability.
 * Strengthens the 691-702 multi-environment range.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── 1. Execution continuity ───────────────────────────────────────────────────

function checkExecutionContinuity() {
    const signals = [];
    let ok = true;

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            if (summary.interrupted > 0) { signals.push({ check: "cross-env-interrupted", count: summary.interrupted, severity: "warning" }); ok = false; }
        } catch { signals.push({ check: "cross-env-exec-unavailable", severity: "warning" }); }
    }

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const health = lhwc.workspaceContinuityHealth();
            if (health.storm) { signals.push({ check: "workspace-reconnect-storm", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Execution continuity intact" : `${signals.length} continuity signal(s)` };
}

// ── 2. Replay survivability ───────────────────────────────────────────────────

function checkReplaySurvivability() {
    const signals = [];
    let ok = true;

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const durability = lhwc.assessCrossEnvReplayDurability();
            if (!durability.durable) {
                durability.signals?.forEach(s => signals.push(s));
                ok = false;
            }
        } catch { signals.push({ check: "workspace-durability-unavailable", severity: "warning" }); }
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const r = lhs.assessReplayDurability("platform-703");
            if (!r.durable) { signals.push({ check: "survivability-replay-fragile", severity: "warning" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Replay survivability intact" : `${signals.length} replay signal(s)` };
}

// ── 3. Deployment rollback integrity ─────────────────────────────────────────

function checkDeploymentRollbackIntegrity() {
    const signals = [];
    let ok = true;

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try {
            const report = dec.rollbackReadinessReport();
            if (report.ok === false) { signals.push({ check: "rollback-readiness-failed", severity: "critical" }); ok = false; }
            const trust = dec.deploymentTrustIndicator("");
            if (trust.indicator === "red") { signals.push({ check: "deployment-trust-red", severity: "critical" }); ok = false; }
            if (trust.indicator === "amber") { signals.push({ check: "deployment-trust-amber", severity: "warning" }); }
        } catch { signals.push({ check: "deploy-env-coord-unavailable", severity: "warning" }); }
    }

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (dse) {
        try {
            const risk = dse.operationalRiskReport();
            if (risk.riskLevel === "critical") { signals.push({ check: "strategy-risk-critical", severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Rollback integrity intact" : `${signals.length} rollback signal(s)` };
}

// ── 4. Runtime-state coordination ────────────────────────────────────────────

function checkRuntimeStateCoordination() {
    const signals = [];
    let ok = true;

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            if (!unstable.stable) {
                unstable.issues.filter(i => i.severity === "critical").forEach(i => {
                    signals.push({ check: `coordination-critical:${i.factor}`, severity: "critical" });
                    ok = false;
                });
                unstable.issues.filter(i => i.severity !== "critical").forEach(i => {
                    signals.push({ check: `coordination-warning:${i.factor}`, severity: "warning" });
                });
            }
        } catch { signals.push({ check: "odc-unavailable", severity: "warning" }); }
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const patterns = esi.detectUnstablePatterns();
            if (patterns.unstable) { signals.push({ check: "unstable-execution-patterns", count: patterns.patterns?.length, severity: "warning" }); }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Runtime-state coordination stable" : `${signals.length} state signal(s)` };
}

// ── 5. Workflow isolation ─────────────────────────────────────────────────────

function checkWorkflowIsolation() {
    const signals = [];
    let ok = true;

    const deef = _tryRequire("./dailyEngineeringEnvironmentFlows.cjs");
    if (deef) {
        try {
            const running = deef.listEnvFlows({ status: "running" });
            if (running.length > 5) { signals.push({ check: "too-many-concurrent-env-flows", count: running.length, severity: "warning" }); }
        } catch {}
    }

    const desf = _tryRequire("./dailyEngineeringStrategyFlows.cjs");
    if (desf) {
        try {
            const running = desf.listFlows({ status: "running" });
            if (running.length > 5) { signals.push({ check: "too-many-concurrent-strategy-flows", count: running.length, severity: "warning" }); }
        } catch {}
    }

    const tci = _tryRequire("./terminalCoordinationIntelligence.cjs");
    if (tci) {
        try {
            const conflicts = tci.checkProcessConflicts([]);
            if (conflicts.conflicts?.length > 0) { signals.push({ check: "terminal-process-conflicts", count: conflicts.conflicts.length, severity: "warning" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Workflow isolation intact" : `${signals.length} isolation signal(s)` };
}

// ── 6. Recovery reliability ───────────────────────────────────────────────────

function checkRecoveryReliability() {
    const signals = [];
    let ok = true;

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const r = arc.chooseRecoveryPath("platform-check");
            if (!r.ok) { signals.push({ check: "adaptive-recovery-unavailable", severity: "warning" }); ok = false; }
        } catch {}
    }

    const ewr = _tryRequire("./engineeringWorkspaceRestoration.cjs");
    if (ewr) {
        try {
            const summary = ewr.workspaceRestorationSummary();
            if (!summary.ok) { signals.push({ check: "workspace-restoration-failed", severity: "warning" }); ok = false; }
        } catch {}
    }

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    if (mpci) {
        try {
            const projects = mpci.listProjects();
            if (projects.length === 0) { signals.push({ check: "no-project-contexts", severity: "info" }); }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Recovery reliability intact" : `${signals.length} recovery signal(s)` };
}

// ── Full resilience report ────────────────────────────────────────────────────

function platformCoordinationResilience2Report() {
    const continuity  = checkExecutionContinuity();
    const replay      = checkReplaySurvivability();
    const rollback    = checkDeploymentRollbackIntegrity();
    const state       = checkRuntimeStateCoordination();
    const isolation   = checkWorkflowIsolation();
    const recovery    = checkRecoveryReliability();

    const dimensions = { continuity, replay, rollback, state, isolation, recovery };
    const allSignals  = Object.values(dimensions).flatMap(d => d.signals || []);
    const criticalCount = allSignals.filter(s => s.severity === "critical").length;
    const warningCount  = allSignals.filter(s => s.severity === "warning").length;

    const healthy = criticalCount === 0;

    return {
        ok:          healthy,
        healthy,
        criticalCount,
        warningCount,
        dimensions,
        summary:     `Platform coord resilience2: ${healthy ? "RESILIENT" : "DEGRADED"} — critical=${criticalCount} warnings=${warningCount}`,
    };
}

module.exports = { checkExecutionContinuity, checkReplaySurvivability, checkDeploymentRollbackIntegrity, checkRuntimeStateCoordination, checkWorkflowIsolation, checkRecoveryReliability, platformCoordinationResilience2Report };
