"use strict";
/**
 * JARVIS INCIDENT REPAIR (2026-09-03, P0-1) regression: backend/server.js
 * previously started the entire autonomous workforce (I1-I4 +
 * agentRuntimeSupervisor + all 10 org-department register() calls, ~210
 * agent tick schedulers) unconditionally inside the same app.listen()
 * callback that just bound the HTTP port — no health check, no backlog
 * check. On every restart during the incident, the existing 8,393-mission
 * backlog was immediately re-exposed to every planner/reviewer/tester/etc.
 * tick the instant the process came back up, compounding the fan-out.
 *
 * _resolveAutonomousBootDecision() in server.js is the new gate: in "auto"
 * mode (the default) it inspects missionMemory.getMissionStats() (read-only)
 * and boots in degraded mode — skipping I1-I4 and every org registration —
 * if the non-terminal (planned+active+running) backlog is at/above
 * AUTONOMOUS_BACKLOG_LIMIT. "always" and "degraded" are explicit operator
 * overrides requiring no source change.
 *
 * These tests extract the function's own source (same technique already
 * established in tests/runtime/40-mission-dedup-and-recovery.test.cjs for
 * agentRuntimeSupervisor's _missionExists()) rather than booting the real
 * server — booting backend/server.js in a test process would bind the real
 * HTTP port and start every other real service, which is exactly what this
 * suite must not do. The function itself only performs a read-only
 * missionMemory.getMissionStats() call — no mission, mutation, or process
 * state is touched by these tests.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const SERVER_SRC_PATH = path.join(__dirname, "../../backend/server.js");

function _loadGateFn() {
    const src = fs.readFileSync(SERVER_SRC_PATH, "utf8");
    const m = src.match(/function _resolveAutonomousBootDecision\(\) \{[\s\S]*?\n\}/);
    assert.ok(m, "_resolveAutonomousBootDecision() must exist in backend/server.js");
    // eslint-disable-next-line no-eval
    return eval(`(${m[0]})`);
}

// The function's own require("./services/missionMemory.cjs") is relative to
// backend/ — eval'ing it from this test file's location would resolve
// against the wrong base. Match server.js's own module resolution by
// evaluating with backend/ as the effective require root via Module._load
// is overkill for a one-line relative path; simplest correct fix: chdir the
// require cache lookup by requiring through the real backend/server.js
// directory context using module.paths, exactly how Node resolves relative
// requires — done here by constructing the function inside a script whose
// __dirname is backend/.
function _loadGateFnWithRealRequireContext() {
    const src = fs.readFileSync(SERVER_SRC_PATH, "utf8");
    const m = src.match(/function _resolveAutonomousBootDecision\(\) \{[\s\S]*?\n\}/);
    const Module = require("node:module");
    const backendDir = path.join(__dirname, "../../backend");
    const wrapper = `(function (require, __dirname) { return (${m[0]}); })`;
    const scopedRequire = Module.createRequire(path.join(backendDir, "server.js"));
    // eslint-disable-next-line no-eval
    const factory = eval(wrapper);
    return factory(scopedRequire, backendDir);
}

describe("JARVIS incident repair P0-1 — autonomous workforce boot gate", () => {
    const ORIG_MODE  = process.env.AUTONOMOUS_BOOT_MODE;
    const ORIG_LIMIT = process.env.AUTONOMOUS_BACKLOG_LIMIT;

    function _restoreEnv() {
        if (ORIG_MODE === undefined) delete process.env.AUTONOMOUS_BOOT_MODE; else process.env.AUTONOMOUS_BOOT_MODE = ORIG_MODE;
        if (ORIG_LIMIT === undefined) delete process.env.AUTONOMOUS_BACKLOG_LIMIT; else process.env.AUTONOMOUS_BACKLOG_LIMIT = ORIG_LIMIT;
    }

    it("1. _resolveAutonomousBootDecision() exists and is a function", () => {
        const fn = _loadGateFn();
        assert.equal(typeof fn, "function");
    });

    it("2. AUTONOMOUS_BOOT_MODE=degraded always returns start:false, regardless of backlog", () => {
        const fn = _loadGateFnWithRealRequireContext();
        process.env.AUTONOMOUS_BOOT_MODE = "degraded";
        try {
            const d = fn();
            assert.equal(d.start, false);
            assert.match(d.reason, /degraded/i);
        } finally { _restoreEnv(); }
    });

    it("3. AUTONOMOUS_BOOT_MODE=always always returns start:true, regardless of backlog", () => {
        const fn = _loadGateFnWithRealRequireContext();
        process.env.AUTONOMOUS_BOOT_MODE = "always";
        try {
            const d = fn();
            assert.equal(d.start, true);
            assert.match(d.reason, /always/i);
        } finally { _restoreEnv(); }
    });

    it("4. default 'auto' mode reads the REAL live backlog via missionMemory.getMissionStats() (read-only)", () => {
        const fn = _loadGateFnWithRealRequireContext();
        delete process.env.AUTONOMOUS_BOOT_MODE;
        delete process.env.AUTONOMOUS_BACKLOG_LIMIT;
        try {
            const memory = require("../../backend/services/missionMemory.cjs");
            const before = memory.getMissionStats();
            const d = fn();
            const expectedNonTerminal =
                (before.byStatus?.planned || 0) + (before.byStatus?.active || 0) + (before.byStatus?.running || 0);
            assert.equal(d.backlog, expectedNonTerminal,
                "gate's computed backlog must match a real, independent getMissionStats() call made around the same time");
            assert.equal(d.limit, 2000, "default AUTONOMOUS_BACKLOG_LIMIT must be 2000");
        } finally { _restoreEnv(); }
    });

    it("5. 'auto' mode with a very low AUTONOMOUS_BACKLOG_LIMIT forces degraded boot against the real backlog", () => {
        // This repo's real data/missions.json already has thousands of
        // non-terminal missions (the incident backlog itself, read-only —
        // never modified by this test) — so a limit of 1 is guaranteed to
        // trip regardless of exactly how many exist right now.
        const fn = _loadGateFnWithRealRequireContext();
        delete process.env.AUTONOMOUS_BOOT_MODE;
        process.env.AUTONOMOUS_BACKLOG_LIMIT = "1";
        try {
            const d = fn();
            assert.equal(d.start, false, "a backlog limit of 1 must force degraded boot against this repo's real, much larger backlog");
            assert.match(d.reason, /backlog \d+ >= AUTONOMOUS_BACKLOG_LIMIT 1/);
        } finally { _restoreEnv(); }
    });

    it("6. 'auto' mode with a very high AUTONOMOUS_BACKLOG_LIMIT starts normally", () => {
        const fn = _loadGateFnWithRealRequireContext();
        delete process.env.AUTONOMOUS_BOOT_MODE;
        process.env.AUTONOMOUS_BACKLOG_LIMIT = "100000000";
        try {
            const d = fn();
            assert.equal(d.start, true, "a backlog limit far above any real mission count must start normally");
        } finally { _restoreEnv(); }
    });

    it("7. server.js calls the gate (inside the listen callback) after app.listen() itself is already invoked", () => {
        const src = fs.readFileSync(SERVER_SRC_PATH, "utf8");
        const listenCallIdx = src.indexOf("_httpServer = app.listen(");
        // The gate's CALL site (`const _autoBoot = _resolveAutonomousBootDecision();`),
        // not its function declaration (which is hoisted and may legitimately
        // sit earlier in the file, same as every other helper function here).
        const gateCallIdx = src.indexOf("const _autoBoot = _resolveAutonomousBootDecision();");
        assert.ok(listenCallIdx > -1, "app.listen() must still be present");
        assert.ok(gateCallIdx > -1, "the gate must actually be invoked somewhere in server.js, not just defined");
        assert.ok(gateCallIdx > listenCallIdx, "the gate must be evaluated AFTER app.listen() is already called, matching this file's existing deferred-startup pattern — HTTP responsiveness must never depend on this check");
    });

    it("8. memTracker.start() and the self-heal probe loop remain unconditional, ahead of the gate's call site", () => {
        const src = fs.readFileSync(SERVER_SRC_PATH, "utf8");
        const gateCallIdx = src.indexOf("const _autoBoot = _resolveAutonomousBootDecision();");
        const memTrackerIdx = src.indexOf("memTracker.start();");
        const selfHealIdx   = src.indexOf('require("./services/selfHealingRuntime.cjs").startProbeLoop();');
        assert.ok(memTrackerIdx > -1 && memTrackerIdx < gateCallIdx, "memTracker.start() must remain unconditional, before the gate's call site — it does not create missions and was not implicated in the incident");
        assert.ok(selfHealIdx > -1 && selfHealIdx < gateCallIdx, "selfHealingRuntime probe loop must remain unconditional, before the gate's call site — same reasoning");
    });

    it("9. the I4 (autonomousExecutionRuntime.start) call site sits textually inside the gated block, after the gate's call site", () => {
        const src = fs.readFileSync(SERVER_SRC_PATH, "utf8");
        const gateCallIdx = src.indexOf("const _autoBoot = _resolveAutonomousBootDecision();");
        const execRTIdx   = src.indexOf('require("./services/autonomousExecutionRuntime.cjs");\n        const execResult = execRT.start();');
        assert.ok(execRTIdx > -1, "the I4 autonomousExecutionRuntime start call must still be present");
        assert.ok(execRTIdx > gateCallIdx, "I4's start() call must sit after the gate's call site (i.e. inside the gated `else` block), so it only runs when the gate decides to start");
    });
});
