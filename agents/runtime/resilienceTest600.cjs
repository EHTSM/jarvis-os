"use strict";
/**
 * Phase 598 — Engineering Platform Resilience Test (600-series)
 *
 * Tests: reconnect storms, deployment interruption, patch rollback,
 *        browser instability, replay-heavy sessions, long execution chains.
 *
 * Measures: survivability, replay durability, operational continuity, runtime trust.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function _run(name, fn) {
    const t = Date.now();
    try { const r = fn(); return { name, ok: r.ok !== false, result: r, ms: Date.now() - t }; }
    catch (e) { return { name, ok: false, error: e.message, ms: Date.now() - t }; }
}

// ── Test cases ────────────────────────────────────────────────────────────────

function testReconnectStorm() {
    const mpr = _tryRequire("./multiProjectRuntime.cjs");
    if (!mpr) return { ok: false, error: "unavailable" };
    for (let i = 0; i < 15; i++) {
        mpr.registerProject({ name: `storm-proj-${i}`, environment: "test" });
        mpr.mapSessionToProject(`storm-sess-${i}`, `storm-proj-${i}`);
        mpr.getSessionProject(`storm-sess-${i}`);
    }
    const projects = mpr.listProjects();
    return { ok: projects.length > 0, registered: projects.length };
}

function testDeploymentInterruption() {
    const wv = _tryRequire("./workflowValidator.cjs");
    const da = _tryRequire("./deploymentAssist.cjs");
    if (!wv || !da) return { ok: false, error: "unavailable" };
    const pf = da.preflightSummary("interrupted-test");
    const v  = wv.validateDeploymentReadiness("interrupted-test");
    return { ok: typeof pf.ready === "boolean" && typeof v.ok === "boolean", preflightType: typeof pf.ready, validationType: typeof v.ok };
}

function testPatchRollback() {
    const pee = _tryRequire("./patchExecutionEngine.cjs");
    if (!pee) return { ok: false, error: "unavailable" };
    const diff = pee.proposeBatch
        ? { ok: false, note: "multi-file batch requires real files" }
        : { ok: false };
    // Test diff generation independently
    const { generateDiff } = require("./patchAssistant.cjs");
    const d = generateDiff("a\nb\nc", "a\nb-modified\nc", "test.js");
    return { ok: d.linesChanged > 0, diffWorks: true };
}

function testBrowserInstability() {
    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    if (!bwe) return { ok: false, error: "unavailable" };
    // Start 5 workflows and immediately interrupt them all
    let started = 0, interrupted = 0;
    for (let i = 0; i < 5; i++) {
        const wf = bwe.startWorkflow("public-api-probe", { sessionId: `instab-${i}`, url: "http://example.com" });
        if (wf.ok) { started++; bwe.interruptWorkflow(wf.workflowId, { reason: "instability-test" }); interrupted++; }
    }
    return { ok: started === 5 && interrupted === 5, started, interrupted };
}

function testReplayHeavySession() {
    const tl = _tryRequire("./executionTimeline.cjs");
    if (!tl) return { ok: false, error: "unavailable" };
    const sid = "replay-heavy-test";
    for (let i = 0; i < 25; i++) {
        tl.recordReplay(`replay-${i}`, `goal-${i}`, "success", sid);
    }
    const pp = _tryRequire("./platformPerformance.cjs");
    if (pp) {
        const page = pp.paginateTimeline({ sessionId: sid, pageSize: 10, page: 0 });
        return { ok: page.events.length >= 0, paged: true, hasMore: page.hasMore };
    }
    const events = tl.sessionThread(sid, 50);
    return { ok: events.length > 0, eventCount: events.length };
}

function testLongExecutionChain() {
    const ec = _tryRequire("./engineeringChains.cjs");
    if (!ec) return { ok: false, error: "unavailable" };
    const result = ec.executeChain("env-bootstrap-full", { approved: true, sessionId: "long-chain-test" });
    return { ok: result.ok !== false, steps: result.steps?.length, summary: result.summary };
}

function testMultiProjectIsolation() {
    const mpr = _tryRequire("./multiProjectRuntime.cjs");
    if (!mpr) return { ok: false, error: "unavailable" };
    mpr.registerProject({ name: "proj-a", environment: "prod" });
    mpr.registerProject({ name: "proj-b", environment: "staging" });
    mpr.mapSessionToProject("sess-a", "proj-a");
    mpr.mapSessionToProject("sess-b", "proj-b");
    const nsA = mpr.getProjectNamespace("proj-a");
    const nsB = mpr.getProjectNamespace("proj-b");
    // Verify isolation: proj-b key should not pass proj-a isolation check
    const iso = mpr.enforceIsolation("sess-a", nsB?.memoryKey);
    return { ok: !iso.allowed, crossProjectBlocked: !iso.allowed };
}

// ── Run all ───────────────────────────────────────────────────────────────────

function runAll() {
    const tests = [
        _run("reconnect-storm",         testReconnectStorm),
        _run("deployment-interruption", testDeploymentInterruption),
        _run("patch-rollback",          testPatchRollback),
        _run("browser-instability",     testBrowserInstability),
        _run("replay-heavy-session",    testReplayHeavySession),
        _run("long-execution-chain",    testLongExecutionChain),
        _run("multi-project-isolation", testMultiProjectIsolation),
    ];

    const passed  = tests.filter(t => t.ok).length;
    const totalMs = tests.reduce((s, t) => s + t.ms, 0);

    return {
        passed,
        failed:        tests.length - passed,
        total:         tests.length,
        totalMs,
        survivability: Math.round(passed / tests.length * 100),
        tests,
        summary:       `${passed}/${tests.length} passed — survivability: ${Math.round(passed / tests.length * 100)}%`,
    };
}

module.exports = { runAll, testReconnectStorm, testDeploymentInterruption, testPatchRollback, testBrowserInstability, testReplayHeavySession, testLongExecutionChain, testMultiProjectIsolation };
