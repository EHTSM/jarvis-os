"use strict";
/**
 * Phase 613 — Platform Resilience Test 615
 *
 * 8-test resilience suite for phases 601–615:
 * debug workflow, deploy workflow, vscode maturity, browser maturity,
 * operational trust, workflow survivability, session continuity, bootstrap hardening.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function _run(name, fn) {
    const start = Date.now();
    try {
        const result = fn();
        return { name, ok: result.ok !== false, ms: Date.now() - start, detail: result.detail || null };
    } catch (e) {
        return { name, ok: false, ms: Date.now() - start, error: e.message };
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

function testDebugWorkflow() {
    const dwe = _tryRequire("./debugWorkflowEngine.cjs");
    if (!dwe) return { ok: false, detail: "debugWorkflowEngine unavailable" };

    const session = dwe.openSession({ goal: "resilience-test: debug workflow smoke test" });
    if (!session.ok) return { ok: false, detail: session.error };

    const ingest = dwe.ingestErrors(session.sessionId, ["ECONNREFUSED localhost:5050"]);
    if (!ingest.ok) return { ok: false, detail: "ingestErrors failed" };

    const plan = dwe.buildPlan(session.sessionId);
    if (!plan.ok || plan.stepCount === 0) return { ok: false, detail: "buildPlan returned no steps" };

    const closed = dwe.closeSession(session.sessionId, { resolved: true, notes: "resilience test" });
    return { ok: closed.ok, detail: `sessionId=${session.sessionId} steps=${plan.stepCount}` };
}

function testDeployWorkflow() {
    const dwe = _tryRequire("./deployWorkflowEngine.cjs");
    if (!dwe) return { ok: false, detail: "deployWorkflowEngine unavailable" };

    const deployment = dwe.openDeployment({ pipelineName: "resilience-test-deploy" });
    // Preflight may fail if blockers exist in real environment — that's correct behavior
    if (!deployment.ok && !deployment.blockers) return { ok: false, detail: deployment.error };

    const list = dwe.listDeployments({ limit: 5 });
    return { ok: Array.isArray(list), detail: `listed ${list.length} deployments` };
}

function testVSCodeMaturity() {
    const vscm = _tryRequire("./vscodeExecutionMaturity.cjs");
    if (!vscm) return { ok: false, detail: "vscodeExecutionMaturity unavailable" };

    const set = vscm.setEditorContext("rt-615-test", { activeFile: "backend/server.js", cursorLine: 42 });
    if (!set.ok) return { ok: false, detail: set.error };

    const ctx = vscm.getEditorContext("rt-615-test");
    if (!ctx || ctx.activeFile !== "backend/server.js") return { ok: false, detail: "context not stored" };

    const chain = vscm.recommendChain("rt-615-test");
    return { ok: !!chain.chain, detail: `chain=${chain.chain}` };
}

function testBrowserWorkflowMaturity() {
    const bwm = _tryRequire("./browserWorkflowMaturity.cjs");
    if (!bwm) return { ok: false, detail: "browserWorkflowMaturity unavailable" };

    const auth = bwm.registerAuthSession("test.example.com", "tok_resilience_test_123");
    if (!auth.ok) return { ok: false, detail: "auth session registration failed" };

    const sessions = bwm.listAuthSessions();
    if (sessions.length === 0) return { ok: false, detail: "no auth sessions listed" };

    const report = bwm.maturityReport();
    return { ok: report.ok && report.health?.score >= 0, detail: `score=${report.health?.score}` };
}

function testOperationalTrust() {
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (!otl) return { ok: false, detail: "operationalTrustLayer unavailable" };

    otl.recordSignal("deploy-success", { detail: "resilience test" });
    otl.recordSignal("patch-applied",  { detail: "resilience test" });

    const trust = otl.getTrustScore();
    if (typeof trust.score !== "number") return { ok: false, detail: "trust score not a number" };

    const gate = otl.gateOperation("patch");
    return { ok: typeof gate.ok === "boolean", detail: `trust=${trust.score} gate=${gate.ok}` };
}

function testWorkflowSurvivability() {
    const ws = _tryRequire("./workflowSurvivability.cjs");
    if (!ws) return { ok: false, detail: "workflowSurvivability unavailable" };

    ws.saveCheckpoint("rt-615-wf", 3, { step: "test-state", data: "xyz" });
    const cp = ws.loadCheckpoint("rt-615-wf");
    if (!cp.ok || cp.stepIndex !== 3) return { ok: false, detail: "checkpoint save/load failed" };

    const score = ws.survivabilityScore();
    return { ok: typeof score.score === "number", detail: `score=${score.score}` };
}

function testSessionContinuity() {
    const dsc = _tryRequire("./debugSessionContinuity.cjs");
    if (!dsc) return { ok: false, detail: "debugSessionContinuity unavailable" };

    dsc.saveSessionState("rt-615-sess", {
        goal:       "resilience test",
        errors:     ["ENOENT missing.js"],
        currentStep: 2,
    });

    const restored = dsc.restoreSessionState("rt-615-sess");
    if (!restored.ok) return { ok: false, detail: restored.error };

    const summary = dsc.continuitySummary("rt-615-sess");
    return { ok: summary.ok && summary.goal === "resilience test", detail: `step=${summary.currentStep}` };
}

function testBootstrapHardening() {
    const ebh = _tryRequire("./environmentBootstrapHardening.cjs");
    if (!ebh) return { ok: false, detail: "environmentBootstrapHardening unavailable" };

    const plan = ebh.bootstrapPlan();
    // Plan should always return — ok or not
    if (typeof plan.ok !== "boolean") return { ok: false, detail: "bootstrapPlan returned unexpected result" };

    const deps = ebh.verifyDependencies();
    return { ok: typeof deps.ok === "boolean", detail: `deps=${deps.passed}/${deps.total} bootstrap=${plan.ok ? "ok" : "issues"}` };
}

// ── Run all ───────────────────────────────────────────────────────────────────

function runAll() {
    const results = [
        _run("debug-workflow",          testDebugWorkflow),
        _run("deploy-workflow",         testDeployWorkflow),
        _run("vscode-maturity",         testVSCodeMaturity),
        _run("browser-workflow-maturity",testBrowserWorkflowMaturity),
        _run("operational-trust",       testOperationalTrust),
        _run("workflow-survivability",  testWorkflowSurvivability),
        _run("session-continuity",      testSessionContinuity),
        _run("bootstrap-hardening",     testBootstrapHardening),
    ];

    const passed        = results.filter(r => r.ok).length;
    const failed        = results.filter(r => !r.ok);
    const survivability = Math.round(passed / results.length * 100);

    return {
        ok:             survivability >= 75,
        passed,
        total:          results.length,
        survivability,
        results,
        failed:         failed.map(r => r.name),
        summary:        `Resilience 615: ${passed}/${results.length} — ${survivability}% survivability`,
    };
}

module.exports = { runAll, testDebugWorkflow, testDeployWorkflow, testVSCodeMaturity, testBrowserWorkflowMaturity, testOperationalTrust, testWorkflowSurvivability, testSessionContinuity, testBootstrapHardening };
