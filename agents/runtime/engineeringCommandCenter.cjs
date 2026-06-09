"use strict";
/**
 * Phase 709 — Engineering Command Center
 *
 * Unified operational dashboard: runtime health, deployment status,
 * replay activity, active workflows, unstable environments, recovery recommendations.
 * Low-noise. Operational calmness. Replay discoverability.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Runtime health panel ──────────────────────────────────────────────────────

function runtimeHealthPanel() {
    const signals = [];
    let healthy   = true;

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const h = lhwc.workspaceContinuityHealth();
            if (h.storm) { signals.push({ source: "workspace", severity: "critical", msg: "Reconnect storm" }); healthy = false; }
            if (h.staleSessions > 3) signals.push({ source: "workspace", severity: "warning", msg: `${h.staleSessions} stale sessions` });
        } catch {}
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            if (!unstable.stable) {
                unstable.issues.forEach(i => signals.push({ source: "coordination", severity: i.severity || "warning", msg: i.factor }));
                if (unstable.critical > 0) healthy = false;
            }
        } catch {}
    }

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            if (summary.interrupted > 0) signals.push({ source: "cross-env", severity: "warning", msg: `${summary.interrupted} interrupted context(s)` });
        } catch {}
    }

    return { ok: healthy, signals, detail: healthy ? "Runtime healthy" : `${signals.filter(s => s.severity === "critical").length} critical issue(s)` };
}

// ── Deployment status panel ───────────────────────────────────────────────────

function deploymentStatusPanel() {
    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (!dec) return { ok: true, skipped: true, stage: "unknown", trust: "unknown" };

    try {
        const summary = dec.deploymentStateSummary("");
        const trust   = dec.deploymentTrustIndicator("");
        return {
            ok:    trust.indicator !== "red",
            stage: summary.stage,
            trust: trust.indicator,
            ready: summary.readiness,
            detail: `Deployment: stage=${summary.stage} trust=${trust.indicator}`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Replay activity panel ─────────────────────────────────────────────────────

function replayActivityPanel({ limit = 5 } = {}) {
    const sessions = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const list = lhwc.listWorkspaceSessions({ limit });
            list.forEach(s => sessions.push({ source: "workspace", id: s.sessionId, goal: s.goal, progress: s.progress, stale: s.ageMs > 48 * 60 * 60 * 1000 }));
        } catch {}
    }

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    if (mpci) {
        try {
            const projects = mpci.listProjects();
            sessions.push(...projects.slice(0, 3).map(p => ({ source: "project", id: p.projectId, goal: p.latestGoal || "", stale: false })));
        } catch {}
    }

    return { ok: true, sessions: sessions.slice(0, limit), count: sessions.length, discoverable: sessions.length > 0, detail: `${sessions.length} replay session(s) discoverable` };
}

// ── Active workflows panel ────────────────────────────────────────────────────

function activeWorkflowsPanel() {
    const workflows = [];

    const deef = _tryRequire("./dailyEngineeringEnvironmentFlows.cjs");
    if (deef) {
        try {
            const running = deef.listEnvFlows({ status: "running" });
            running.forEach(f => workflows.push({ type: "env-flow", id: f.flowId, flowType: f.flowType, step: f.currentStep, total: f.stepCount }));
        } catch {}
    }

    const desf = _tryRequire("./dailyEngineeringStrategyFlows.cjs");
    if (desf) {
        try {
            const running = desf.listFlows({ status: "running" });
            running.forEach(f => workflows.push({ type: "strategy-flow", id: f.flowId, flowType: f.flowType, step: f.currentStep, total: f.stepCount }));
        } catch {}
    }

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    if (dec) {
        try {
            const running = dec.listRuns({ status: "running" });
            running.forEach(r => workflows.push({ type: "coord-sequence", id: r.runId, flowType: r.sequenceType, step: r.currentStep, total: r.stepCount }));
        } catch {}
    }

    return { ok: true, workflows, count: workflows.length, detail: `${workflows.length} active workflow(s)` };
}

// ── Unstable environments panel ───────────────────────────────────────────────

function unstableEnvironmentsPanel() {
    const unstable = [];

    const boc = _tryRequire("./browserOperationCoordination.cjs");
    if (boc) {
        try {
            const stale = boc.detectStaleBrowserSessions();
            if (stale.staleCount > 0) unstable.push({ env: "browser", issue: "stale-sessions", count: stale.staleCount, severity: "warning" });
        } catch {}
    }

    const vei = _tryRequire("./vsCodeExecutionIntelligence.cjs");
    if (vei) {
        try {
            const stale = vei.detectStaleFiles();
            if (stale.staleCount > 0) unstable.push({ env: "vscode", issue: "stale-files", count: stale.staleCount, severity: "info" });
        } catch {}
    }

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            if (summary.interrupted > 0) unstable.push({ env: "cross-env", issue: "interrupted-contexts", count: summary.interrupted, severity: "warning" });
        } catch {}
    }

    return { ok: unstable.filter(u => u.severity === "critical").length === 0, unstable, count: unstable.length, detail: `${unstable.length} unstable environment(s)` };
}

// ── Recovery recommendations panel ───────────────────────────────────────────

function recoveryRecommendationsPanel() {
    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (!odc) return { ok: true, skipped: true, recommendations: [] };

    try {
        const flows = odc.recommendSaferOperationalFlows({ riskLevel: "unknown", trustScore: 70 });
        return {
            ok:              true,
            recommendations: (flows.recommendations || []).slice(0, 3),
            primary:         flows.primary?.id || null,
            detail:          `Recovery: ${flows.count} recommendation(s)`,
        };
    } catch (e) {
        return { ok: false, error: e.message, recommendations: [] };
    }
}

// ── Full command center dashboard ─────────────────────────────────────────────

function commandCenterDashboard() {
    const runtime    = runtimeHealthPanel();
    const deployment = deploymentStatusPanel();
    const replay     = replayActivityPanel();
    const workflows  = activeWorkflowsPanel();
    const envs       = unstableEnvironmentsPanel();
    const recovery   = recoveryRecommendationsPanel();

    // Low-noise: only surface critical + warning signals
    const criticalCount = runtime.signals?.filter(s => s.severity === "critical").length || 0;
    const warningCount  = runtime.signals?.filter(s => s.severity === "warning").length  || 0;

    const calm = criticalCount === 0 && warningCount <= 2;

    return {
        ok:         runtime.ok,
        calm,
        panels: {
            runtime:    { ok: runtime.ok,    signals: runtime.signals?.length || 0 },
            deployment: { ok: deployment.ok, stage: deployment.stage, trust: deployment.trust },
            replay:     { count: replay.count, discoverable: replay.discoverable },
            workflows:  { count: workflows.count },
            envs:       { unstable: envs.count },
            recovery:   { primary: recovery.primary },
        },
        criticalCount,
        warningCount,
        summary: `Command center: calm=${calm} critical=${criticalCount} warnings=${warningCount} workflows=${workflows.count} replays=${replay.count}`,
    };
}

module.exports = { runtimeHealthPanel, deploymentStatusPanel, replayActivityPanel, activeWorkflowsPanel, unstableEnvironmentsPanel, recoveryRecommendationsPanel, commandCenterDashboard };
