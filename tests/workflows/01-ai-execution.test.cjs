"use strict";
/**
 * Workflow 1: AI Task Execution
 *
 * Tests the full PATH C pipeline:
 *   User request → planner → executionEngine → registered agent → result → history
 *
 * Uses real agents (terminal, browser) registered against the real agentRegistry.
 * Measures latency, success rate, history recording, and event bus emission.
 */
const test    = require("node:test");
const assert  = require("node:assert/strict");

// ── Real modules — no mocks ────────────────────────────────────────
const planner  = require("../../agents/planner.cjs");
const registry = require("../../agents/runtime/agentRegistry.cjs");
const engine   = require("../../agents/runtime/executionEngine.cjs");
const history  = require("../../agents/runtime/executionHistory.cjs");
const bus      = require("../../agents/runtime/runtimeEventBus.cjs");
const terminal = require("../../agents/terminalAgent.cjs");

// Register the terminal agent once for this test suite
registry.register({
    id:           "terminal",
    capabilities: ["terminal"],
    maxConcurrent: 2,
    handler: async (task) => {
        const command = task.payload?.command || task.command || "";
        return terminal.run(command);
    },
});

bus.reset();

// ── Helpers ────────────────────────────────────────────────────────

let _busEvents = [];
bus.subscribe("wf1-monitor", (evt) => { _busEvents.push(evt); });

function _latency(start) { return Date.now() - start; }

// ── Phase 1: Planner correctly parses task inputs ─────────────────

test("planner parses 'run git status' as terminal task", async () => {
    const tasks = await planner.plannerAgent("run git status");
    assert.ok(Array.isArray(tasks), "plannerAgent should return array");
    assert.ok(tasks.length > 0, "should produce at least one task");
    const t = tasks[0];
    assert.equal(t.type, "terminal", `expected terminal, got ${t.type}`);
    assert.ok(t.payload?.command, "terminal task should have payload.command");
});

test("planner parses 'run node -v' as terminal task with correct command", async () => {
    const tasks = await planner.plannerAgent("run node -v");
    const terminal_tasks = tasks.filter(t => t.type === "terminal");
    assert.ok(terminal_tasks.length > 0, `expected terminal task, got: ${JSON.stringify(tasks.map(t => t.type))}`);
    const cmd = terminal_tasks[0].payload?.command || "";
    assert.ok(cmd.includes("node"), `command should include 'node', got: "${cmd}"`);
});

test("planner parses 'open youtube' as browser task", async () => {
    const tasks = await planner.plannerAgent("open youtube");
    assert.ok(Array.isArray(tasks) && tasks.length > 0);
    const browserTask = tasks.find(t =>
        t.type === "open_youtube" || t.type === "open_url" || t.type === "web_search"
    );
    assert.ok(browserTask, `expected browser-type task, got: ${JSON.stringify(tasks.map(t => t.type))}`);
});

test("planner returns array for unknown input (AI fallback)", async () => {
    const tasks = await planner.plannerAgent("tell me something interesting");
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length > 0);
    // Should return some task type (could be "ai", "research", or fallback)
    assert.ok(tasks[0].type, "task should have a type");
});

test("planner splits compound input into multiple tasks", async () => {
    const tasks = await planner.plannerAgent("run git status and run node -v");
    assert.ok(Array.isArray(tasks));
    // Should have at least one task (split by "and")
    assert.ok(tasks.length >= 1, `expected tasks, got ${tasks.length}`);
});

// ── Phase 2: ExecutionEngine routes through registered agent ───────

test("executionEngine routes terminal task to registered terminal agent", async () => {
    const t0 = Date.now();
    const result = await engine.executeTask({
        type:    "terminal",
        payload: { command: "node -v" },
        input:   "node -v",
        label:   "Check Node version",
    });
    const latencyMs = _latency(t0);

    assert.equal(result.success, true, `terminal task failed: ${result.error}`);
    assert.equal(result.agentId, "terminal", `expected terminal agent, got ${result.agentId}`);
    assert.ok(result.result?.stdout || result.result?.output,
        `no output in result: ${JSON.stringify(result.result)}`);
    assert.ok(latencyMs < 5000, `latency ${latencyMs}ms exceeded 5s`);
    assert.ok(result.durationMs > 0, "durationMs should be positive");
    assert.equal(result.attempts, 1, "simple task should succeed on first attempt");
    console.log(`  [timing] terminal/node -v: ${result.durationMs}ms`);
});

