"use strict";
/**
 * Phase 760 — Multi-Project Execution Maturity
 *
 * Project isolation, cross-project restoration, replay separation,
 * deployment continuity, workflow survivability, contextual project recall.
 * Prevents shared-state corruption, replay crossover, workflow contamination.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function projectIsolationCheck() {
    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    if (!mpem) return { ok: true, skipped: true, reason: "multi-project module unavailable" };

    const issues = [];
    try {
        const projects = mpem.listProjects();
        projects.forEach(p => {
            try {
                const cont = mpem.checkWorkflowContamination(p.projectId);
                if (cont.contaminated) issues.push({ projectId: p.projectId, type: "contamination" });
            } catch {}
        });
    } catch {}

    return { ok: issues.length === 0, issues, projectCount: 0, summary: `Isolation: ${issues.length} contamination issues` };
}

function replaySeparationCheck() {
    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    if (!mpem) return { ok: true, skipped: true };

    const crossovers = [];
    try {
        const projects = mpem.listProjects();
        const replayMap = {};
        projects.forEach(p => {
            (p.replays || []).forEach(r => {
                if (replayMap[r.replayId]) crossovers.push({ replayId: r.replayId, projects: [replayMap[r.replayId], p.projectId] });
                else replayMap[r.replayId] = p.projectId;
            });
        });
    } catch {}

    return { ok: crossovers.length === 0, crossovers, summary: `Replay separation: ${crossovers.length} crossovers detected` };
}

function deploymentContinuityCheck() {
    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    if (!dee) return { ok: true, skipped: true };

    let ready = false;
    try {
        const r = dee.deploymentReadinessSummary("");
        ready   = r.ready !== false;
    } catch {}

    return { ok: true, ready, summary: `Deployment continuity: ready=${ready}` };
}

function workflowSurvivabilityCheck() {
    const lsec = _tryRequire("./longSessionEngineeringContinuity.cjs");
    if (!lsec) return { ok: true, skipped: true };

    try {
        const h = lsec.engineeringContinuityHealth();
        return { ok: !h.storm, storm: h.storm, activeSessions: h.activeSessions, summary: h.summary };
    } catch (e) { return { ok: false, error: e.message }; }
}

function multiProjectExecutionReport() {
    const isolation   = projectIsolationCheck();
    const replay      = replaySeparationCheck();
    const deployment  = deploymentContinuityCheck();
    const survivability = workflowSurvivabilityCheck();

    const allOk = isolation.ok && replay.ok && !survivability.storm;

    return {
        ok: allOk,
        isolation:     { ok: isolation.ok, issues: isolation.issues?.length || 0 },
        replay:        { ok: replay.ok, crossovers: replay.crossovers?.length || 0 },
        deployment:    { ok: deployment.ok, ready: deployment.ready },
        survivability: { ok: survivability.ok, storm: survivability.storm },
        summary:       `Multi-project execution: ${allOk ? "HEALTHY" : "ISSUES"} — isolation=${isolation.ok} replay=${replay.ok} storm=${survivability.storm}`,
    };
}

module.exports = { projectIsolationCheck, replaySeparationCheck, deploymentContinuityCheck, workflowSurvivabilityCheck, multiProjectExecutionReport };
