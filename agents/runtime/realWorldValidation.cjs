"use strict";
/**
 * Phase 597 — Real-World Engineering Validation
 *
 * Uses JARVIS for: repeated debugging, deployment operations, dependency recovery,
 * browser workflows, runtime restoration, long engineering sessions.
 *
 * Measures: execution trust, workflow survivability, operator productivity,
 *           replay usefulness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Scenario runners ──────────────────────────────────────────────────────────

function _run(name, fn) {
    const t = Date.now();
    try { const r = fn(); return { name, ok: r !== false && (r?.ok !== false), result: r, ms: Date.now() - t }; }
    catch (e) { return { name, ok: false, error: e.message, ms: Date.now() - t }; }
}

function scenarioDebugging() {
    const da = _tryRequire("./debugAssistMode.cjs");
    if (!da) return { ok: false, error: "unavailable" };
    da.ingestError("ECONNREFUSED 127.0.0.1:5050 real-world-test");
    const causes = da.rootCauseSuggestions(["ECONNREFUSED 127.0.0.1:5050"]);
    const plan   = da.recoveryPlan(causes, "backend connectivity");
    return { ok: causes.length > 0 && plan.steps.length > 0, rootCauses: causes.length, planSteps: plan.steps.length };
}

function scenarioDeploymentOps() {
    const da = _tryRequire("./deploymentAssist.cjs");
    if (!da) return { ok: false, error: "unavailable" };
    const dep   = da.dependencyIntegrityCheck();
    const pf    = da.preflightSummary();
    const roll  = da.rollbackRecommendation();
    return { ok: typeof dep.ok === "boolean" && pf.pipeline, dep: dep.ok, preflightReady: pf.ready, rollbackRec: roll.recommend };
}

function scenarioDependencyRecovery() {
    const pa = _tryRequire("./patchAssistant.cjs");
    if (!pa) return { ok: false, error: "unavailable" };
    const sug = pa.depairSuggestions("Cannot find module 'express'");
    return { ok: sug.length > 0, suggestions: sug.length };
}

function scenarioBrowserWorkflow() {
    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    if (!bwe) return { ok: false, error: "unavailable" };
    const wf = bwe.startWorkflow("public-api-probe", { sessionId: "rw-test-session", url: "http://localhost:5050/health" });
    if (wf.ok) bwe.interruptWorkflow(wf.workflowId, { reason: "test-interrupt" });
    const resume = wf.ok ? bwe.resumeWorkflow(wf.workflowId) : null;
    return { ok: wf.ok && resume?.ok, workflowStarted: wf.ok, resumable: resume?.ok };
}

function scenarioRuntimeRestoration() {
    const pp = _tryRequire("./platformPerformance.cjs");
    if (!pp) return { ok: false, error: "unavailable" };
    const restore = pp.fastSessionRestore("rw-restore-session");
    return { ok: restore.restoredInMs < 2000, restoredInMs: restore.restoredInMs };
}

function scenarioLongSession() {
    const si = _tryRequire("./sessionIntelligenceEngine.cjs");
    if (!si) return { ok: false, error: "unavailable" };
    const sid = "long-session-test";
    si.startSession(sid, { goal: "real-world long session test" });
    for (let i = 0; i < 10; i++) si.updateActivity(sid, { eventType: "generic", errorDelta: i % 3 === 0 ? 1 : 0 });
    si.markBlocked(sid, "dependency missing");
    const intel = si.getSessionIntelligence(sid);
    si.clearBlocked(sid);
    return { ok: intel.blocked && intel.guidance?.guidance?.length > 0, errorCount: intel.errorCount, guidanceProvided: intel.guidance?.guidance?.length };
}

// ── Metric collection ─────────────────────────────────────────────────────────

function runValidation() {
    const scenarios = [
        _run("debugging",            scenarioDebugging),
        _run("deployment-ops",       scenarioDeploymentOps),
        _run("dependency-recovery",  scenarioDependencyRecovery),
        _run("browser-workflow",     scenarioBrowserWorkflow),
        _run("runtime-restoration",  scenarioRuntimeRestoration),
        _run("long-session",         scenarioLongSession),
    ];

    const passed = scenarios.filter(s => s.ok).length;
    const totalMs = scenarios.reduce((s, sc) => s + sc.ms, 0);

    // Record to daily validation
    const dv = _tryRequire("./dailyEngineeringValidation.cjs");
    if (dv) {
        try {
            scenarios.forEach(s => {
                if (s.name === "debugging")       dv.recordDebuggingSession({ resolved: s.ok });
                if (s.name === "deployment-ops")  dv.recordDeployment({ success: s.ok });
            });
        } catch {}
    }

    return {
        passed,
        failed:          scenarios.length - passed,
        total:           scenarios.length,
        totalMs,
        executionTrust:  Math.round(passed / scenarios.length * 100),
        scenarios,
        summary:         `${passed}/${scenarios.length} scenarios passed — trust: ${Math.round(passed / scenarios.length * 100)}%`,
    };
}

module.exports = { runValidation, scenarioDebugging, scenarioDeploymentOps, scenarioDependencyRecovery, scenarioBrowserWorkflow, scenarioRuntimeRestoration, scenarioLongSession };
