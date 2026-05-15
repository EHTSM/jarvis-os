"use strict";
/**
 * Recovery engine tests — unit + integration.
 *
 * Covers:
 *   classifyFailure   — all 8 types
 *   getStrategies     — sorting, exclusion, confidence blending
 *   attemptRecovery   — shape, memory recording, live strategy execution
 *   shouldGiveUp      — all stop conditions
 *   computeHealthScore — score ranges for various workflow shapes
 *   failureMemory     — record/read/blend
 *   autonomousWorkflow integration — recovery hooks fire and patch ctx
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert  = require("node:assert/strict");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");

const engine  = require("../../agents/runtime/recoveryEngine.cjs");
const memory  = require("../../agents/runtime/failureMemory.cjs");
const { runWorkflow } = require("../../agents/runtime/autonomousWorkflow.cjs");

const { F, classifyFailure, getStrategies, attemptRecovery, shouldGiveUp, computeHealthScore } = engine;

// ── Helpers ───────────────────────────────────────────────────────────

function mkTmpFile(content = '"use strict";\n') {
    const f = path.join(os.tmpdir(), `rec-test-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    fs.writeFileSync(f, content, "utf8");
    return f;
}
function rmFile(f) { try { fs.unlinkSync(f); } catch { /* ok */ } }
function mkErr(message, code, name) {
    const e = new Error(message);
    if (code) e.code = code;
    if (name) e.name = name;
    return e;
}

// Reset memory before every test to prevent cross-test bleed
beforeEach(() => memory.reset());

// ── 1. classifyFailure ────────────────────────────────────────────────

describe("classifyFailure — type detection", () => {

    it("SyntaxError name → syntax", () => {
        const cl = classifyFailure(mkErr("Unexpected token", null, "SyntaxError"));
        assert.equal(cl.type, F.SYNTAX);
        assert.ok(cl.confidence >= 0.9);
    });

    it("SyntaxError message → syntax", () => {
        const cl = classifyFailure(mkErr("SyntaxError: unexpected token '}'"));
        assert.equal(cl.type, F.SYNTAX);
    });

    it("MODULE_NOT_FOUND code → dependency", () => {
        const cl = classifyFailure(mkErr("Cannot find module 'lodash'", "MODULE_NOT_FOUND"));
        assert.equal(cl.type, F.DEPENDENCY);
        assert.ok(cl.confidence >= 0.9);
    });

    it("EADDRINUSE → port_conflict (higher priority than permission)", () => {
        const cl = classifyFailure(mkErr("address already in use :::3000", "EADDRINUSE"));
        assert.equal(cl.type, F.PORT_CONFLICT);
        assert.ok(cl.confidence >= 0.9);
    });

    it("EACCES → permission", () => {
        const cl = classifyFailure(mkErr("permission denied: /etc/hosts", "EACCES"));
        assert.equal(cl.type, F.PERMISSION);
    });

    it("EPERM → permission", () => {
        const cl = classifyFailure(mkErr("operation not permitted", "EPERM"));
        assert.equal(cl.type, F.PERMISSION);
    });

    it("ENOENT → missing_file", () => {
        const cl = classifyFailure(mkErr("no such file or directory '/tmp/missing.js'", "ENOENT"));
        assert.equal(cl.type, F.MISSING_FILE);
        assert.ok(cl.confidence >= 0.9);
    });

    it("ECONNREFUSED → network", () => {
        const cl = classifyFailure(mkErr("connect ECONNREFUSED 127.0.0.1:5000", "ECONNREFUSED"));
        assert.equal(cl.type, F.NETWORK);
    });

    it("ETIMEDOUT → timeout", () => {
        const cl = classifyFailure(mkErr("operation timed out", "ETIMEDOUT"));
        assert.equal(cl.type, F.TIMEOUT);
    });

    it("exit code 1 → process_failure", () => {
        const cl = classifyFailure(mkErr("process failed with exit code 1"));
        assert.equal(cl.type, F.PROCESS_FAILURE);
    });

    it("generic error → unknown with low confidence", () => {
        const cl = classifyFailure(mkErr("something weird happened"));
        assert.equal(cl.type, F.UNKNOWN);
        assert.ok(cl.confidence < 0.5);
    });

    it("classification always includes msg field", () => {
        const cl = classifyFailure(mkErr("test error"));
        assert.ok("msg" in cl);
        assert.ok(typeof cl.msg === "string");
    });

    it("null/undefined error does not throw", () => {
        assert.doesNotThrow(() => classifyFailure(null));
        assert.doesNotThrow(() => classifyFailure(undefined));
    });
});

