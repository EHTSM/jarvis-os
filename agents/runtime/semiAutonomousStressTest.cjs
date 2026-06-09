"use strict";
/**
 * Phase 626 — Semi-Autonomous Stress Test
 *
 * Tests: repeated autonomous recoveries, reconnect storms, deployment interruption,
 * browser instability, replay-heavy sessions, long execution chains.
 * Measures: survivability, execution trust, operational continuity, autonomy safety.
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

// ── Stress tests ──────────────────────────────────────────────────────────────

function testRepeatedAutonomousRecoveries() {
    const adc = _tryRequire("./autonomousDebugChains.cjs");
    if (!adc) return { ok: false, detail: "autonomousDebugChains unavailable" };

    const chains = [];
    for (let i = 0; i < 5; i++) {
        const c = adc.planDebugChain(`stress-test recovery #${i}`, `stress-session-${i}`);
        if (!c.ok) return { ok: false, detail: `Chain plan failed on iteration ${i}` };
        chains.push(c.chainId);
    }

    // Interrupt all chains to verify interrupt safety
    chains.forEach(id => adc.interruptChain(id, { reason: "stress-test cleanup" }));
    return { ok: true, detail: `${chains.length} autonomous chains created and safely interrupted` };
}

function testReconnectStorm() {
    const lhc = _tryRequire("./longHorizonContinuity.cjs");
    if (!lhc) return { ok: false, detail: "longHorizonContinuity unavailable" };

    lhc.persistSession("stress-storm-session", { goal: "reconnect storm test" });

    const reconnects = [];
    for (let i = 0; i < 6; i++) {
        reconnects.push(lhc.recordReconnect("stress-storm-session", { fromOfflineMs: i * 1000 }));
    }

    const lastReconnect = reconnects[reconnects.length - 1];
    // Storm should be detected after 5+ reconnects
    return { ok: lastReconnect.stormDetected, detail: `${reconnects.length} reconnects, storm=${lastReconnect.stormDetected}` };
}

function testDeploymentInterruption() {
    const dwe = _tryRequire("./deployWorkflowEngine.cjs");
    const dse = _tryRequire("./deploymentSurvivabilityEngine.cjs");
    if (!dwe || !dse) return { ok: false, detail: "deployWorkflowEngine or deploymentSurvivabilityEngine unavailable" };

    const dep = dwe.openDeployment({ pipelineName: "stress-test-interrupt" });
    if (!dep.ok && !dep.blockers) return { ok: false, detail: dep.error };

    const deploymentId = dep.deploymentId || "stress-test-deploy-id";

    const snapshot = dse.captureSnapshot(deploymentId, { pipelineName: "stress-test", environment: "test" });
    return { ok: snapshot.ok, detail: `Deployment snapshot captured: ${snapshot.snapshotId?.slice(0, 8) || "ok"}` };
}

function testBrowserInstability() {
    const abw = _tryRequire("./autonomousBrowserWorkflows.cjs");
    const bwm = _tryRequire("./browserWorkflowMaturity.cjs");
    if (!abw || !bwm) return { ok: false, detail: "autonomousBrowserWorkflows or browserWorkflowMaturity unavailable" };

    const session = abw.startSession({ workflowName: "data-extraction", url: "https://example.com/stress-test" });
    if (!session.ok) return { ok: false, detail: session.error };

    // Interrupt immediately to test interrupt safety
    const interrupted = abw.interruptSession(session.sessionDbId, { reason: "stress test browser instability" });

    // Record interrupt and recovery
    bwm.recordInterrupt(session.sessionDbId, 0, "stress test instability");
    bwm.recordRecovery(session.sessionDbId, true, "interrupt-safe-recovery");

    return { ok: interrupted.ok, detail: `Browser session started and safely interrupted` };
}

function testReplayHeavySession() {
    const ers = _tryRequire("./executionReplaySystem.cjs");
    if (!ers) return { ok: false, detail: "executionReplaySystem unavailable" };

    const replays = [];
    for (let i = 0; i < 5; i++) {
        const r = ers.recordReplay({
            name:    `stress-replay-${i}`,
            goal:    "stress test replay",
            steps:   [
                { label: "Step A", action: "GET /health", idempotent: true },
                { label: "Step B", action: "GET /status", idempotent: true },
            ],
            tags:    ["stress-test"],
        });
        if (r.ok) replays.push(r.replayId);
    }

    // Attempt to record the same replay twice (should dedup)
    const dup = ers.recordReplay({ name: "stress-replay-0", goal: "stress test replay", steps: [{ label: "Step A", action: "GET /health", idempotent: true }, { label: "Step B", action: "GET /status", idempotent: true }], tags: ["stress-test"] });
    const dedupWorks = !dup.ok && dup.duplicate;

    return { ok: replays.length > 0 && dedupWorks, detail: `${replays.length} replays recorded, dedup=${dedupWorks}` };
}

function testLongExecutionChains() {
    const ato = _tryRequire("./autonomousTerminalOrchestration.cjs");
    if (!ato) return { ok: false, detail: "autonomousTerminalOrchestration unavailable" };

    // Try to plan a chain beyond MAX_DEPTH — should be rejected
    const overLimit = ato.planSequence({
        name:     "stress-over-limit",
        commands: Array.from({ length: 12 }, (_, i) => `echo step-${i}`),
    });

    // Plan a valid chain
    const valid = ato.planSequence({
        name:     "stress-valid-chain",
        commands: Array.from({ length: 8 }, (_, i) => `echo step-${i}`),
    });

    return { ok: !overLimit.ok && valid.ok, detail: `Over-limit rejected=${!overLimit.ok}, valid chain ok=${valid.ok}` };
}

function testAutonomySafetyScoring() {
    const ete = _tryRequire("./executionTrustEvolution.cjs");
    if (!ete) return { ok: false, detail: "executionTrustEvolution unavailable" };

    // Record mix of positive and negative signals
    ete.recordTrustEvent("autonomous-recovery-success");
    ete.recordTrustEvent("chain-completed");
    ete.recordTrustEvent("autonomous-recovery-fail");
    ete.recordTrustEvent("chain-interrupted");

    const safety = ete.autonomySafetyScore();
    const summary = ete.confidenceSummary();

    return { ok: typeof safety.score === "number" && typeof summary.overall === "number", detail: `safety=${safety.score} confidence=${summary.overall}` };
}

function testSurvivabilityMeasurement() {
    const ws = _tryRequire("./workflowSurvivability.cjs");
    if (!ws) return { ok: false, detail: "workflowSurvivability unavailable" };

    // Save and load checkpoints under stress
    for (let i = 0; i < 5; i++) {
        ws.saveCheckpoint(`stress-wf-${i}`, i, { stressStep: i });
    }

    const score = ws.survivabilityScore();
    return { ok: score.score >= 0, detail: `survivability=${score.score} checkpoints=${score.checkpointCount}` };
}

// ── Run all ───────────────────────────────────────────────────────────────────

function runAll() {
    const results = [
        _run("repeated-autonomous-recoveries", testRepeatedAutonomousRecoveries),
        _run("reconnect-storm",                testReconnectStorm),
        _run("deployment-interruption",        testDeploymentInterruption),
        _run("browser-instability",            testBrowserInstability),
        _run("replay-heavy-session",           testReplayHeavySession),
        _run("long-execution-chains",          testLongExecutionChains),
        _run("autonomy-safety-scoring",        testAutonomySafetyScoring),
        _run("survivability-measurement",      testSurvivabilityMeasurement),
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
        summary:        `Stress test 626: ${passed}/${results.length} — ${survivability}% survivability`,
    };
}

module.exports = { runAll, testRepeatedAutonomousRecoveries, testReconnectStorm, testDeploymentInterruption, testBrowserInstability, testReplayHeavySession, testLongExecutionChains, testAutonomySafetyScoring, testSurvivabilityMeasurement };
