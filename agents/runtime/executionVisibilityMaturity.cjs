"use strict";
/**
 * Phase 757 — Execution Visibility Maturity
 *
 * Operator-visible workflow progression, deployment stages, replay state,
 * runtime health summaries, recovery recommendations, rollback readiness.
 * Low-noise, explainable execution state.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function workflowProgressSummary() {
    const items = [];

    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    // deployment sessions tracked elsewhere; structural check only
    if (dee) items.push({ domain: "deployment", available: true });

    const dse = _tryRequire("./realDebugSessionExperience.cjs");
    if (dse) items.push({ domain: "debugging", available: true });

    const wee = _tryRequire("./engineeringWorkspaceExperience.cjs");
    if (wee) {
        try {
            const s = wee.workspaceExperienceSummary();
            items.push({ domain: "workspace", available: true, projects: s.projectCount });
        } catch {}
    }

    return { ok: true, domains: items, count: items.length, summary: `Workflow domains tracked: ${items.length}` };
}

function replayStateSummary() {
    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (!lss) return { ok: false, reason: "survivability module unavailable" };
    try {
        const health = lss.survivabilityHealth();
        return {
            ok:           !health.storm,
            storm:        health.storm,
            staleSessions: health.staleSessions || 0,
            activeCount:  health.activeCount  || 0,
            summary:      `Replay state: storm=${health.storm} stale=${health.staleSessions || 0}`,
        };
    } catch (e) { return { ok: false, error: e.message }; }
}

function runtimeHealthSummary() {
    const results = [];

    const mods = [
        { name: "longSessionSurvivability",     fn: "survivabilityHealth",       key: "survivability" },
        { name: "engineeringCommandCenter",      fn: "commandCenterDashboard",    key: "commandCenter" },
        { name: "deploymentProductivityMaturity",fn: "rollbackReadinessAssessment", key: "rollback" },
    ];

    mods.forEach(({ name, fn, key }) => {
        const m = _tryRequire(`./${name}.cjs`);
        if (!m || !m[fn]) return;
        try {
            const r = m[fn]("");
            results.push({ key, ok: r.ok !== false, detail: r.summary || r.level || "ok" });
        } catch {}
    });

    const allOk = results.every(r => r.ok !== false);
    return { ok: allOk, checks: results, summary: `Runtime health: ${results.filter(r => r.ok).length}/${results.length} OK` };
}

function recoveryRecommendations() {
    const recs = [];

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const h = lss.survivabilityHealth();
            if (h.storm) recs.push({ action: "resolve-survivability-storm", priority: "critical" });
            if (h.staleSessions > 3) recs.push({ action: "prune-stale-sessions", priority: "warning" });
        } catch {}
    }

    const emr = _tryRequire("./engineeringMemoryRefinement.cjs");
    if (emr) {
        try {
            const s = emr.memoryRefinementStats();
            if (s.suppressed > 20) recs.push({ action: "review-suppressed-patterns", priority: "info" });
        } catch {}
    }

    return { ok: recs.filter(r => r.priority === "critical").length === 0, recommendations: recs, count: recs.length };
}

function rollbackReadinessIndicator() {
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (!dpm) return { ok: false, ready: false, reason: "deployment module unavailable" };
    try {
        const r = dpm.rollbackReadinessAssessment("");
        return { ok: r.rollbackReady, ready: r.rollbackReady, confidence: r.confidence, summary: `Rollback: ${r.rollbackReady ? "READY" : "NOT READY"} (${r.confidence})` };
    } catch (e) { return { ok: false, error: e.message }; }
}

function executionVisibilityReport() {
    const workflows = workflowProgressSummary();
    const replay    = replayStateSummary();
    const runtime   = runtimeHealthSummary();
    const recovery  = recoveryRecommendations();
    const rollback  = rollbackReadinessIndicator();

    const allOk = workflows.ok && replay.ok && runtime.ok && recovery.ok;

    return {
        ok: allOk,
        workflows: { domains: workflows.count },
        replay:    { storm: replay.storm, stale: replay.staleSessions },
        runtime:   { checksOk: runtime.checks.filter(c => c.ok).length, total: runtime.checks.length },
        recovery:  { recommendations: recovery.count },
        rollback:  { ready: rollback.ready, confidence: rollback.confidence },
        summary:   `Execution visibility: ${allOk ? "CLEAR" : "ISSUES"} — workflows=${workflows.count} replay.storm=${replay.storm} rollback=${rollback.ready ? "ready" : "not-ready"}`,
    };
}

module.exports = { workflowProgressSummary, replayStateSummary, runtimeHealthSummary, recoveryRecommendations, rollbackReadinessIndicator, executionVisibilityReport };