// ── 2. getStrategies ─────────────────────────────────────────────────

describe("getStrategies — selection and sorting", () => {

    it("returns array for every failure type", () => {
        for (const type of Object.values(F)) {
            const strats = getStrategies({ type });
            assert.ok(Array.isArray(strats), `no strategies for ${type}`);
            assert.ok(strats.length > 0, `empty strategies for ${type}`);
        }
    });

    it("strategies are sorted by effectiveConfidence descending", () => {
        const strats = getStrategies({ type: F.SYNTAX });
        for (let i = 1; i < strats.length; i++) {
            assert.ok(
                strats[i - 1].effectiveConfidence >= strats[i].effectiveConfidence,
                "strategies not sorted by confidence"
            );
        }
    });

    it("usedIds are excluded", () => {
        const all    = getStrategies({ type: F.SYNTAX });
        const firstId = all[0].id;
        const rest   = getStrategies({ type: F.SYNTAX }, [firstId]);
        assert.ok(rest.every(s => s.id !== firstId), "used strategy still in list");
    });

    it("effectiveConfidence field present on every strategy", () => {
        const strats = getStrategies({ type: F.DEPENDENCY });
        for (const s of strats) {
            assert.ok("effectiveConfidence" in s);
            assert.ok(s.effectiveConfidence >= 0 && s.effectiveConfidence <= 1);
        }
    });

    it("confidence blends toward history after 20+ samples", () => {
        // Record 20 successes for a strategy to push rate to 1.0
        for (let i = 0; i < 20; i++) memory.recordOutcome(F.SYNTAX, "syntax-add-brace", true);
        const strats = getStrategies({ type: F.SYNTAX });
        const s = strats.find(x => x.id === "syntax-add-brace");
        // With 20 success-only samples, effectiveConfidence should be pulled above base
        assert.ok(s.effectiveConfidence > s.confidence, "history should boost confidence");
    });
});

// ── 3. shouldGiveUp ───────────────────────────────────────────────────

describe("shouldGiveUp — stop conditions", () => {

    it("stops when totalAttempts >= MAX_RECOVERY_ATTEMPTS", () => {
        const r = shouldGiveUp({ totalAttempts: engine.MAX_RECOVERY_ATTEMPTS, usedStrategies: [], classification: { type: F.SYNTAX } });
        assert.equal(r.stop, true);
        assert.equal(r.reason, "max_attempts_reached");
    });

    it("stops after 3 consecutive recovery failures", () => {
        const r = shouldGiveUp({ totalAttempts: 1, usedStrategies: [], classification: { type: F.SYNTAX }, consecutiveFails: 3 });
        assert.equal(r.stop, true);
        assert.equal(r.reason, "three_consecutive_recovery_failures");
    });

    it("stops when all strategies exhausted", () => {
        const all = getStrategies({ type: F.SYNTAX }).map(s => s.id);
        const r   = shouldGiveUp({ totalAttempts: 1, usedStrategies: all, classification: { type: F.SYNTAX } });
        assert.equal(r.stop, true);
        assert.equal(r.reason, "no_strategies_remaining");
    });

    it("does not stop with fresh state and strategies available", () => {
        const r = shouldGiveUp({ totalAttempts: 1, usedStrategies: [], classification: { type: F.SYNTAX }, consecutiveFails: 0 });
        assert.equal(r.stop, false);
    });

    it("stops when best remaining confidence < MIN_CONFIDENCE_THRESHOLD", () => {
        // Drive history success rate to 0 for all unknown strategies
        for (let i = 0; i < 30; i++) memory.recordOutcome(F.UNKNOWN, "unknown-log-and-wait", false);
        const r = shouldGiveUp({ totalAttempts: 1, usedStrategies: [], classification: { type: F.UNKNOWN }, consecutiveFails: 0 });
        assert.equal(r.stop, true);
        assert.equal(r.reason, "confidence_below_threshold");
    });
});

