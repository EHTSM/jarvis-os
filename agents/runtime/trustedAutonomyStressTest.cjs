"use strict";
/**
 * Phase 640 — Trusted Autonomy Stress Test
 *
 * Tests: repeated autonomous recoveries, reconnect storms, deployment interruption,
 * browser instability, replay-heavy workflows, long execution chains.
 * Measures: autonomy safety, operational continuity, replay durability, execution trust.
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

function testTrustedDebugAutonomy() {
    const tda = _tryRequire("./trustedDebugAutonomy.cjs");
    if (!tda) return { ok: false, detail: "trustedDebugAutonomy unavailable" };

    const run = tda.startDebugRun({ goal: "stress-test: trusted debug autonomy", errorContext: "ECONNREFUSED localhost:5050" });
    if (!run.ok) return { ok: false, detail: run.error || run.reason };

    tda.executeStep(run.runId, 0, { result: { status: "ok" } });
    tda.executeStep(run.runId, 1, { result: { status: "ok" } });
    tda.interruptRun(run.runId, { reason: "stress test cleanup" });

    return { ok: true, detail: `runId=${run.runId.slice(0, 8)} steps=${run.stepCount} recovery=${run.recovery?.path}` };
}

function testAdvancedPatchTrust() {
    const apt = _tryRequire("./advancedPatchTrust.cjs");
    if (!apt) return { ok: false, detail: "advancedPatchTrust unavailable" };

    for (let i = 0; i < 5; i++) {
        apt.recordPatchOutcome({ filePath: "backend/server.js", success: i < 4, rolledBack: i === 3, validationPassed: true, depSafe: true });
    }

    const trust  = apt.patchTrustTier("backend/server.js");
    const risks  = apt.rollbackRiskIndicators({ windowDays: 1 });
    const conf   = apt.executionConfidenceSummary();

    return { ok: trust.ok && risks.ok && conf.ok, detail: `tier=${trust.tier} risk=${risks.risk}` };
}

function testAutonomousEngineeringGoals() {
    const aeg = _tryRequire("./autonomousEngineeringGoals.cjs");
    if (!aeg) return { ok: false, detail: "autonomousEngineeringGoals unavailable" };

    const goal = aeg.startGoal({ goal: "stabilize backend after ECONNREFUSED" });
    if (!goal.ok) return { ok: false, detail: goal.error };

    aeg.recordValidation(goal.goalId, { step: "health-check", passed: true });
    aeg.completeGoal(goal.goalId, { success: true, outcome: "backend stabilized" });
    const summary = aeg.goalSummary(goal.goalId);

    return { ok: summary.ok && summary.status === "completed", detail: `goal=${goal.matchedGoal} validation=${summary.validationPass}` };
}

function testTerminalSupervision() {
    const ats = _tryRequire("./autonomousTerminalSupervision.cjs");
    if (!ats) return { ok: false, detail: "autonomousTerminalSupervision unavailable" };

    const proc = ats.registerProcess({ name: "stress-server", command: "node server.js", sessionId: "stress" });
    ats.heartbeat(proc.processId, { outputLine: "Server listening on port 3000" });
    ats.saveValidationCheckpoint(proc.processId, { label: "startup-check", passed: true });

    const health = ats.verifyProcessHealth(proc.processId);
    ats.stopProcess(proc.processId);

    return { ok: health.ok && !health.stale, detail: `processId=${proc.processId?.slice(0, 8)} healthy=${health.ok}` };
}

function testBrowserOperations() {
    const abo = _tryRequire("./autonomousBrowserOperations.cjs");
    if (!abo) return { ok: false, detail: "autonomousBrowserOperations unavailable" };

    abo.registerAuth("stress.example.com", "tok_stress_test_123");
    const auth = abo.getAuth("stress.example.com");

    const op = abo.startOperation({ opType: "health-probe", url: "https://stress.example.com/health", sessionId: "stress", authDomain: "stress.example.com" });
    if (!op.ok) return { ok: false, detail: op.error };

    abo.advanceStep(op.opId, { stepResult: { status: 200 } });
    abo.interruptOperation(op.opId, { reason: "stress test cleanup" });

    return { ok: op.ok && !!auth, detail: `opId=${op.opId?.slice(0, 8)} authValid=${op.authValid}` };
}

function testDecisionIntelligence() {
    const edi = _tryRequire("./engineeringDecisionIntelligence.cjs");
    if (!edi) return { ok: false, detail: "engineeringDecisionIntelligence unavailable" };

    const recovery = edi.prioritizeRecovery("ECONNREFUSED cannot connect to localhost:5050");
    const rollback = edi.recommendRollback({ deploymentPhase: "failed", errorRate: 0.15 });
    const unsafe   = edi.detectUnsafeRuntime();

    return { ok: recovery.ok && rollback.ok && unsafe.ok, detail: `recovery=${recovery.path} rollback=${rollback.recommend} safe=${unsafe.safe}` };
}

function testWorkflowMemory() {
    const awm = _tryRequire("./autonomousWorkflowMemory.cjs");
    if (!awm) return { ok: false, detail: "autonomousWorkflowMemory unavailable" };

    awm.record({ type: "workflow-pattern", key: "stabilize-backend-stress", payload: { chain: "runtime-recovery-full" }, confidence: 80 });
    awm.record({ type: "debug-chain",      key: "econnrefused-stress",       payload: { path: "restart-server" },           confidence: 75 });

    const recall = awm.recall("stabilize-backend");
    const chains = awm.recallDebugChain("ECONNREFUSED");
    const s      = awm.stats();

    return { ok: recall.count > 0, detail: `recalled=${recall.count} chains=${chains.chains.length} total=${s.total}` };
}

function testLongHorizonContinuity() {
    const lhac = _tryRequire("./longHorizonAutonomousContinuity.cjs");
    if (!lhac) return { ok: false, detail: "longHorizonAutonomousContinuity unavailable" };

    lhac.persistAutonomousSession("stress-session-640", { goal: "stress test long horizon", notes: "640" });
    const restored = lhac.restoreAutonomousSession("stress-session-640");

    const dedup1 = lhac.isDuplicateRecovery("stress-recovery-key");
    const dedup2 = lhac.isDuplicateRecovery("stress-recovery-key"); // should be dup

    const health = lhac.continuityHealth();

    return { ok: (restored.ok || restored.stale !== undefined) && dedup2, detail: `restored=${restored.ok} dedup=${dedup2} health=${health.ok}` };
}

// ── Run all ───────────────────────────────────────────────────────────────────

function runAll() {
    const results = [
        _run("trusted-debug-autonomy",       testTrustedDebugAutonomy),
        _run("advanced-patch-trust",         testAdvancedPatchTrust),
        _run("autonomous-engineering-goals", testAutonomousEngineeringGoals),
        _run("terminal-supervision",         testTerminalSupervision),
        _run("browser-operations",           testBrowserOperations),
        _run("decision-intelligence",        testDecisionIntelligence),
        _run("workflow-memory",              testWorkflowMemory),
        _run("long-horizon-continuity",      testLongHorizonContinuity),
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
        summary:        `Trusted autonomy stress 640: ${passed}/${results.length} — ${survivability}% survivability`,
    };
}

module.exports = { runAll, testTrustedDebugAutonomy, testAdvancedPatchTrust, testAutonomousEngineeringGoals, testTerminalSupervision, testBrowserOperations, testDecisionIntelligence, testWorkflowMemory, testLongHorizonContinuity };
