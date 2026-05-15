"use strict";
/**
 * Dispatch integration tests — validates the full runtime pipeline for all 5 task flows.
 *
 * Flow: dispatch(input) → planner → taskRouter → agentRegistry → executionEngine
 *       → handler → executionHistory → result
 *
 * Agents 1-2 (browser, desktop): tested via orchestrator.dispatch() with real planner output.
 * Agents 3-5 (automation, dev, system): tested via executionEngine.executeTask() directly,
 * using controlled handlers because external deps (n8n, Groq) are not available in test.
 */
const { describe, it, before } = require("node:test");
const assert       = require("node:assert/strict");
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const engine       = require("../../agents/runtime/executionEngine.cjs");
const history      = require("../../agents/runtime/executionHistory.cjs");
const registry     = require("../../agents/runtime/agentRegistry.cjs");

// Unique agent IDs for this test run — avoids conflicts with bootstrapRuntime if loaded
const RUN = `dispatch-${Date.now().toString(36)}`;

before(() => {
    // Register controlled test handlers for each capability under test
    orchestrator.registerAgent({
        id: `${RUN}-browser`, capabilities: ["browser"], maxConcurrent: 3,
        handler: async (task) => ({
            success: true,
            message: `browser:${task.type}:${task.payload?.query || task.payload?.url || ""}`,
            url: task.payload?.url || null,
        }),
    });
    orchestrator.registerAgent({
        id: `${RUN}-desktop`, capabilities: ["desktop"], maxConcurrent: 1,
        handler: async (task) => ({
            success: true,
            message: `desktop:${task.type}:${task.payload?.app || task.payload?.key || ""}`,
        }),
    });
    orchestrator.registerAgent({
        id: `${RUN}-automation`, capabilities: ["automation"], maxConcurrent: 2,
        handler: async (task) => ({
            success: true,
            message: `automation:${task.type || "start_lead_flow"}`,
        }),
    });
    orchestrator.registerAgent({
        id: `${RUN}-dev`, capabilities: ["dev"], maxConcurrent: 2,
        handler: async (task) => ({
            success: true,
            message: `dev:generated:${task.payload?.description?.slice(0, 30) || ""}`,
            framework: "node",
            lines: 42,
        }),
    });
    orchestrator.registerAgent({
        id: `${RUN}-system`, capabilities: ["system"], maxConcurrent: 2,
        handler: async (task) => ({ success: true, message: `system:${task.type}` }),
    });
});

// ── Result shape validator (used by all flows) ────────────────────
function assertResultShape(r) {
    assert.ok("success"    in r, "result missing success");
    assert.ok("agentId"    in r, "result missing agentId");
    assert.ok("durationMs" in r, "result missing durationMs");
    assert.ok("attempts"   in r, "result missing attempts");
    assert.equal(typeof r.durationMs, "number");
    assert.ok(r.durationMs >= 0);
    assert.ok(r.attempts >= 1);
}

// ── Flow 1: Web Search ────────────────────────────────────────────
describe("Flow 1 — web search request", () => {
    it("dispatch('search for nodejs best practices') routes to browser agent", async () => {
        const result = await orchestrator.dispatch("search for nodejs best practices");
        assert.equal(result.success, true);
        assert.ok(result.tasks.length >= 1);
        assert.equal(result.tasks[0].type, "web_search");
    });
    it("browser agent is called and returns a result", async () => {
        const result = await orchestrator.dispatch("search for nodejs best practices");
        assert.equal(result.results[0].agentId, `${RUN}-browser`);
        assert.ok(result.results[0].result?.message.startsWith("browser:web_search"));
    });
    it("executeTask({type:web_search}) records to execution history", async () => {
        const beforeCount = history.recent(500).filter(e => e.agentId === `${RUN}-browser`).length;
        await engine.executeTask(
            { type: "web_search", payload: { query: "nodejs" }, input: "search nodejs" },
            { retries: 1 }
        );
        const afterCount = history.recent(500).filter(e => e.agentId === `${RUN}-browser`).length;
        assert.ok(afterCount > beforeCount, "history not updated after execution");
    });
    it("web_search result has success=true and durationMs", async () => {
        const r = await engine.executeTask(
            { type: "web_search", payload: { query: "test" }, input: "search test" },
            { retries: 1 }
        );
        assertResultShape(r);
        assert.equal(r.success, true);
    });
});

