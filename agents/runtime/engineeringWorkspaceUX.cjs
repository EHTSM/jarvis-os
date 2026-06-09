"use strict";
/**
 * Phase 722 — Engineering Workspace UX
 *
 * Workspace readability, operational calmness, replay navigation,
 * deployment visibility, debugging clarity, multi-project switching.
 * Reduces: visual clutter, operator fatigue, warning overload.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Workspace readability index ───────────────────────────────────────────────

function workspaceReadabilityIndex() {
    const sections = [];

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) { try { sections.push({ section: "one-click-flows", count: ocf.catalogOneClickFlows().length }); } catch {} }

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) { try { sections.push({ section: "productivity-chains", count: epc.catalogProductivityChains().length }); } catch {} }

    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) { try { sections.push({ section: "automations", count: dea.catalogAutomations2().length }); } catch {} }

    const total = sections.reduce((s, r) => s + r.count, 0);
    const score = Math.min(100, total * 4);
    return { ok: true, sections, total, score, readable: total > 0, level: score >= 60 ? "readable" : "sparse" };
}

// ── Operational calmness ──────────────────────────────────────────────────────

function workspaceCalmnessScore() {
    let score = 100;
    const factors = [];

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (ecc) {
        try {
            const d = ecc.commandCenterDashboard();
            if (d.criticalCount > 0) { score -= 30 * Math.min(d.criticalCount, 2); factors.push({ factor: "criticals", count: d.criticalCount, impact: -30 }); }
            if (d.warningCount  > 3) { score -= 10; factors.push({ factor: "warning-overload", count: d.warningCount, impact: -10 }); }
            if (d.panels?.workflows?.count > 10) { score -= 15; factors.push({ factor: "workflow-overload", count: d.panels.workflows.count, impact: -15 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "calm" : score >= 60 ? "moderate" : "overloaded", factors };
}

// ── Replay navigation ─────────────────────────────────────────────────────────

function replayNavigationSummary() {
    const entries = [];

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            const list = lhpc.listProductivitySessions({ limit: 5 });
            list.forEach(s => entries.push({ source: "productivity", id: s.sessionId, goal: s.goal, progress: s.progress }));
        } catch {}
    }

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const list = lhwc.listWorkspaceSessions({ limit: 5 });
            list.forEach(s => entries.push({ source: "workspace", id: s.sessionId, goal: s.goal, progress: s.progress }));
        } catch {}
    }

    const total = entries.length;
    return { ok: true, entries: entries.slice(0, 8), total, navigable: total > 0, detail: `${total} replay session(s) navigable` };
}

// ── Deployment visibility ─────────────────────────────────────────────────────

function deploymentVisibilitySummary() {
    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    const ecc = _tryRequire("./engineeringCommandCenter.cjs");

    let readiness = null, status = null;
    if (rdw) { try { readiness = rdw.scanEnvironmentReadiness("production"); } catch {} }
    if (ecc) { try { status = ecc.deploymentStatusPanel(); } catch {} }

    return {
        ok:    status?.ok !== false,
        stage: status?.stage || "unknown",
        trust: status?.trust || "unknown",
        ready: readiness?.ready || false,
        checks: readiness?.checks?.length || 0,
        detail: `Deployment: stage=${status?.stage || "?"} trust=${status?.trust || "?"} ready=${readiness?.ready}`,
    };
}

// ── Debugging clarity ─────────────────────────────────────────────────────────

function debuggingClaritySummary() {
    const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
    if (!rdf) return { ok: true, skipped: true, clarity: "unknown" };

    try {
        const health = rdf.debugRuntimeHealthCheck();
        const clarity = health.readyForDebugging ? "clear" : "degraded";
        return {
            ok: health.ok !== false, readyForDebug: health.readyForDebugging, clarity,
            checks: health.results?.length || 0,
            passing: health.results?.filter(r => r.ok !== false).length || 0,
            detail: `Debug clarity: ${clarity}`,
        };
    } catch (e) { return { ok: false, error: e.message, clarity: "unknown" }; }
}

// ── Multi-project switching ───────────────────────────────────────────────────

function multiProjectSwitchSummary() {
    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    if (!mpci) return { ok: true, skipped: true, projects: [] };

    try {
        const projects = mpci.listProjects();
        return {
            ok:         true,
            count:      projects.length,
            projects:   projects.slice(0, 5).map(p => ({ projectId: p.projectId, latestGoal: p.latestGoal || "" })),
            switchable: projects.length > 1,
            detail:     `${projects.length} project(s) available for switching`,
        };
    } catch (e) { return { ok: false, error: e.message }; }
}

// ── Suppress warning overload ─────────────────────────────────────────────────

function suppressWarningOverload(warnings = []) {
    const seen = new Map();
    const filtered = [];
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const sorted = [...warnings].sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

    sorted.forEach(w => {
        const key = `${w.type || w.check || w.factor}:${(w.message || w.msg || "").slice(0, 60)}`;
        if (!seen.has(key)) { seen.set(key, true); filtered.push(w); }
    });

    const capped     = filtered.slice(0, 5);
    const suppressed = warnings.length - capped.length;
    return { ok: true, warnings: capped, suppressed, original: warnings.length, detail: `Showing ${capped.length}/${warnings.length} warnings` };
}

// ── Full workspace UX report ──────────────────────────────────────────────────

function workspaceUXReport() {
    const readability = workspaceReadabilityIndex();
    const calmness    = workspaceCalmnessScore();
    const replay      = replayNavigationSummary();
    const deployment  = deploymentVisibilitySummary();
    const debugging   = debuggingClaritySummary();
    const projects    = multiProjectSwitchSummary();

    const avgScore = Math.round((readability.score + calmness.score) / 2);
    return {
        ok:          calmness.score >= 60,
        avgScore,
        readability: { score: readability.score, total: readability.total },
        calmness:    { score: calmness.score, level: calmness.level },
        replay:      { total: replay.total, navigable: replay.navigable },
        deployment:  { trust: deployment.trust, ready: deployment.ready },
        debugging:   { clarity: debugging.clarity },
        projects:    { count: projects.count, switchable: projects.switchable },
        summary:     `Workspace UX: score=${avgScore} calm=${calmness.level} replays=${replay.total} projects=${projects.count}`,
    };
}

module.exports = { workspaceReadabilityIndex, workspaceCalmnessScore, replayNavigationSummary, deploymentVisibilitySummary, debuggingClaritySummary, multiProjectSwitchSummary, suppressWarningOverload, workspaceUXReport };
