"use strict";
/**
 * Phase 392 — Failure Simulation
 *
 * Controlled failure injection for testing runtime survivability.
 * Used by: integration tests, burn-in scripts, manual resilience validation.
 * NOT for production execution paths.
 *
 * Scenarios:
 *   adapter-crash        — simulate adapter throwing
 *   transient-timeout    — simulate dispatch timeout (recoverable)
 *   permanent-error      — simulate permission denied (not recoverable)
 *   stale-queue          — enqueue entries then abandon drain
 *   interrupted-workflow — start a workflow chain then cancel mid-step
 *   reconnect-recovery   — simulate SSE disconnect + reconnect cycle
 *   memory-pressure      — allocate/release to probe memory gate behavior
 */

const logger = require("../../backend/utils/logger");

const SCENARIOS = {
    "adapter-crash":         _simulateAdapterCrash,
    "transient-timeout":     _simulateTransientTimeout,
    "permanent-error":       _simulatePermanentError,
    "stale-queue":           _simulateStaleQueue,
    "interrupted-workflow":  _simulateInterruptedWorkflow,
    "reconnect-recovery":    _simulateReconnectRecovery,
    "memory-pressure":       _simulateMemoryPressure,
    // Phase 417: real failure-chain scenarios
    "adapter-disconnect-chain": _simulateAdapterDisconnectChain,
    "confidence-collapse":      _simulateConfidenceCollapse,
    "pressure-spike":           _simulatePressureSpike,
    "dep-graph-block":          _simulateDepGraphBlock,
};

async function _simulateAdapterCrash() {
    logger.warn("[Sim] adapter-crash: throwing from mock adapter");
    throw new Error("SimulatedAdapterCrash: adapter_fault");
}

async function _simulateTransientTimeout() {
    logger.warn("[Sim] transient-timeout: sleeping 35s to trigger timeout");
    await new Promise(r => setTimeout(r, 35_000));
    return { simulated: true, scenario: "transient-timeout" };
}

async function _simulatePermanentError() {
    logger.warn("[Sim] permanent-error: returning permission denied");
    return { success: false, error: "Permission denied: simulated_permanent_error" };
}

async function _simulateStaleQueue() {
    const pq = require("./priorityQueue.cjs");
    const before = pq.size();
    for (let i = 0; i < 5; i++) pq.enqueue({ input: `sim-stale-${i}` }, 2);
    const after = pq.size();
    logger.warn(`[Sim] stale-queue: enqueued 5 items — queue ${before} → ${after}`);
    return { success: true, simulated: true, scenario: "stale-queue", queuedItems: 5, queueSize: after };
}

async function _simulateInterruptedWorkflow() {
    logger.warn("[Sim] interrupted-workflow: starting 3-step mock chain, cancelling at step 2");
    const steps = [
        { cmd: "echo step-1", label: "Step 1" },
        { cmd: "echo step-2", label: "Step 2 (cancelled before this)" },
        { cmd: "echo step-3", label: "Step 3" },
    ];
    // Execute step 1, then simulate cancellation
    const results = [{ step: 0, ok: true, output: "step-1" }];
    // Simulate mid-workflow interrupt
    return {
        success: false,
        simulated: true,
        scenario: "interrupted-workflow",
        completedSteps: results,
        interruptedAt: 1,
        reason: "operator_cancel_simulated",
    };
}

async function _simulateReconnectRecovery() {
    logger.warn("[Sim] reconnect-recovery: simulating SSE disconnect cycle");
    let bus = null;
    try {
        bus = require("./runtimeEventBus.cjs");
        const before = bus.metrics?.()?.connectionCount ?? 0;
        // No actual disconnect — just record the simulated state
        return {
            success: true,
            simulated: true,
            scenario: "reconnect-recovery",
            sseConnectionsBefore: before,
            note: "SSE reconnect simulation — no clients disconnected in test mode",
        };
    } catch {
        return { success: false, simulated: true, scenario: "reconnect-recovery", error: "event bus unavailable" };
    }
}

async function _simulateMemoryPressure() {
    logger.warn("[Sim] memory-pressure: allocating 50MB temporarily");
    const before = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    // Allocate ~50MB of temp buffers
    const buffers = [];
    for (let i = 0; i < 50; i++) buffers.push(Buffer.alloc(1_048_576));
    const peak = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    buffers.length = 0; // release
    if (global.gc) global.gc();
    const after = Math.round(process.memoryUsage().heapUsed / 1_048_576);
    return {
        success: true,
        simulated: true,
        scenario: "memory-pressure",
        heapMbBefore: before,
        heapMbPeak:   peak,
        heapMbAfter:  after,
        recovered:    after < peak,
    };
}

// ── Phase 417: Real Failure-Chain Scenarios ───────────────────────────────────