// ── 4. computeHealthScore ─────────────────────────────────────────────

describe("computeHealthScore — score ranges", () => {

    function mkResult(stepConfigs) {
        return {
            stepDetails: stepConfigs.map(([name, status, attempts, recoveries = 0]) => ({
                name, status, attempts, recoveries, error: null, result: null,
            })),
        };
    }

    it("all completed, 1 attempt each → score near 100", () => {
        const score = computeHealthScore(mkResult([
            ["a", "completed", 1], ["b", "completed", 1], ["c", "completed", 1],
        ]));
        assert.ok(score >= 90, `expected >= 90, got ${score}`);
    });

    it("all completed with retries → score 70–90", () => {
        const score = computeHealthScore(mkResult([
            ["a", "completed", 3], ["b", "completed", 3], ["c", "completed", 3],
        ]));
        assert.ok(score >= 60 && score <= 95, `expected 60–95, got ${score}`);
    });

    it("one failed step → score drops below 75", () => {
        const score = computeHealthScore(mkResult([
            ["a", "completed", 1], ["b", "failed", 3], ["c", "skipped", 0],
        ]));
        assert.ok(score < 75, `expected < 75, got ${score}`);
    });

    it("all failed → score near 0", () => {
        const score = computeHealthScore(mkResult([
            ["a", "failed", 3], ["b", "failed", 3],
        ]));
        assert.ok(score <= 20, `expected <= 20, got ${score}`);
    });

    it("null input → 0", () => {
        assert.equal(computeHealthScore(null), 0);
    });

    it("empty stepDetails → 100", () => {
        assert.equal(computeHealthScore({ stepDetails: [] }), 100);
    });

    it("score is always in [0, 100]", () => {
        for (const cfg of [
            [["a", "completed", 1]],
            [["a", "failed", 5], ["b", "failed", 5], ["c", "failed", 5]],
            [["a", "completed", 10], ["b", "skipped", 0]],
        ]) {
            const score = computeHealthScore(mkResult(cfg));
            assert.ok(score >= 0 && score <= 100, `out of range: ${score}`);
        }
    });
});

// ── 5. failureMemory ─────────────────────────────────────────────────

describe("failureMemory — record and read", () => {

    it("getSuccessRate returns null with < 3 samples", () => {
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        assert.equal(memory.getSuccessRate("syntax", "syntax-add-brace"), null);
    });

    it("getSuccessRate returns correct rate after 4 samples", () => {
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        memory.recordOutcome("syntax", "syntax-add-brace", false);
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        const rate = memory.getSuccessRate("syntax", "syntax-add-brace");
        assert.ok(Math.abs(rate - 0.75) < 0.01);
    });

    it("getAttemptCount reflects total call count", () => {
        for (let i = 0; i < 5; i++) memory.recordOutcome("timeout", "timeout-exponential-wait", i % 2 === 0);
        assert.equal(memory.getAttemptCount("timeout", "timeout-exponential-wait"), 5);
    });

    it("topStrategies returns highest-rate entries first", () => {
        // bad strategy: 0/5
        for (let i = 0; i < 5; i++) memory.recordOutcome("dependency", "dep-npm-install", false);
        // good strategy: 4/5
        for (let i = 0; i < 4; i++) memory.recordOutcome("dependency", "dep-extract-and-install", true);
        memory.recordOutcome("dependency", "dep-extract-and-install", false);
        const top = memory.topStrategies("dependency");
        assert.equal(top[0].id, "dep-extract-and-install");
        assert.ok(top[0].rate > top[1].rate);
    });

    it("snapshot returns a deep copy (mutations do not affect memory)", () => {
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        memory.recordOutcome("syntax", "syntax-add-brace", true);
        const snap = memory.snapshot();
        snap.syntax["syntax-add-brace"].attempts = 9999;
        assert.equal(memory.getAttemptCount("syntax", "syntax-add-brace"), 3);
    });
});

