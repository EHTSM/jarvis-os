"use strict";
/**
 * Phase 656 — Execution Intelligence Stress Test
 *
 * Tests: repeated debug recoveries, deployment interruptions, replay-heavy workflows,
 * browser instability, reconnect storms, adaptive chains.
 * Measures: survivability, execution trust, replay durability, workflow intelligence.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function _run(name, fn) {
    const start = Date.now();
    try {
        const r = fn();
        return { name, ok: r.ok !== false, ms: Date.now() - start, detail: r.detail || null };
    } catch (e) {
        return { name, ok: false, ms: Date.now() - start, error: e.message };
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

function testSmartDebugIntelligence() {
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (!sdi) return { ok: false, detail: "smartDebugIntelligence unavailable" };

    sdi.recordFailure({ errorText: "ECONNREFUSED localhost:5050", context: "server start", sessionId: "stress-656" });
    sdi.recordFailure({ errorText: "ECONNREFUSED localhost:5050", context: "health check", sessionId: "stress-656" });
    sdi.recordFailure({ errorText: "SyntaxError: Unexpected token", context: "load", sessionId: "stress-656" });

    const plan     = sdi.buildDebugPlan("ECONNREFUSED localhost:5050", { sessionId: "stress-656" });
    const repeated = sdi.detectRepeatedFailures({ windowMs: 60 * 60 * 1000, minCount: 2 });
    const corr     = sdi.correlateFailures({ windowMs: 60 * 60 * 1000 });

    return { ok: plan.ok && repeated.ok && corr.ok, detail: `plan=${plan.primaryPath} confidence=${plan.confidence} repeated=${repeated.count} dominant=${corr.dominant?.id}` };
}

function testExecutionRiskIntelligence() {
    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (!eri) return { ok: false, detail: "executionRiskIntelligence unavailable" };

    eri.recordSignal("deploy-fail");
    eri.recordSignal("patch-rejected");
    eri.recordSignal("workflow-interrupted");
    eri.recordSignal("deploy-success");

    const summary  = eri.riskSummary({ windowMs: 60 * 60 * 1000 });
    const rollback = eri.rollbackRecommendation({ deploymentFailed: true, healthCheckFailed: true });
    const warnings = eri.trustAwareWarnings();

    return { ok: summary.ok && rollback.ok && warnings.ok, detail: `risk=${summary.overall} rollback=${rollback.recommend} warnings=${warnings.count}` };
}

function testAdaptiveWorkflowChains() {
    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (!awc) return { ok: false, detail: "adaptiveWorkflowChains unavailable" };

    const chain = awc.createChain({
        goal:      "stress test adaptive chain",
        baseSteps: ["validate-health", "check-trust", "scan-environment"],
        branches:  [{ label: "low-trust branch", condition: { type: "lt", field: "trustScore", threshold: 55 }, steps: ["check-logs", "notify-operator"] }],
    });
    if (!chain.ok) return { ok: false, detail: `chain create: ${chain.error}` };

    const s1 = awc.executeStep(chain.chainId, 0, { result: { status: "ok" }, context: { trustScore: 40 } });
    const s2 = awc.executeStep(chain.chainId, 1, { result: { status: "ok" }, context: { trustScore: 40 } });
    awc.interruptChain(chain.chainId, { reason: "stress test cleanup" });

    return { ok: chain.ok && s1.ok, detail: `chainId=${chain.chainId.slice(0, 8)} branch=${s1.branchActivated || "none"} depth=${s2.depth || 0}` };
}

function testTerminalExecutionIntelligence() {
    const tei = _tryRequire("./terminalExecutionIntelligence.cjs");
    if (!tei) return { ok: false, detail: "terminalExecutionIntelligence unavailable" };

    tei.recordExecution({ command: "node server.js", output: "ECONNREFUSED localhost:5050", exitCode: 1, sessionId: "stress-656" });
    tei.recordExecution({ command: "npm install",    output: "npm ERR! missing peer",       exitCode: 1, sessionId: "stress-656" });
    tei.recordExecution({ command: "node server.js", output: "",                             exitCode: 0, sessionId: "stress-656" });

    const retry   = tei.selectRetryStrategy("node server.js", "ECONNREFUSED localhost:5050", 0);
    const repairs = tei.prioritizeDependencyRepairs({ windowMs: 60 * 60 * 1000 });
    const summary = tei.executionIntelSummary({ windowMs: 60 * 60 * 1000 });

    tei.saveCheckpoint("stress-656", "server-started", { stepOrder: 0 });
    const cp = tei.getLastCheckpoint("stress-656");

    return { ok: retry.canRetry && repairs.ok && summary.ok, detail: `retry=${retry.canRetry} repairs=${repairs.count} successRate=${summary.successRate} cp=${cp.ok}` };
}

function testBrowserExecutionIntelligence() {
    const bei = _tryRequire("./browserExecutionIntelligence.cjs");
    if (!bei) return { ok: false, detail: "browserExecutionIntelligence unavailable" };

    const dup1 = bei.isDuplicateOperation("https://stress.example.com/health", "health-probe");
    const dup2 = bei.isDuplicateOperation("https://stress.example.com/health", "health-probe"); // should be dup

    const validation = bei.validateExtraction({ name: "test", status: "ok" }, { name: { required: true, type: "string" }, status: { required: true } });
    const formSafety = bei.checkFormSafety({ hasSubmitAction: true, operatorApproved: false });
    const stateReport = bei.workflowStateReport();

    return { ok: dup2 && validation.valid && !formSafety.safe && stateReport.ok, detail: `dup=${dup2} valid=${validation.valid} formBlocked=${!formSafety.safe}` };
}

function testDecisionEvolution() {
    const ede = _tryRequire("./engineeringDecisionEvolution.cjs");
    if (!ede) return { ok: false, detail: "engineeringDecisionEvolution unavailable" };

    const ranked    = ede.rankRecoveryStrategies("ECONNREFUSED cannot connect", { trustScore: 72 });
    const debugPath = ede.prioritizeDebugPaths({ errorText: "ECONNREFUSED", recentDeployment: true });
    const unstable  = ede.detectUnstableWorkflows();
    const stab      = ede.suggestStabilization({ pressureLevel: "stressed", unstableWorkflows: false });

    return { ok: ranked.ok && debugPath.ok && unstable.ok && stab.ok, detail: `primary=${ranked.primary.id} paths=${debugPath.paths.length} unstable=${unstable.unstable}` };
}

function testMemoryIntelligence() {
    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    if (!omi) return { ok: false, detail: "operationalMemoryIntelligence unavailable" };

    omi.upsert({ type: "failure-cluster",   key: "econnrefused-stress-656", payload: { pattern: "restart-server" }, confidence: 78, outcome: "success" });
    omi.upsert({ type: "recovery-success",  key: "restart-server-stress-656", payload: { steps: 3 }, confidence: 82, outcome: "success" });

    const clusters   = omi.clusterFailures("ECONNREFUSED");
    const recoveries = omi.recallSuccessfulRecoveries("restart-server");
    const stats      = omi.stats();

    return { ok: stats.ok && stats.total > 0, detail: `clusters=${clusters.count} recoveries=${recoveries.count} total=${stats.total}` };
}

function testLongHorizonContinuity() {
    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (!lhec) return { ok: false, detail: "longHorizonExecutionContinuity unavailable" };

    const sessionId = `stress-656-${Date.now()}`;
    lhec.persistSession(sessionId, { goal: "stress test 656", notes: "execution intelligence" });
    const restored = lhec.restoreSession(sessionId);

    const dedup1 = lhec.isDuplicateRecovery("stress-656-key");
    const dedup2 = lhec.isDuplicateRecovery("stress-656-key");
    const health = lhec.continuityHealth();

    return { ok: restored.ok && dedup2, detail: `restored=${restored.ok} dedup=${dedup2} health=${health.ok}` };
}

// ── Run all ────────────────────────────────────────────────────────────────────

function runAll() {
    const results = [
        _run("smart-debug-intelligence",    testSmartDebugIntelligence),
        _run("execution-risk-intelligence", testExecutionRiskIntelligence),
        _run("adaptive-workflow-chains",    testAdaptiveWorkflowChains),
        _run("terminal-exec-intelligence",  testTerminalExecutionIntelligence),
        _run("browser-exec-intelligence",   testBrowserExecutionIntelligence),
        _run("decision-evolution",          testDecisionEvolution),
        _run("memory-intelligence",         testMemoryIntelligence),
        _run("long-horizon-continuity",     testLongHorizonContinuity),
    ];

    const passed        = results.filter(r => r.ok).length;
    const survivability = Math.round(passed / results.length * 100);

    return {
        ok:             survivability >= 75,
        passed,
        total:          results.length,
        survivability,
        results,
        failed:         results.filter(r => !r.ok).map(r => r.name),
        summary:        `Execution intelligence stress 656: ${passed}/${results.length} — ${survivability}% survivability`,
    };
}

module.exports = { runAll, testSmartDebugIntelligence, testExecutionRiskIntelligence, testAdaptiveWorkflowChains, testTerminalExecutionIntelligence, testBrowserExecutionIntelligence, testDecisionEvolution, testMemoryIntelligence, testLongHorizonContinuity };