async function _simulateAdapterDisconnectChain() {
    logger.warn("[Sim] adapter-disconnect-chain: simulating adapter stale then heal cycle");
    const adapterHeal = (() => { try { return require("./adapterSelfHealing.cjs"); } catch { return null; } })();
    const toolMonitor = (() => { try { return require("./toolStateMonitor.cjs"); } catch { return null; } })();

    if (!adapterHeal || !toolMonitor) {
        return { success: false, scenario: "adapter-disconnect-chain", error: "heal/monitor modules unavailable" };
    }

    // Simulate a stale vscode adapter
    toolMonitor.reportState("vscode", "stale", { simulated: true });
    const problems = toolMonitor.detectProblems();
    const staleProblem = problems.find(p => p.tool === "vscode");

    // Now attempt heal
    const healResult = adapterHeal.heal("vscode", { simulated: true });

    // Reset back to connected
    toolMonitor.reportState("vscode", "connected", {});
    adapterHeal.resetAdapter("vscode");

    return {
        success: true,
        simulated: true,
        scenario: "adapter-disconnect-chain",
        staleDetected: !!staleProblem,
        healAttempted: true,
        healResult,
    };
}

async function _simulateConfidenceCollapse() {
    logger.warn("[Sim] confidence-collapse: creating session and driving confidence to critical");
    const session = (() => { try { return require("./engineeringSession.cjs"); } catch { return null; } })();
    const autoCont = (() => { try { return require("./autonomousContinuation.cjs"); } catch { return null; } })();
    if (!session || !autoCont) return { success: false, scenario: "confidence-collapse", error: "session/continuation unavailable" };

    const s = session.create("sim: confidence collapse test", { tags: ["simulation"] });
    // Drive 5 consecutive failures
    for (let i = 0; i < 5; i++) {
        autoCont.recordStepOutcome({ sessionId: s.id, chainName: "sim-chain", success: false, cmd: `sim-fail-${i}` });
    }
    const final = session.get(s.id);
    const cont  = autoCont.shouldContinue({ sessionId: s.id, chainName: "sim-chain", stepIndex: 5, stepSuccess: false, consecutiveFails: 5 });
    // Clean up
    session.transition(s.id, "abandoned", "simulation cleanup");

    return {
        success: true,
        simulated: true,
        scenario: "confidence-collapse",
        finalConfidence: final?.executionConfidence,
        degradationState: final?.degradationState,
        continuationBlocked: !cont.continue,
        continuationReason: cont.reason,
    };
}

async function _simulatePressureSpike() {
    logger.warn("[Sim] pressure-spike: recording 5 failures and 3 adapter faults");
    const pmon = (() => { try { return require("./runtimePressureMonitor.cjs"); } catch { return null; } })();
    if (!pmon) return { success: false, scenario: "pressure-spike", error: "pressure monitor unavailable" };

    const before = pmon.computePressure();
    for (let i = 0; i < 5; i++) pmon.recordFailure();
    for (let i = 0; i < 3; i++) pmon.recordAdapterFault("sim");
    const after = pmon.computePressure();
    const gate  = pmon.priorityGate(pmon.PRIORITY.NORMAL);

    return {
        success: true,
        simulated: true,
        scenario: "pressure-spike",
        pressureBefore: before.score,
        pressureAfter:  after.score,
        levelAfter:     after.level,
        normalBlocked:  !gate.allowed,
    };
}

async function _simulateDepGraphBlock() {
    logger.warn("[Sim] dep-graph-block: validating an unknown dep-heavy chain");
    const depGraph = (() => { try { return require("./executionDependencyGraph.cjs"); } catch { return null; } })();
    if (!depGraph) return { success: false, scenario: "dep-graph-block", error: "dep graph unavailable" };

    // Validate a chain with the most demanding deps to exercise the graph
    const result = await depGraph.validateDeps("deploy-update");
    return {
        success: true,
        simulated: true,
        scenario: "dep-graph-block",
        chainName: "deploy-update",
        depsSatisfied: result.satisfied,
        depResults: result.results,
    };
}

/**
 * Run a named failure scenario.
 * @param {string} scenario — one of SCENARIOS keys
 * @returns {Promise<object>}
 */
async function simulate(scenario) {
    if (!SCENARIOS[scenario]) {
        return { success: false, error: `unknown scenario: ${scenario}`, available: Object.keys(SCENARIOS) };
    }
    logger.warn(`[FailureSim] running scenario: ${scenario}`);
    const t0 = Date.now();
    try {
        const result = await SCENARIOS[scenario]();
        return { ...(result || {}), simulated: true, scenario, durationMs: Date.now() - t0 };
    } catch (err) {
        return { success: false, simulated: true, scenario, error: err.message, durationMs: Date.now() - t0 };
    }
}

/**
 * Run all non-destructive scenarios (skips transient-timeout which takes 35s).
 * Used by burn-in test suite.
 */
async function runAll({ skipSlow = true } = {}) {
    const skip = skipSlow ? ["transient-timeout"] : [];
    const results = {};
    for (const name of Object.keys(SCENARIOS)) {
        if (skip.includes(name)) { results[name] = { skipped: true }; continue; }
        results[name] = await simulate(name);
    }
    return results;
}

module.exports = { simulate, runAll, SCENARIOS: Object.keys(SCENARIOS) };