// ── 6. attemptRecovery — shape ────────────────────────────────────────

describe("attemptRecovery — result shape", () => {

    it("returns recovered, strategyId, classification, durationMs on any path", async () => {
        const err = mkErr("Cannot find module 'nonexistent-pkg-xyz'", "MODULE_NOT_FOUND");
        const r   = await attemptRecovery(err, { _projectPath: "/nonexistent" });
        assert.ok("recovered"      in r);
        assert.ok("strategyId"     in r);
        assert.ok("classification" in r);
        assert.ok("durationMs"     in r);
        assert.equal(r.classification.type, F.DEPENDENCY);
    });

    it("records outcome in memory after call", async () => {
        const err = mkErr("connection refused", "ECONNREFUSED");
        await attemptRecovery(err, {});
        // Should have 1 record for network strategies
        const snap = memory.snapshot();
        const networkData = snap[F.NETWORK] || {};
        const total = Object.values(networkData).reduce((s, e) => s + e.attempts, 0);
        assert.equal(total, 1);
    });

    it("no_strategies_available when all exhausted", async () => {
        const all = getStrategies({ type: F.UNKNOWN }).map(s => s.id);
        const r   = await attemptRecovery(mkErr("unknown"), {}, { usedStrategies: all });
        assert.equal(r.recovered, false);
        assert.equal(r.reason, "no_strategies_available");
    });
});

// ── 7. Live strategy tests ────────────────────────────────────────────

describe("live strategy: syntax-add-brace", () => {
    let tmpFile;
    before(() => {
        tmpFile = mkTmpFile(`function greet(name) {\n    return "hi " + name;\n`);
    });
    after(() => rmFile(tmpFile));

    it("adds missing closing brace to a real file", async () => {
        const err = mkErr("SyntaxError: missing }", null, "SyntaxError");
        const ctx = { _lastFile: tmpFile };
        const r   = await attemptRecovery(err, ctx, { usedStrategies: [] });
        assert.equal(r.recovered, true);
        assert.equal(r.strategyId, "syntax-add-brace");
        const content = fs.readFileSync(tmpFile, "utf8");
        const opens   = (content.match(/\{/g) || []).length;
        const closes  = (content.match(/\}/g) || []).length;
        assert.equal(opens, closes, "braces should be balanced after fix");
    });
});

describe("live strategy: port-find-free", () => {
    it("writes a free port number into ctx._port", async () => {
        const err = mkErr("listen EADDRINUSE :::3000", "EADDRINUSE");
        const ctx = {};
        const r   = await attemptRecovery(err, ctx, { usedStrategies: [] });
        assert.equal(r.recovered, true);
        assert.equal(r.strategyId, "port-find-free");
        assert.ok(typeof ctx._port === "number" && ctx._port > 3000, `expected port > 3000, got ${ctx._port}`);
    });
});

describe("live strategy: missing-create-stub", () => {
    let stubFile;
    after(() => { if (stubFile) rmFile(stubFile); });

    it("creates a missing .cjs file on disk", async () => {
        stubFile = path.join(os.tmpdir(), `missing-stub-${Date.now()}.cjs`);
        const err = mkErr(`ENOENT: no such file or directory '${stubFile}'`, "ENOENT");
        const ctx = {};
        const r   = await attemptRecovery(err, ctx, { usedStrategies: [] });
        assert.equal(r.recovered, true);
        assert.equal(r.strategyId, "missing-create-stub");
        assert.ok(fs.existsSync(stubFile), "stub file should exist on disk");
        const content = fs.readFileSync(stubFile, "utf8");
        assert.ok(content.includes("module.exports"), "stub should export");
    });
});

