"use strict";
/**
 * Phase 702 — Engineering Productivity Evolution
 *
 * Debugging flow, deployment clarity, replay discoverability,
 * execution calmness, workflow readability, operational visibility.
 * Reduces: workflow clutter, warning overload, operator fatigue.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Multi-environment debugging flow efficiency ───────────────────────────────

function multiEnvDebuggingEfficiency() {
    let score = 100;
    const factors = [];

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            if (summary.interrupted > 0) { score -= 10 * Math.min(summary.interrupted, 5); factors.push({ factor: "cross-env-interrupted", count: summary.interrupted, impact: -10 }); }
        } catch {}
    }

    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi) {
        try {
            const repeated = sdi.detectRepeatedFailures({ windowMs: 4 * 60 * 60 * 1000, minCount: 2 });
            if (repeated.count > 0) { score -= 15 * Math.min(repeated.count, 3); factors.push({ factor: "repeated-failures", count: repeated.count, impact: -15 }); }
        } catch {}
    }

    score = Math.max(0, score);
    return { ok: true, score, level: score >= 80 ? "efficient" : score >= 60 ? "moderate" : "inefficient", factors };
}

// ── Deployment clarity score ──────────────────────────────────────────────────

function deploymentClarityScore(deploymentId = "") {
    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (!dec) return { ok: true, skipped: true, score: 70, level: "unknown" };

    try {
        const summary = dec.deploymentStateSummary(deploymentId);
        const trust   = dec.deploymentTrustIndicator(deploymentId);

        let score = 70;
        if (summary.stage !== "unknown")          score += 10;
        if (trust.indicator === "green")           score += 20;
        if (trust.indicator === "amber")           score += 5;
        if (trust.indicator === "red")             score -= 20;
        if (summary.readiness === true)            score += 10;

        score = Math.max(0, Math.min(100, score));
        return { ok: true, score, level: score >= 80 ? "clear" : score >= 60 ? "moderate" : "unclear", stage: summary.stage, trustIndicator: trust.indicator };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Replay discoverability across environments ────────────────────────────────

function crossEnvReplayDiscoverability(goal = "") {
    const results = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const sessions = lhwc.listWorkspaceSessions({ limit: 3 });
            sessions.forEach(s => results.push({ source: "workspace-continuity", id: s.sessionId, goal: s.goal, progress: s.progress }));
        } catch {}
    }

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    if (mpci && goal) {
        try {
            const projects = mpci.listProjects();
            projects.forEach(p => {
                try {
                    const ctx = mpci.prioritizeProjectContext(p.projectId, goal);
                    if (ctx.count > 0) results.push({ source: `project:${p.projectId}`, id: ctx.primary?.ctxKey, goal: ctx.primary?.goal });
                } catch {}
            });
        } catch {}
    }

    return { ok: true, results: results.slice(0, 5), count: results.length, discoverable: results.length > 0, goal };
}

// ── Multi-environment calmness score ─────────────────────────────────────────

function multiEnvCalmnessScore() {
    let score = 100;
    const factors = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const health = lhwc.workspaceContinuityHealth();
            if (health.storm)               { score -= 30; factors.push({ factor: "reconnect-storm",    impact: -30 }); }
            if (health.staleSessions > 3)   { score -= 10; factors.push({ factor: "stale-sessions",    count: health.staleSessions, impact: -10 }); }
        } catch {}
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            const unstable = odc.detectUnstableCoordinationStates();
            if (!unstable.stable)           { score -= 15; factors.push({ factor: "coordination-unstable", count: unstable.issues.length, impact: -15 }); }
            if (unstable.critical > 0)      { score -= 20; factors.push({ factor: "critical-issues",      count: unstable.critical,      impact: -20 }); }
        } catch {}
    }

    score = Math.max(0, score);
    const level = score >= 80 ? "calm" : score >= 60 ? "moderate" : "stressed";
    return { ok: true, score, level, factors, summary: `Multi-env calmness: ${score}/100 (${level})` };
}

// ── Workflow readability across environments ──────────────────────────────────

function assessMultiEnvWorkflowReadability() {
    const sections = [];

    const desf = _tryRequire("./dailyEngineeringStrategyFlows.cjs");
    if (desf) { try { sections.push({ section: "strategy-flows", count: desf.catalogFlows().length }); } catch {} }

    const deef = _tryRequire("./dailyEngineeringEnvironmentFlows.cjs");
    if (deef) { try { sections.push({ section: "env-flows", count: deef.catalogEnvFlows().length }); } catch {} }

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    if (dec) { try { sections.push({ section: "eng-sequences", count: dec.catalogSequences().length }); } catch {} }

    return {
        ok:           true,
        sections,
        totalWorkflows: sections.reduce((sum, s) => sum + (s.count || 0), 0),
        readable:     sections.length > 0,
        summary:      `Multi-env readability: ${sections.reduce((s, r) => s + (r.count || 0), 0)} workflows catalogued`,
    };
}

// ── Operator visibility report ────────────────────────────────────────────────

function operatorVisibilityReport() {
    const calmness   = multiEnvCalmnessScore();
    const efficiency = multiEnvDebuggingEfficiency();
    const discov     = crossEnvReplayDiscoverability("");

    const spo = _tryRequire("./strategicProductivityOptimization.cjs");
    let fatigue = null;
    if (spo) { try { fatigue = spo.operatorFatigueScore(); } catch {} }

    return {
        ok:               true,
        calmness:         { score: calmness.score, level: calmness.level },
        debugEfficiency:  { score: efficiency.score, level: efficiency.level },
        replayCount:      discov.count,
        fatigueLevel:     fatigue?.level || "unknown",
        summary:          `Operator visibility: calmness=${calmness.level} debug=${efficiency.level} fatigue=${fatigue?.level || "?"} replays=${discov.count}`,
    };
}

// ── Full productivity evolution summary ───────────────────────────────────────

function productivityEvolutionSummary() {
    const calmness = multiEnvCalmnessScore();
    const deploy   = deploymentClarityScore("");
    const discov   = crossEnvReplayDiscoverability("");

    return {
        ok:               true,
        calmnessScore:    calmness.score,
        calmnessLevel:    calmness.level,
        deploymentClarity: deploy.level,
        replayCount:      discov.count,
        summary:          `Productivity evolution: calmness=${calmness.level} deploy=${deploy.level} replays=${discov.count}`,
    };
}

module.exports = { multiEnvDebuggingEfficiency, deploymentClarityScore, crossEnvReplayDiscoverability, multiEnvCalmnessScore, assessMultiEnvWorkflowReadability, operatorVisibilityReport, productivityEvolutionSummary };
