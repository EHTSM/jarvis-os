"use strict";
const { describe, it } = require("node:test");
const assert   = require("node:assert/strict");
const registry = require("../../agents/runtime/agentRegistry.cjs");

// Unique prefix per test file run to avoid cross-test pollution
const P = `reg-${Date.now().toString(36)}`;

function noop() { return { success: true, message: "ok" }; }

describe("agentRegistry", () => {

    describe("register() and get()", () => {
        it("registered agent is retrievable by id", () => {
            registry.register({ id: `${P}-basic`, capabilities: ["basic-cap"], handler: noop });
            const a = registry.get(`${P}-basic`);
            assert.ok(a, "agent not found after registration");
            assert.equal(a.id, `${P}-basic`);
        });
        it("get() returns null for unknown id", () => {
            assert.equal(registry.get("totally-unknown-xyz-abc"), null);
        });
        it("capabilities are stored as a Set", () => {
            registry.register({ id: `${P}-caps`, capabilities: ["cap-a", "cap-b"], handler: noop });
            const a = registry.get(`${P}-caps`);
            assert.ok(a.capabilities instanceof Set);
            assert.ok(a.capabilities.has("cap-a"));
            assert.ok(a.capabilities.has("cap-b"));
        });
    });

    describe("findForCapability()", () => {
        it("finds a registered agent by capability", () => {
            registry.register({ id: `${P}-finder`, capabilities: [`${P}-find-cap`], handler: noop });
            const found = registry.findForCapability(`${P}-find-cap`);
            assert.ok(found, "should find registered agent");
            assert.equal(found.id, `${P}-finder`);
        });
        it("returns null when no agent has the capability", () => {
            const found = registry.findForCapability("no-such-capability-xyz");
            assert.equal(found, null);
        });
        it("returns null when all matching agents are at maxConcurrent", () => {
            registry.register({ id: `${P}-busy`, capabilities: [`${P}-busy-cap`], maxConcurrent: 1, handler: noop });
            const a = registry.get(`${P}-busy`);
            a.acquireSlot();  // fill the one slot
            const found = registry.findForCapability(`${P}-busy-cap`);
            assert.equal(found, null, "should not find a saturated agent");
            a.recordSuccess(); // release slot
        });
    });

    describe("circuit breaker", () => {
        it("agent is available (closed) after registration", () => {
            registry.register({ id: `${P}-cb`, capabilities: [`${P}-cb-cap`], handler: noop });
            const a = registry.get(`${P}-cb`);
            assert.equal(a._cbState, "closed");
            assert.equal(a.isAvailable(), true);
        });
        it("stays closed with fewer than CB_FAIL_THRESHOLD failures", () => {
            registry.register({ id: `${P}-cb2`, capabilities: [`${P}-cb2-cap`], handler: noop });
            const a = registry.get(`${P}-cb2`);
            a.acquireSlot(); a.recordFailure();  // 1
            a.acquireSlot(); a.recordFailure();  // 2
            a.acquireSlot(); a.recordFailure();  // 3
            a.acquireSlot(); a.recordFailure();  // 4
            assert.equal(a._cbState, "closed", "should not open before threshold");
            assert.equal(a.isAvailable(), true);
        });
        it("opens after CB_FAIL_THRESHOLD (5) consecutive failures", () => {
            registry.register({ id: `${P}-cb3`, capabilities: [`${P}-cb3-cap`], handler: noop });
            const a = registry.get(`${P}-cb3`);
            for (let i = 0; i < 5; i++) { a.acquireSlot(); a.recordFailure(); }
            assert.equal(a._cbState, "open", "should be open after 5 failures");
        });
        it("isAvailable() returns false when circuit is open", () => {
            registry.register({ id: `${P}-cb4`, capabilities: [`${P}-cb4-cap`], handler: noop });
            const a = registry.get(`${P}-cb4`);
            for (let i = 0; i < 5; i++) { a.acquireSlot(); a.recordFailure(); }
            assert.equal(a.isAvailable(), false, "open circuit should not be available");
        });
        it("findForCapability() skips an open-circuit agent", () => {
            registry.register({ id: `${P}-cb5`, capabilities: [`${P}-cb5-cap`], handler: noop });
            const a = registry.get(`${P}-cb5`);
            for (let i = 0; i < 5; i++) { a.acquireSlot(); a.recordFailure(); }
            const found = registry.findForCapability(`${P}-cb5-cap`);
            assert.equal(found, null, "open-circuit agent should not be selected");
        });
        it("recordSuccess() resets failures and closes the circuit", () => {
            registry.register({ id: `${P}-cb6`, capabilities: [`${P}-cb6-cap`], handler: noop });
            const a = registry.get(`${P}-cb6`);
            for (let i = 0; i < 5; i++) { a.acquireSlot(); a.recordFailure(); }
            assert.equal(a._cbState, "open");
            a._cbState = "half-open"; // simulate probe window elapsed
            a.acquireSlot();
            a.recordSuccess(100);
            assert.equal(a._cbState, "closed");
            assert.equal(a._cbFailures, 0);
        });
    });

    describe("stats tracking", () => {
        it("recordSuccess increments stats.success", () => {
            registry.register({ id: `${P}-stats`, capabilities: [`${P}-stats-cap`], handler: noop });
            const a = registry.get(`${P}-stats`);
            const before = a.stats.success;
            a.acquireSlot(); a.recordSuccess(50);
            assert.equal(a.stats.success, before + 1);
        });
        it("recordFailure increments stats.failure", () => {
            registry.register({ id: `${P}-stats2`, capabilities: [`${P}-stats2-cap`], handler: noop });
            const a = registry.get(`${P}-stats2`);
            const before = a.stats.failure;
            a.acquireSlot(); a.recordFailure();
            assert.equal(a.stats.failure, before + 1);
        });
    });

    describe("toJSON()", () => {
        it("returns correct shape", () => {
            registry.register({ id: `${P}-json`, capabilities: [`${P}-json-cap`], handler: noop });
            const a = registry.get(`${P}-json`);
            const j = a.toJSON();
            assert.ok("id"            in j);
            assert.ok("capabilities"  in j);
            assert.ok("cbState"       in j);
            assert.ok("active"        in j);
            assert.ok("stats"         in j);
            assert.ok("successRate"   in j.stats);
            assert.ok("avgDurationMs" in j.stats);
            assert.ok(Array.isArray(j.capabilities));
        });
    });

    describe("listAll()", () => {
        it("returns an array of agent JSON snapshots", () => {
            const all = registry.listAll();
            assert.ok(Array.isArray(all));
            assert.ok(all.length >= 1); // at least the agents registered above
            assert.ok(all.every(a => "id" in a && "cbState" in a));
        });
    });
});
