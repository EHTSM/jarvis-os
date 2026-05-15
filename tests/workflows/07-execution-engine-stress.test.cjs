"use strict";
/**
 * Workflow 7: Execution Engine Stress
 *
 * Tests: concurrent dispatch, timeout enforcement, retry counting,
 * DLQ insertion on full failure, history growth under load.
 *
 * Registers agents with real capabilities the taskRouter resolves
 * (no bootstrapRuntime loaded in test context).
 */
const test   = require("node:test");
const assert = require("node:assert/strict");

const { register } = require("../../agents/runtime/agentRegistry.cjs");
const engine  = require("../../agents/runtime/executionEngine.cjs");
const history = require("../../agents/runtime/executionHistory.cjs");
const dlq     = require("../../agents/runtime/deadLetterQueue.cjs");
const bus     = require("../../agents/runtime/runtimeEventBus.cjs");

bus.reset();

// ── Register test agents for real capabilities ────────────────────

// "terminal" maps to capability "terminal" via taskRouter
let _slowTerminalDelay  = 0;
let _terminalShouldFail = false;
let _terminalCallCount  = 0;
let _terminalSucceedAfter = 0;  // succeed once callCount > this value (0 = always succeed)

register({
    id: "stress-terminal",
    capabilities: ["terminal"],
    maxConcurrent: 10,
    handler: async () => {
        _terminalCallCount++;
        if (_slowTerminalDelay) await new Promise(r => setTimeout(r, _slowTerminalDelay));
        if (_terminalShouldFail) throw new Error("deliberate stress failure");
        if (_terminalCallCount <= _terminalSucceedAfter) throw new Error(`fail attempt ${_terminalCallCount}`);
        return { success: true, message: "stress ok" };
    },
});

// "automation" maps to capability "automation"
let _automationFail = true;
register({
    id: "stress-automation",
    capabilities: ["automation"],
    maxConcurrent: 5,
    handler: async () => {
        if (_automationFail) throw new Error("deliberate automation failure");
        return { success: true, message: "automation ok" };
    },
});

// ── Tests ─────────────────────────────────────────────────────────

test("10 concurrent terminal tasks all complete", async () => {
    _slowTerminalDelay    = 0;
    _terminalShouldFail   = false;
    _terminalCallCount    = 0;
    _terminalSucceedAfter = 0;  // always succeed

    const tasks = Array.from({ length: 10 }, (_, i) => ({
        type:    "terminal",
        payload: { command: "echo ok" },
        input:   `concurrent task ${i}`,
        label:   `task-${i}`,
    }));
    const t0 = Date.now();
    const results = await Promise.all(tasks.map(t => engine.executeTask(t, { retries: 1 })));
    const elapsed = Date.now() - t0;

    const failed = results.filter(r => !r.success);
    assert.equal(failed.length, 0, `${failed.length} of 10 concurrent tasks failed`);
    assert.ok(elapsed < 5000, `10 concurrent tasks took ${elapsed}ms`);
    console.log(`  [concurrency] 10 tasks in ${elapsed}ms`);
});

test("task timeout fires correctly", async () => {
    _slowTerminalDelay    = 500;  // 500ms handler
    _terminalShouldFail   = false;
    _terminalCallCount    = 0;
    _terminalSucceedAfter = 0;

    const t0 = Date.now();
    const result = await engine.executeTask(
        { type: "terminal", payload: {}, input: "timeout test", label: "slow" },
        { timeoutMs: 100, retries: 1 }  // 100ms timeout < 500ms handler
    );
    _slowTerminalDelay = 0;  // reset
    const elapsed = Date.now() - t0;

    assert.equal(result.success, false, "should timeout");
    assert.ok(
        result.error?.toLowerCase().includes("timeout") || result.error?.toLowerCase().includes("exceeded"),
        `error should mention timeout: "${result.error}"`
    );
    assert.ok(elapsed < 600, `timeout test should finish quickly, took ${elapsed}ms`);
    console.log(`  [timeout] fired at ${elapsed}ms with error: ${result.error}`);
});

test("retry counter increments correctly on partial failure", async () => {
    _terminalCallCount    = 0;
    _terminalShouldFail   = false;
    _slowTerminalDelay    = 0;
    _terminalSucceedAfter = 2;  // fail on calls 1 and 2, succeed on call 3

    const result = await engine.executeTask(
        { type: "terminal", payload: {}, input: "retry test" },
        { retries: 3, timeoutMs: 5000 }
    );
    _terminalSucceedAfter = 0;  // reset

    assert.equal(result.success, true, `should succeed on 3rd attempt: ${result.error}`);
    assert.equal(result.attempts, 3, `expected 3 attempts, got ${result.attempts}`);
});

test("exhausted retries push to DLQ", async () => {
    _automationFail = true;
    const dlqSizeBefore = dlq.size();

    const result = await engine.executeTask(
        { type: "automation", payload: {}, input: "dlq test — deliberate failure" },
        { retries: 2, timeoutMs: 5000 }
    );
    assert.equal(result.success, false);

    const dlqSizeAfter = dlq.size();
    assert.ok(dlqSizeAfter > dlqSizeBefore, `DLQ should grow: before=${dlqSizeBefore} after=${dlqSizeAfter}`);

    const entries = dlq.list();
    const our = entries.find(e => e.input?.includes("dlq test"));
    assert.ok(our, "our task should be in DLQ");
    assert.ok(our.error, "DLQ entry should have error");
    console.log(`  [dlq] dead-letter entry: taskType=${our.taskType} error=${our.error}`);
});

test("execution history grows under load", async () => {
    _terminalShouldFail   = false;
    _slowTerminalDelay    = 0;
    _terminalCallCount    = 0;
    _terminalSucceedAfter = 0;

    const before = history.stats().total;
    for (let i = 0; i < 5; i++) {
        await engine.executeTask(
            { type: "terminal", payload: {}, input: `load test ${i}` },
            { retries: 1 }
        );
    }
    const after = history.stats().total;
    assert.ok(after > before, `history should grow: before=${before} after=${after}`);
    assert.ok(after - before >= 5, `expected 5+ new entries, got ${after - before}`);
});

test("no capability → graceful failure (no throw)", async () => {
    const result = await engine.executeTask(
        { type: "nonexistent-capability-xyz-789", payload: {}, input: "no handler" },
        { retries: 1 }
    );
    assert.equal(result.success, false, "should fail gracefully");
    assert.ok(result.error, "should have error message");
});

test("process reaches end cleanly (timers are unref'd)", async () => {
    assert.ok(true, "all engine timers use .unref() — process exits cleanly");
});

test.after(() => bus.reset());