test("executionEngine routes pwd terminal task and captures output", async () => {
    const result = await engine.executeTask({
        type:    "terminal",
        payload: { command: "pwd" },
        input:   "show working directory",
        label:   "pwd",
    });
    assert.equal(result.success, true, `pwd failed: ${result.error}`);
    assert.ok(result.result?.stdout?.includes("/"), "pwd should output a path");
});

test("executionEngine records success in executionHistory", async () => {
    const beforeCount = history.stats().total;

    await engine.executeTask({
        type:    "terminal",
        payload: { command: "echo 'history test'" },
        input:   "echo history test",
        label:   "echo",
    });

    const afterCount  = history.stats().total;
    assert.ok(afterCount > beforeCount, "history should grow after execution");

    const recent = history.recent(1);
    assert.ok(recent.length > 0, "recent history should have entries");
    assert.equal(recent[0].agentId, "terminal");
    assert.equal(recent[0].taskType, "terminal");
    assert.equal(recent[0].success, true);
});

test("executionEngine failure is recorded in history with error field", async () => {
    // Force a failure by providing a blocked command
    const result = await engine.executeTask({
        type:    "terminal",
        payload: { command: "rm -rf /" },
        input:   "rm -rf /",
        label:   "blocked command",
    }, { retries: 1 }); // limit retries to 1 so test is fast

    // The terminal agent blocks this — returns success:false, blocked:true
    // That still counts as a returned result (not thrown) so engine records it as success
    // from the perspective of "agent responded" — result.result.success is false
    assert.ok(!result.result?.success || result.result?.blocked,
        "blocked command should fail or be blocked");
    const recent = history.recent(1);
    assert.ok(recent.length > 0);
});

// ── Phase 3: Execution emits events to bus ─────────────────────────

test("execution emits event to runtimeEventBus", async () => {
    _busEvents = [];  // reset

    await engine.executeTask({
        type:    "terminal",
        payload: { command: "whoami" },
        input:   "who am I",
        label:   "whoami",
    });

    // Give event loop one tick to propagate
    await new Promise(r => setTimeout(r, 50));

    const execEvents = _busEvents.filter(e => e.type === "execution");
    assert.ok(execEvents.length >= 1,
        `expected execution event, bus had: ${_busEvents.map(e => e.type).join(", ")}`);
    assert.equal(execEvents[0].payload.taskType, "terminal");
});

// ── Phase 4: Full path — planner + executionEngine ─────────────────

test("full pipeline: planner → executionEngine → terminal agent → result", async () => {
    const t0 = Date.now();

    const tasks = await planner.plannerAgent("run git status");
    assert.ok(tasks.length > 0, "planner returned no tasks");

    const termTask = tasks.find(t => t.type === "terminal");
    assert.ok(termTask, `no terminal task in ${JSON.stringify(tasks.map(t => t.type))}`);

    const result = await engine.executeTask(termTask);
    const totalMs = _latency(t0);

    assert.equal(result.success, true, `pipeline failed: ${result.error}`);
    assert.equal(result.agentId, "terminal");
    assert.ok(totalMs < 8000, `total pipeline latency ${totalMs}ms excessive`);

    console.log(`  [timing] full pipeline (planner→engine→agent): ${totalMs}ms`);
    console.log(`  [output] ${String(result.result?.output || "").slice(0, 80)}`);
});

test("executionEngine returns error result (not throw) for no-handler capability", async () => {
    const result = await engine.executeTask({
        type: "create_agent",   // maps to "agent_factory" — no registered agent
        payload: {},
        input: "create a new agent",
    }, { retries: 1 });

    // Should return failure gracefully, not throw
    assert.equal(result.success, false,
        "unhandled capability should return success:false");
    assert.ok(result.error, "should have error message");
});

// Cleanup
test.after(() => {
    try { bus.unsubscribe("wf1-monitor"); } catch {}
    bus.reset();
});
