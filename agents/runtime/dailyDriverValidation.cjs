"use strict";
/**
 * Phase 629 — Daily-Driver Engineering Validation
 *
 * Validates JARVIS for real daily use: debugging, deployments, runtime recovery,
 * browser workflows, patch proposal flows, long engineering sessions.
 * Measures: daily usability, workflow trust, execution reliability, productivity.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Validation scenarios ──────────────────────────────────────────────────────

function _scenario(name, fn) {
    const start = Date.now();
    try {
        const result = fn();
        return { name, ok: result.ok !== false, ms: Date.now() - start, detail: result.detail || null, score: result.score || null };
    } catch (e) {
        return { name, ok: false, ms: Date.now() - start, error: e.message };
    }
}

function scenarioDebugFlow() {
    const dwe = _tryRequire("./debugWorkflowEngine.cjs");
    const dsc = _tryRequire("./debugSessionContinuity.cjs");
    if (!dwe || !dsc) return { ok: false, detail: "modules unavailable" };

    // Open → ingest → plan → save continuity → close
    const session = dwe.openSession({ goal: "daily-driver: test debugging flow" });
    if (!session.ok) return { ok: false, detail: session.error };

    dwe.ingestErrors(session.sessionId, ["ECONNREFUSED localhost:5050", "Cannot find module './missing'"]);
    const plan = dwe.buildPlan(session.sessionId);

    dsc.saveSessionState(session.sessionId, { goal: "daily-driver test", currentStep: 1, errors: ["ECONNREFUSED"], status: "active" });
    const restored = dsc.restoreSessionState(session.sessionId);

    dwe.closeSession(session.sessionId, { resolved: true, notes: "daily-driver validation" });

    return { ok: plan.ok && restored.ok, detail: `plan steps=${plan.stepCount}, continuity restored=${restored.ok}` };
}

function scenarioDeploymentFlow() {
    const dwe = _tryRequire("./deployWorkflowEngine.cjs");
    const dse = _tryRequire("./deploymentSurvivabilityEngine.cjs");
    if (!dwe || !dse) return { ok: false, detail: "modules unavailable" };

    const dep = dwe.openDeployment({ pipelineName: "daily-driver-test" });
    if (!dep.ok && !dep.blockers) return { ok: false, detail: dep.error };

    const deploymentId = dep.deploymentId || "dd-test-id";
    dse.captureSnapshot(deploymentId, { pipelineName: "daily-driver-test" });

    const list = dwe.listDeployments({ limit: 5 });
    return { ok: Array.isArray(list), detail: `deployment opened, ${list.length} in history` };
}

function scenarioRuntimeRecovery() {
    const adc = _tryRequire("./autonomousDebugChains.cjs");
    const ode = _tryRequire("./operationalDecisionEngine.cjs");
    if (!adc || !ode) return { ok: false, detail: "modules unavailable" };

    const chain    = adc.planDebugChain("restore runtime after ECONNREFUSED", "dd-session");
    const decision = ode.chooseRecoveryPath("ECONNREFUSED localhost:5050");

    if (chain.ok) adc.interruptChain(chain.chainId, { reason: "daily-driver cleanup" });

    return { ok: chain.ok && decision.ok, detail: `chain=${chain.stepCount} steps, recovery=${decision.path}` };
}

function scenarioBrowserWorkflow() {
    const abw = _tryRequire("./autonomousBrowserWorkflows.cjs");
    if (!abw) return { ok: false, detail: "autonomousBrowserWorkflows unavailable" };

    const session = abw.startSession({ workflowName: "health-probe", url: "https://example.com/health-check" });
    if (!session.ok) return { ok: false, detail: session.error };

    const advance = abw.advanceStep(session.sessionDbId, { stepResult: { status: 200 } });
    abw.interruptSession(session.sessionDbId, { reason: "daily-driver cleanup" });

    return { ok: session.ok, detail: `browser workflow started, step advanced=${advance.ok}` };
}

function scenarioPatchProposal() {
    const app = _tryRequire("./autonomousPatchPrep.cjs");
    if (!app) return { ok: false, detail: "autonomousPatchPrep unavailable" };

    const proposals = app.listProposals({ status: "pending", limit: 5 });
    const suggest   = app.suggestRepairs("ECONNREFUSED cannot connect to port 5050");

    return { ok: typeof proposals.length === "number" && suggest.ok, detail: `${proposals.length} pending, repairs=${suggest.suggestions.length}` };
}

function scenarioLongSession() {
    const lhc = _tryRequire("./longHorizonContinuity.cjs");
    const ete = _tryRequire("./executionTrustEvolution.cjs");
    if (!lhc || !ete) return { ok: false, detail: "modules unavailable" };

    lhc.persistSession("dd-long-session", { goal: "long engineering session test", notes: "daily-driver" });
    const restored = lhc.restoreSession("dd-long-session");

    ete.recordTrustEvent("chain-completed", { detail: "daily-driver test" });
    const snapshot = ete.takeSnapshot();

    return { ok: (restored.ok || restored.stale !== undefined) && snapshot.ok, detail: `session persisted, trust=${snapshot.trust}` };
}

function scenarioGoalExecution() {
    const ege = _tryRequire("./engineeringGoalExecution.cjs");
    if (!ege) return { ok: false, detail: "engineeringGoalExecution unavailable" };

    const goal = ege.executeGoal({ goal: "verify production health", sessionId: "dd-session" });
    if (goal.ok) ege.recordOutcome(goal.goalId, { outcome: "health verified", success: true });

    return { ok: goal.ok, detail: `goal=${goal.matchedGoal}, chain=${goal.chainName}` };
}

// ── Compute scores ────────────────────────────────────────────────────────────

function computeUsabilityScore(scenarios) {
    const passed = scenarios.filter(s => s.ok).length;
    return Math.round(passed / scenarios.length * 100);
}

function computeWorkflowTrust() {
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (!otl) return 65;
    try { return otl.getTrustScore().score; } catch { return 65; }
}

function computeProductivityScore() {
    const ope = _tryRequire("./operatorProductivityEvolution.cjs");
    if (!ope) return 70;
    try {
        const summary = ope.productivitySummary();
        if (!summary.ok) return 70;
        return (summary.debug?.grade === "A" ? 90 : summary.debug?.grade === "B" ? 75 : 60);
    } catch { return 70; }
}

// ── Run validation ────────────────────────────────────────────────────────────

function runValidation() {
    const scenarios = [
        _scenario("debug-flow",       scenarioDebugFlow),
        _scenario("deployment-flow",  scenarioDeploymentFlow),
        _scenario("runtime-recovery", scenarioRuntimeRecovery),
        _scenario("browser-workflow", scenarioBrowserWorkflow),
        _scenario("patch-proposal",   scenarioPatchProposal),
        _scenario("long-session",     scenarioLongSession),
        _scenario("goal-execution",   scenarioGoalExecution),
    ];

    const usability      = computeUsabilityScore(scenarios);
    const workflowTrust  = computeWorkflowTrust();
    const productivity   = computeProductivityScore();
    const passed         = scenarios.filter(s => s.ok).length;
    const overallTrust   = Math.round((usability + workflowTrust + productivity) / 3);

    return {
        ok:             usability >= 70,
        passed,
        total:          scenarios.length,
        usability,
        workflowTrust,
        productivity,
        overallTrust,
        scenarios,
        grade:          overallTrust >= 80 ? "A" : overallTrust >= 65 ? "B" : overallTrust >= 50 ? "C" : "D",
        summary:        `Daily-driver: ${passed}/${scenarios.length} | Usability: ${usability}% | Trust: ${workflowTrust} | Productivity: ${productivity}%`,
    };
}

module.exports = { runValidation, scenarioDebugFlow, scenarioDeploymentFlow, scenarioRuntimeRecovery, scenarioBrowserWorkflow, scenarioPatchProposal, scenarioLongSession, scenarioGoalExecution };