// ── 8. autonomousWorkflow integration ────────────────────────────────

describe("autonomousWorkflow — recovery integration", () => {

    it("result shape includes healthScore field", async () => {
        const steps = [{
            name: "trivial",
            execute: async () => ({ done: true }),
        }];
        const r = await runWorkflow("health-score-test", steps);
        assert.ok("healthScore" in r, "result should have healthScore");
        assert.ok(r.healthScore >= 0 && r.healthScore <= 100);
    });

    it("stepDetails includes recoveries field", async () => {
        const steps = [{
            name: "no-recovery-needed",
            execute: async () => ({ ok: true }),
        }];
        const r = await runWorkflow("recovery-field-test", steps);
        for (const s of r.stepDetails) {
            assert.ok("recoveries" in s, `stepDetails missing recoveries field on step "${s.name}"`);
        }
    });

    it("recovery fires and patches ctx when step throws a syntax-like error with _lastFile", async () => {
        let callCount = 0;
        let patchedFile;

        // Step 1: write a broken file into ctx._lastFile
        // Step 2: "fail" first time with a SyntaxError (recovery patches the file), succeed second time
        const brokenContent = `function foo() {\n    return 1;\n`; // missing }
        const tmpFile = mkTmpFile(brokenContent);

        const steps = [
            {
                name: "set-file",
                execute: async (ctx) => {
                    ctx._lastFile = tmpFile;
                    return { path: tmpFile };
                },
            },
            {
                name:       "check-and-fix",
                maxRetries: 1, // 1 base retry + up to 6 recovery extension
                execute: async (ctx) => {
                    callCount++;
                    if (callCount === 1) {
                        // Throw syntax error — recovery should add brace
                        const e = new Error("SyntaxError: missing closing brace");
                        e.name = "SyntaxError";
                        throw e;
                    }
                    // On retry: brace should be present now
                    const content = fs.readFileSync(ctx._lastFile, "utf8");
                    patchedFile = content;
                    return { fixed: true };
                },
            },
        ];

        const r = await runWorkflow("recovery-integration-test", steps, { maxRetries: 3 });

        rmFile(tmpFile);

        assert.equal(r.success, true, `workflow should succeed, got error: ${r.error}`);
        assert.ok(callCount >= 2, "step should have been called at least twice");
        // Brace balance in patched file
        const opens  = (patchedFile.match(/\{/g) || []).length;
        const closes = (patchedFile.match(/\}/g) || []).length;
        assert.equal(opens, closes, "recovery should have balanced braces");

        const fixStep = r.stepDetails.find(s => s.name === "check-and-fix");
        assert.ok(fixStep.recoveries >= 1, "step should record at least 1 recovery");
    });

    it("clean workflow scores healthScore >= 90", async () => {
        const steps = [
            { name: "s1", execute: async () => ({ a: 1 }) },
            { name: "s2", execute: async () => ({ b: 2 }) },
            { name: "s3", execute: async () => ({ c: 3 }) },
        ];
        const r = await runWorkflow("clean-health-test", steps);
        assert.equal(r.success, true);
        assert.ok(r.healthScore >= 90, `clean workflow should score >= 90, got ${r.healthScore}`);
    });

    it("failed workflow scores healthScore below 60", async () => {
        let calls = 0;
        const steps = [
            { name: "ok",     execute: async () => ({ done: true }) },
            {
                name:       "fail",
                maxRetries: 1,
                execute:    async () => { calls++; throw new Error("permanent failure"); },
            },
        ];
        const r = await runWorkflow("failed-health-test", steps, { maxRetries: 1 });
        assert.equal(r.success, false);
        assert.ok(r.healthScore < 60, `failed workflow should score < 60, got ${r.healthScore}`);
    });
});