// ── Flow 2: Open App ──────────────────────────────────────────────
describe("Flow 2 — open app request", () => {
    it("dispatch('open terminal') routes to desktop agent", async () => {
        const result = await orchestrator.dispatch("open terminal");
        assert.equal(result.success, true);
        const task = result.tasks[0];
        assert.equal(task.type, "open_app");
    });
    it("desktop agent is called and succeeds", async () => {
        const result = await orchestrator.dispatch("open terminal");
        assert.equal(result.results[0].agentId, `${RUN}-desktop`);
        assert.ok(result.results[0].result?.message.startsWith("desktop:open_app"));
    });
    it("executeTask({type:open_app}) records to history with correct taskType", async () => {
        await engine.executeTask(
            { type: "open_app", payload: { app: "terminal" }, input: "open terminal" },
            { retries: 1 }
        );
        const r = history.byType("open_app");
        assert.ok(r.length > 0, "open_app not in history");
        assert.equal(r[0].taskType, "open_app");
    });
});

// ── Flow 3: Automation Workflow ───────────────────────────────────
describe("Flow 3 — automation workflow request", () => {
    it("automation task routes to automation agent via executeTask", async () => {
        const r = await engine.executeTask(
            { type: "automation", payload: {}, input: "start lead flow" },
            { retries: 1 }
        );
        assert.equal(r.success, true);
        assert.equal(r.agentId, `${RUN}-automation`);
    });
    it("automation result message contains 'automation'", async () => {
        const r = await engine.executeTask(
            { type: "automation", payload: {}, input: "automate workflow" },
            { retries: 1 }
        );
        assert.ok(r.result?.message?.includes("automation"));
    });
    it("automation execution is recorded in history by type", async () => {
        await engine.executeTask(
            { type: "automation", payload: {}, input: "automate" },
            { retries: 1 }
        );
        const entries = history.byType("automation");
        assert.ok(entries.length > 0, "automation not in history");
    });
});

// ── Flow 4: Dev / Code Generation ────────────────────────────────
describe("Flow 4 — dev/codegen request", () => {
    it("dev task routes to dev agent via executeTask", async () => {
        const r = await engine.executeTask(
            { type: "dev", payload: { description: "simple express server" }, input: "generate express server" },
            { retries: 1 }
        );
        assert.equal(r.success, true);
        assert.equal(r.agentId, `${RUN}-dev`);
    });
    it("dev result includes expected message content", async () => {
        const r = await engine.executeTask(
            { type: "dev", payload: { description: "express api" }, input: "generate express api" },
            { retries: 1 }
        );
        assert.ok(r.result?.message?.includes("dev:generated"));
    });
    it("dev execution result shape is valid", async () => {
        const r = await engine.executeTask(
            { type: "dev", payload: { description: "hello world" }, input: "write hello world" },
            { retries: 1 }
        );
        assertResultShape(r);
    });
    it("dev execution appears in history byAgent", async () => {
        await engine.executeTask(
            { type: "dev", payload: { description: "utils" }, input: "build utils" },
            { retries: 1 }
        );
        const entries = history.byAgent(`${RUN}-dev`);
        assert.ok(entries.length > 0, "dev agent not in history");
    });
});

// ── Flow 5: System Task (timer/date/time) ────────────────────────
describe("Flow 5 — system task request", () => {
    it("timer task routes to system agent", async () => {
        const r = await engine.executeTask(
            { type: "timer", payload: { duration: 5, unit: "minutes" }, input: "set timer 5 minutes" },
            { retries: 1 }
        );
        assert.equal(r.success, true);
        assert.equal(r.agentId, `${RUN}-system`);
    });
    it("system result shape is valid", async () => {
        const r = await engine.executeTask(
            { type: "timer", payload: {}, input: "timer" },
            { retries: 1 }
        );
        assertResultShape(r);
    });
});

// ── Pipeline: execution history is always updated ────────────────
describe("execution history — cross-flow validation", () => {
    it("history.stats() shows non-zero total after all flows", () => {
        const s = history.stats();
        assert.ok(s.total > 0, "history is empty after all flow tests");
    });
    it("history.stats().succeeded > 0", () => {
        const s = history.stats();
        assert.ok(s.succeeded > 0);
    });
    it("history.stats().successRate is between 0 and 1", () => {
        const { successRate } = history.stats();
        assert.ok(successRate >= 0 && successRate <= 1);
    });
    it("uniqueAgents count includes test agents", () => {
        const { uniqueAgents } = history.stats();
        assert.ok(uniqueAgents >= 4, `expected >= 4 unique agents, got ${uniqueAgents}`);
    });
});
