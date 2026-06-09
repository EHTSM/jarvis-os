"use strict";
/**
 * Phase 716 — Engineering UX Refinement
 *
 * Operational calmness, execution readability, replay navigation,
 * workflow discoverability, deployment visibility, debugging clarity.
 * Reduces: visual clutter, repetitive warnings, operator overload.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Operational calmness index ────────────────────────────────────────────────

function operationalCalmnessIndex() {
    let score = 100;
    const factors = [];

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (ecc) {
        try {
            const dashboard = ecc.commandCenterDashboard();
            if (dashboard.criticalCount > 0) { score -= 30 * Math.min(dashboard.criticalCount, 2); factors.push({ factor: "critical-signals", count: dashboard.criticalCount, impact: -30 }); }
            if (dashboard.warningCount  > 2) { score -= 10; factors.push({ factor: "warning-overload", count: dashboard.warningCount, impact: -10 }); }
            if (dashboard.panels.workflows.count > 8) { score -= 10; factors.push({ factor: "workflow-overload", count: dashboard.panels.workflows.count, impact: -10 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "calm" : score >= 60 ? "moderate" : "overloaded", factors };
}

// ── Execution readability score ───────────────────────────────────────────────

function executionReadabilityScore() {
    const sections = [];

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) { try { sections.push({ section: "productivity-chains", count: epc.catalogProductivityChains().length }); } catch {} }

    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) { try { sections.push({ section: "automations", count: dea.catalogAutomations2().length }); } catch {} }

    const deef = _tryRequire("./dailyEngineeringEnvironmentFlows.cjs");
    if (deef) { try { sections.push({ section: "env-flows", count: deef.catalogEnvFlows().length }); } catch {} }

    const total = sections.reduce((s, r) => s + (r.count || 0), 0);
    return {
        ok:       true,
        sections,
        totalWorkflows: total,
        readable: sections.length > 0,
        score:    Math.min(100, total * 5),
        summary:  `Readability: ${total} workflows catalogued across ${sections.length} sections`,
    };
}

// ── Replay navigation quality ─────────────────────────────────────────────────

function replayNavigationQuality() {
    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");

    let workspaceSessions = 0, productivitySessions = 0;

    if (lhwc) { try { workspaceSessions = lhwc.listWorkspaceSessions({ limit: 20 }).length; } catch {} }
    if (lhpc) { try { productivitySessions = lhpc.listProductivitySessions({ limit: 20 }).length; } catch {} }

    const total = workspaceSessions + productivitySessions;
    const score = Math.min(100, total * 10);
    return {
        ok:           true,
        score,
        workspaceSessions,
        productivitySessions,
        total,
        navigable:    total > 0,
        level:        score >= 60 ? "navigable" : "sparse",
        detail:       `Replay navigation: ${total} sessions available (workspace=${workspaceSessions} productivity=${productivitySessions})`,
    };
}

// ── Workflow discoverability ──────────────────────────────────────────────────

function workflowDiscoverability() {
    const categories = [];

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) { try { const c = epc.catalogProductivityChains(); categories.push({ category: "productivity-chains", count: c.length, types: c.map(x => x.type) }); } catch {} }

    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) { try { const c = dea.catalogAutomations2(); categories.push({ category: "automations", count: c.length, types: c.map(x => x.type) }); } catch {} }

    const desf = _tryRequire("./dailyEngineeringStrategyFlows.cjs");
    if (desf) { try { const c = desf.catalogFlows(); categories.push({ category: "strategy-flows", count: c.length, types: c.map(x => x.type) }); } catch {} }

    const totalWorkflows = categories.reduce((s, c) => s + c.count, 0);
    return {
        ok:             true,
        categories,
        totalWorkflows,
        discoverable:   totalWorkflows > 0,
        score:          Math.min(100, totalWorkflows * 4),
        detail:         `Discoverability: ${totalWorkflows} workflows across ${categories.length} categories`,
    };
}

// ── Deployment visibility ─────────────────────────────────────────────────────

function deploymentVisibility() {
    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (!ecc) return { ok: true, skipped: true };

    try {
        const deploy = ecc.deploymentStatusPanel();
        const rdw    = _tryRequire("./rapidDeploymentWorkflows.cjs");
        let readiness = null;
        if (rdw) { try { readiness = rdw.scanEnvironmentReadiness("production"); } catch {} }

        return {
            ok:            deploy.ok !== false,
            stage:         deploy.stage,
            trust:         deploy.trust,
            envReady:      readiness?.ready,
            visible:       true,
            detail:        `Deployment visible: stage=${deploy.stage} trust=${deploy.trust} ready=${readiness?.ready}`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Debugging clarity ─────────────────────────────────────────────────────────

function debuggingClarity() {
    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (!rdf) return { ok: true, skipped: true };

    try {
        const health  = rdf.debugRuntimeHealthCheck();
        const clarity = health.readyForDebugging ? "clear" : "degraded";
        return {
            ok:             health.ok !== false,
            readyForDebug:  health.readyForDebugging,
            checks:         health.results?.length || 0,
            clarity,
            detail:         `Debugging clarity: ${clarity} (${health.results?.filter(r => r.ok !== false).length || 0}/${health.results?.length || 0} checks passing)`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Full UX refinement report ─────────────────────────────────────────────────

function uxRefinementReport() {
    const calmness      = operationalCalmnessIndex();
    const readability   = executionReadabilityScore();
    const replay        = replayNavigationQuality();
    const discoverability = workflowDiscoverability();
    const deployment    = deploymentVisibility();
    const debugging     = debuggingClarity();

    const avgScore = Math.round((calmness.score + readability.score + replay.score) / 3);

    return {
        ok:             calmness.score >= 60,
        avgScore,
        calmness:       { score: calmness.score, level: calmness.level },
        readability:    { score: readability.score, totalWorkflows: readability.totalWorkflows },
        replay:         { score: replay.score, total: replay.total, navigable: replay.navigable },
        discoverability:{ totalWorkflows: discoverability.totalWorkflows, discoverable: discoverability.discoverable },
        deployment:     { trust: deployment.trust, visible: deployment.visible },
        debugging:      { clarity: debugging.clarity, ready: debugging.readyForDebug },
        summary:        `UX refinement: score=${avgScore} calm=${calmness.level} replays=${replay.total} workflows=${discoverability.totalWorkflows}`,
    };
}

module.exports = { operationalCalmnessIndex, executionReadabilityScore, replayNavigationQuality, workflowDiscoverability, deploymentVisibility, debuggingClarity, uxRefinementReport };
